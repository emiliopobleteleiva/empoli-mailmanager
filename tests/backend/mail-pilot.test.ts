// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  draftPilot,
  pilotConfig,
  sendPilot,
} from "../../app/mail-pilot";
import { resetGraphTokenCache } from "../../lib/graph-mail";
import { FakeDb } from "../helpers/fake-d1";

const RECIPIENT = "pilot@example.com";
const SENDER = "no-reply@example.com";
const env = {
  MAIL_PILOT_RECIPIENT: RECIPIENT,
  MAIL_PILOT_SENDER: SENDER,
  MS_TENANT_ID: "tenant-id",
  MS_CLIENT_ID: "client-id",
  MS_CLIENT_SECRET: "client-secret",
};
const config = { recipient: RECIPIENT, sender: SENDER };
const task = {
  id: 1,
  title: "Llamar al cliente",
  due: "2026-12-01",
  status: "pending",
  assignee: RECIPIENT,
};

let db: FakeDb;

function graphFetch(
  options: {
    tokenStatus?: number;
    sendStatus?: number;
    sendThrows?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/oauth2/v2.0/token")) {
      const status = options.tokenStatus ?? 200;
      return {
        ok: status < 400,
        status,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      };
    }
    if (options.sendThrows) throw new Error("network");
    const status = options.sendStatus ?? 202;
    return {
      ok: status < 400,
      status,
      json: async () => ({}),
    };
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(() => {
  db = new FakeDb();
  resetGraphTokenCache();
});

describe("pilotConfig", () => {
  it("exige destinatario y remitente", () => {
    expect(() => pilotConfig({})).toThrow(/MAIL_PILOT/);
  });
});

describe("draftPilot", () => {
  it("rechaza tareas que no son de la cuenta de prueba", () => {
    expect(() =>
      draftPilot({ ...task, assignee: "otro@example.com" }, config),
    ).toThrow(/cuenta de prueba/);
  });

  it("arma el aviso para la cuenta de prueba", () => {
    const draft = draftPilot(task, config);
    expect(draft.recipient).toBe(RECIPIENT);
    expect(draft.sender).toBe(SENDER);
    expect(draft.text).toContain("Llamar al cliente");
  });
});

describe("sendPilot", () => {
  it("exige configuración del piloto", async () => {
    await expect(
      sendPilot(
        db as unknown as D1Database,
        {},
        task,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(/MAIL_PILOT/);
  });

  it("exige un identificador UUID v4", async () => {
    await expect(
      sendPilot(db as unknown as D1Database, env, task, "no-es-uuid"),
    ).rejects.toThrow(/Identificador/);
  });

  it("no reintenta si ya existe el registro", async () => {
    const failing = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error("duplicado");
          },
        }),
      }),
    } as unknown as D1Database;

    await expect(
      sendPilot(failing, env, task, crypto.randomUUID()),
    ).rejects.toThrow(/ya existe/);
  });

  it("marca accepted cuando Microsoft acepta el mensaje", async () => {
    const requestId = crypto.randomUUID();
    const { fn, calls } = graphFetch();

    const result = await sendPilot(
      db as unknown as D1Database,
      env,
      task,
      requestId,
      fn,
    );

    expect(result.status).toBe("accepted");
    expect(db.tables.pilot_notices[0]).toMatchObject({
      id: requestId,
      status: "accepted",
      provider_id: null,
    });
    expect(calls.some((url) => url.includes("/sendMail"))).toBe(true);
  });

  it("marca rejected cuando Microsoft rechaza el envío", async () => {
    const { fn } = graphFetch({ sendStatus: 403 });

    const result = await sendPilot(
      db as unknown as D1Database,
      env,
      task,
      crypto.randomUUID(),
      fn,
    );

    expect(result.status).toBe("rejected");
  });

  it("marca unknown ante errores 5xx", async () => {
    const { fn } = graphFetch({ sendStatus: 503 });

    const result = await sendPilot(
      db as unknown as D1Database,
      env,
      task,
      crypto.randomUUID(),
      fn,
    );

    expect(result.status).toBe("unknown");
  });

  it("marca unknown si la red falla", async () => {
    const { fn } = graphFetch({ sendThrows: true });

    const result = await sendPilot(
      db as unknown as D1Database,
      env,
      task,
      crypto.randomUUID(),
      fn,
    );

    expect(result.status).toBe("unknown");
  });

  it("marca unknown si no se puede autenticar con Microsoft", async () => {
    const { fn, calls } = graphFetch({ tokenStatus: 400 });

    const result = await sendPilot(
      db as unknown as D1Database,
      env,
      task,
      crypto.randomUUID(),
      fn,
    );

    expect(result.status).toBe("unknown");
    expect(calls.some((url) => url.includes("/sendMail"))).toBe(false);
  });

  it("reutiliza el token entre envíos", async () => {
    const { fn, calls } = graphFetch();

    await sendPilot(
      db as unknown as D1Database,
      env,
      task,
      crypto.randomUUID(),
      fn,
    );
    await sendPilot(
      db as unknown as D1Database,
      env,
      task,
      crypto.randomUUID(),
      fn,
    );

    expect(calls.filter((url) => url.includes("/oauth2/v2.0/token"))).toHaveLength(
      1,
    );
    expect(calls.filter((url) => url.includes("/sendMail"))).toHaveLength(2);
  });
});
