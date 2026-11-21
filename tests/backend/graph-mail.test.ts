// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  graphConfig,
  resetGraphTokenCache,
  sendGraphMail,
} from "../../lib/graph-mail";

const env = {
  MS_TENANT_ID: "tenant-id",
  MS_CLIENT_ID: "client-id",
  MS_CLIENT_SECRET: "client-secret",
  MAIL_PILOT_SENDER: "no-reply@example.com",
};

const message = {
  to: "pilot@example.com",
  subject: "Aviso",
  text: "Hola",
};

function graphFetch(options: { tokenStatus?: number; sendStatus?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/oauth2/v2.0/token")) {
      const status = options.tokenStatus ?? 200;
      return {
        ok: status < 400,
        status,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      };
    }
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
  resetGraphTokenCache();
});

describe("graphConfig", () => {
  it("devuelve null si falta configuración", () => {
    expect(graphConfig({})).toBeNull();
  });

  it("lee la configuración completa", () => {
    expect(graphConfig(env)).toEqual({
      tenantId: "tenant-id",
      clientId: "client-id",
      clientSecret: "client-secret",
      sender: "no-reply@example.com",
    });
  });
});

describe("sendGraphMail", () => {
  it("falla si Microsoft Graph no está configurado", async () => {
    await expect(sendGraphMail({}, message)).rejects.toThrow(/Graph/);
  });

  it("considera aceptado un 202 y arma el mensaje correcto", async () => {
    const { fn, calls } = graphFetch();
    const result = await sendGraphMail(env, message, fn);

    expect(result.status).toBe("accepted");
    const send = calls.find((call) => call.url.includes("/sendMail"));
    expect(send?.url).toContain("/users/no-reply%40example.com/sendMail");
    const body = JSON.parse(String(send?.init?.body));
    expect(body.message.toRecipients[0].emailAddress.address).toBe(
      "pilot@example.com",
    );
    expect(body.message.body.content).toBe("Hola");
    expect(body.saveToSentItems).toBe(false);
  });

  it("considera rechazado un 4xx", async () => {
    const { fn } = graphFetch({ sendStatus: 403 });
    const result = await sendGraphMail(env, message, fn);
    expect(result.status).toBe("rejected");
  });

  it("considera desconocido un 5xx", async () => {
    const { fn } = graphFetch({ sendStatus: 503 });
    const result = await sendGraphMail(env, message, fn);
    expect(result.status).toBe("unknown");
  });

  it("considera desconocido si falla el token", async () => {
    const { fn, calls } = graphFetch({ tokenStatus: 400 });
    const result = await sendGraphMail(env, message, fn);
    expect(result.status).toBe("unknown");
    expect(calls.some((call) => call.url.includes("/sendMail"))).toBe(false);
  });

  it("reutiliza el token cacheado", async () => {
    const { fn, calls } = graphFetch();
    await sendGraphMail(env, message, fn);
    await sendGraphMail(env, message, fn);
    expect(
      calls.filter((call) => call.url.includes("/oauth2/v2.0/token")),
    ).toHaveLength(1);
  });
});
