// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/chatgpt-auth", () => ({
  getChatGPTUser: vi.fn(),
}));

import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { DELETE, GET, POST } from "../../app/api/attachments/route";
import { FakeDb } from "../helpers/fake-d1";
import { FakeR2 } from "../helpers/fake-r2";

const MANAGER = "bruno.silva@example.com";
const OTHER_MANAGER = "carla.mendez@example.com";
const OWNER = "ana.torres@example.com";

const mockedUser = vi.mocked(getChatGPTUser);
let db: FakeDb;
let bucket: FakeR2;

function signIn(email: string) {
  mockedUser.mockResolvedValue({
    userId: "test-user",
    displayName: email,
    email,
    fullName: null,
  });
}

function seedTask(overrides: Record<string, unknown> = {}) {
  db.seed("tasks", [
    {
      id: 1,
      title: "Cotizar",
      creator: MANAGER,
      assignee: "staff@example.com",
      ...overrides,
    },
  ]);
}

function seedAttachment(overrides: Record<string, unknown> = {}) {
  db.seed("attachments", [
    {
      id: "a1",
      task_id: 1,
      object_key: "tasks/1/a1",
      name: "cotizacion.pdf",
      mime: "application/pdf",
      size: 5,
      uploader: MANAGER,
      created: "2026-11-01T00:00:00.000Z",
      ...overrides,
    },
  ]);
}

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return (await response.json()) as T;
}

beforeEach(async () => {
  db = new FakeDb();
  bucket = new FakeR2();
  db.seed("people", [
    {
      email: "staff@example.com",
      name: "Diego Fuentes",
      role: "staff",
      manager: MANAGER,
    },
  ]);
  (env as Record<string, unknown>).DB = db;
  (env as Record<string, unknown>).BUCKET = bucket;
  mockedUser.mockReset();
  await bucket.put(
    "tasks/1/a1",
    new Uint8Array([37, 80, 68, 70, 45]),
    { httpMetadata: { contentType: "application/pdf" } },
  );
});

describe("GET /api/attachments", () => {
  it("exige sesión", async () => {
    mockedUser.mockResolvedValue(null);
    const response = await GET(
      new Request("http://localhost/api/attachments?task=1"),
    );
    expect(response.status).toBe(403);
  });

  it("rechaza una tarea inválida", async () => {
    signIn(MANAGER);
    const response = await GET(
      new Request("http://localhost/api/attachments?task=abc"),
    );
    expect(response.status).toBe(400);
  });

  it("lista los adjuntos visibles", async () => {
    signIn(MANAGER);
    seedTask();
    seedAttachment();
    const response = await GET(
      new Request("http://localhost/api/attachments?task=1"),
    );
    const payload = await json<{ attachments: Array<{ name: string }> }>(
      response,
    );
    expect(response.status).toBe(200);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].name).toBe("cotizacion.pdf");
  });

  it("descarga un archivo con cabeceras seguras", async () => {
    signIn(MANAGER);
    seedTask();
    seedAttachment();
    const response = await GET(
      new Request("http://localhost/api/attachments?id=a1&open=1"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("devuelve 404 si el objeto no existe en R2", async () => {
    signIn(MANAGER);
    seedTask();
    seedAttachment({ object_key: "tasks/1/perdido" });
    const response = await GET(
      new Request("http://localhost/api/attachments?id=a1"),
    );
    expect(response.status).toBe(404);
  });

  it("devuelve 503 si R2 no está configurado", async () => {
    signIn(MANAGER);
    seedTask();
    seedAttachment();
    (env as Record<string, unknown>).BUCKET = undefined;
    const response = await GET(
      new Request("http://localhost/api/attachments?id=a1"),
    );
    expect(response.status).toBe(503);
  });
});

describe("POST /api/attachments", () => {
  it("rechaza orígenes distintos", async () => {
    signIn(MANAGER);
    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("sube un PDF válido y lo registra en la base", async () => {
    signIn(MANAGER);
    seedTask();
    const form = new FormData();
    form.set("task", "1");
    form.set(
      "file",
      new File([new Uint8Array([37, 80, 68, 70, 45, 49])], "cotizacion.pdf", {
        type: "application/pdf",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(db.tables.attachments).toHaveLength(1);
    expect(db.tables.attachments[0]).toMatchObject({
      task_id: 1,
      name: "cotizacion.pdf",
      mime: "application/pdf",
      uploader: MANAGER,
    });
    expect(bucket.keys().some((key) => key !== "tasks/1/a1")).toBe(true);
  });

  it("rechaza extensiones no permitidas", async () => {
    signIn(MANAGER);
    seedTask();
    const form = new FormData();
    form.set("task", "1");
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "script.exe", {
        type: "application/octet-stream",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: expect.stringMatching(/formato/i),
    });
  });

  it("rechaza un archivo cuyo contenido no coincide con la extensión", async () => {
    signIn(MANAGER);
    seedTask();
    const form = new FormData();
    form.set("task", "1");
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "falso.pdf", {
        type: "application/pdf",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: form,
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/attachments", () => {
  it("solo quien subió el archivo puede borrarlo", async () => {
    signIn(OTHER_MANAGER);
    seedTask({ creator: OTHER_MANAGER });
    seedAttachment({ uploader: MANAGER });

    const response = await DELETE(
      new Request("http://localhost/api/attachments?id=a1", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("el uploader borra el objeto y el registro", async () => {
    signIn(MANAGER);
    seedTask();
    seedAttachment();

    const response = await DELETE(
      new Request("http://localhost/api/attachments?id=a1", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
    );

    expect(response.status).toBe(200);
    expect(db.tables.attachments).toHaveLength(0);
    expect(bucket.has("tasks/1/a1")).toBe(false);
  });

  it("el owner puede borrar archivos de otros", async () => {
    signIn(OWNER);
    seedTask();
    seedAttachment({ uploader: MANAGER });

    const response = await DELETE(
      new Request("http://localhost/api/attachments?id=a1", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
    );

    expect(response.status).toBe(200);
  });
});
