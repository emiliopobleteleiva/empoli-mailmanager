// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "cloudflare:workers";
import { POST } from "../../app/mcp/route";
import { resetGraphTokenCache } from "../../lib/graph-mail";
import { FakeDb } from "../helpers/fake-d1";

const OWNER = "owner@example.com";
const RECIPIENT = "pilot@example.com";
let db: FakeDb;

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function authorized() {
  return {
    "oai-authenticated-user-id": "owner-id",
    "oai-authenticated-user-email": OWNER,
  };
}

function call(name: string, args: Record<string, unknown> = {}) {
  return rpc(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    authorized(),
  );
}

type RpcResponse = {
  result: {
    serverInfo?: { name: string };
    tools?: unknown[];
    isError?: boolean;
    content: Array<{ text: string }>;
  };
};

async function json<T = RpcResponse>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeEach(() => {
  db = new FakeDb();
  db.seed("tasks", [
    {
      id: 1,
      title: "Llamar al cliente",
      due: "2026-12-01",
      status: "pending",
      assignee: RECIPIENT,
    },
  ]);
  (env as Record<string, unknown>).DB = db;
  (env as Record<string, unknown>).MCP_OWNER_EMAIL = OWNER;
  (env as Record<string, unknown>).MAIL_PILOT_RECIPIENT = RECIPIENT;
  (env as Record<string, unknown>).MAIL_PILOT_SENDER = "no-reply@example.com";
  (env as Record<string, unknown>).MS_TENANT_ID = "tenant-id";
  (env as Record<string, unknown>).MS_CLIENT_ID = "client-id";
  (env as Record<string, unknown>).MS_CLIENT_SECRET = "client-secret";
  resetGraphTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /mcp", () => {
  it("responde al handshake initialize", async () => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    const payload = await json(response);
    expect(payload.result.serverInfo?.name).toBe("arpoli-piloto");
  });

  it("lista las herramientas disponibles", async () => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const payload = await json(response);
    expect(payload.result.tools).toHaveLength(3);
  });

  it("rechaza métodos no disponibles", async () => {
    const response = await POST(rpc({ jsonrpc: "2.0", id: 3, method: "otro" }));
    const payload = await json(response);
    expect(payload.result.isError).toBe(true);
  });

  it("exige la cuenta de prueba para ejecutar herramientas", async () => {
    const response = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "consultar_tareas_prueba" },
      }),
    );
    const payload = await json(response);
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toMatch(/sin autorización/i);
  });

  it("consulta las tareas de la cuenta de prueba", async () => {
    const payload = await json(await POST(call("consultar_tareas_prueba")));
    const text = JSON.parse(payload.result.content[0].text);
    expect(text.tasks).toHaveLength(1);
    expect(text.tasks[0].title).toBe("Llamar al cliente");
  });

  it("prepara un aviso sin enviarlo", async () => {
    const payload = await json(
      await POST(call("preparar_aviso_prueba", { task_id: 1 })),
    );
    const draft = JSON.parse(payload.result.content[0].text);
    expect(draft.recipient).toBe(RECIPIENT);
    expect(db.tables.pilot_notices).toHaveLength(0);
  });

  it("rechaza tareas que no son de la cuenta de prueba", async () => {
    const payload = await json(
      await POST(call("preparar_aviso_prueba", { task_id: 99 })),
    );
    expect(payload.result.isError).toBe(true);
  });

  it("exige confirmación explícita antes de enviar", async () => {
    const payload = await json(
      await POST(
        call("enviar_aviso_prueba_confirmado", {
          task_id: 1,
          request_id: crypto.randomUUID(),
          confirmacion: false,
        }),
      ),
    );
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toMatch(/confirma/i);
  });

  it("envía un aviso confirmado con Microsoft Graph", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    const payload = await json(
      await POST(
        call("enviar_aviso_prueba_confirmado", {
          task_id: 1,
          request_id: crypto.randomUUID(),
          confirmacion: true,
        }),
      ),
    );

    const answer = JSON.parse(payload.result.content[0].text);
    expect(answer.status).toBe("accepted");
    expect(db.tables.pilot_notices).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falla de forma controlada si falta configuración del piloto", async () => {
    (env as Record<string, unknown>).MAIL_PILOT_RECIPIENT = undefined;
    const payload = await json(
      await POST(
        call("enviar_aviso_prueba_confirmado", {
          task_id: 1,
          request_id: crypto.randomUUID(),
          confirmacion: true,
        }),
      ),
    );
    expect(payload.result.isError).toBe(true);
  });
});
