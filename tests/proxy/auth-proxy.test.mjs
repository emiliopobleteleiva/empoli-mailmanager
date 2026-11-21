// @vitest-environment node
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthProxy } from "../../docker/auth-proxy.mjs";
import {
  decodeToken,
  encodeToken,
  sessionCookieName,
  stateCookieName,
} from "../../docker/auth-lib.mjs";

const SESSION_SECRET = "session-secret";
const DEMO = { email: "demo@example.com", name: "Demo User", id: "demo-id" };

let upstream;
let idp;
let proxy;
let upstreamUrl;
let idpUrl;
let proxyUrl;
let idpState;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function stop(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

function setCookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
}

function cookiePair(value) {
  return value.split(";")[0];
}

function idToken(claims) {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.firma`;
}

function validClaims(overrides = {}) {
  return {
    aud: "client-id",
    iss: `${idpUrl}/tenant-id/v2.0`,
    exp: Math.floor(Date.now() / 1000) + 60,
    email: "ana@example.com",
    name: "Ana Torres",
    oid: "oid-1",
    ...overrides,
  };
}

function makeUpstream() {
  return http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ url: request.url, headers: request.headers }),
    );
  });
}

function makeIdp() {
  return http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(idpState.status, {
        "content-type": "application/json",
      });
      response.end(
        idpState.raw !== undefined
          ? idpState.raw
          : JSON.stringify(idpState.payload),
      );
    });
  });
}

function get(path, init = {}) {
  return fetch(`${proxyUrl}${path}`, { redirect: "manual", ...init });
}

async function signIn(returnTo = "/") {
  const response = await get(
    `/auth/signin?return_to=${encodeURIComponent(returnTo)}`,
  );
  const stateCookie = setCookies(response).find((value) =>
    value.startsWith(`${stateCookieName()}=`),
  );
  const location = new URL(response.headers.get("location"));
  return {
    response,
    state: location.searchParams.get("state"),
    stateCookie: cookiePair(stateCookie),
    location,
  };
}

function callback(state, cookie, code = "code-1") {
  return get(
    `/auth/callback?code=${code}&state=${encodeURIComponent(state)}`,
    { headers: { cookie } },
  );
}

beforeEach(async () => {
  idpState = { status: 200, payload: {}, raw: undefined };

  upstream = makeUpstream();
  upstreamUrl = `http://127.0.0.1:${await listen(upstream)}`;

  idp = makeIdp();
  idpUrl = `http://127.0.0.1:${await listen(idp)}`;
  idpState.payload = { id_token: idToken(validClaims()) };

  proxy = createAuthProxy({
    config: {
      demo: DEMO,
      microsoft: {
        tenantId: "tenant-id",
        clientId: "client-id",
        clientSecret: "client-secret",
        sessionSecret: SESSION_SECRET,
        redirectUri: "http://localhost:3000/auth/callback",
        allowedDomain: "example.com",
        loginBaseUrl: idpUrl,
        secureCookies: false,
      },
    },
    upstreamUrl,
  });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});

afterEach(async () => {
  await stop(proxy);
  await stop(idp);
  await stop(upstream);
});

describe("modo demo", () => {
  it("inyecta la identidad ficticia en todas las peticiones", async () => {
    const demoProxy = createAuthProxy({
      config: { demo: DEMO, microsoft: null },
      upstreamUrl,
    });
    const port = await listen(demoProxy);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/hola?x=1`);
      const body = await response.json();
      expect(body.url).toBe("/hola?x=1");
      expect(body.headers["oai-authenticated-user-email"]).toBe(DEMO.email);
      expect(body.headers["oai-authenticated-user-id"]).toBe(DEMO.id);
      expect(body.headers["oai-authenticated-user-full-name"]).toBe(
        encodeURIComponent(DEMO.name),
      );

      const signIn = await fetch(
        `http://127.0.0.1:${port}/auth/signin`,
        { redirect: "manual" },
      );
      expect(signIn.status).toBe(302);
      expect(signIn.headers.get("location")).toBe("/");

      const callback = await fetch(
        `http://127.0.0.1:${port}/auth/callback?code=x&state=y`,
        { redirect: "manual" },
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe("/");
    } finally {
      await stop(demoProxy);
    }
  });
});

describe("proxy con Microsoft Entra ID", () => {
  it("redirige la navegación y responde 401 en APIs", async () => {
    const navigation = await get("/pagina?x=1");
    expect(navigation.status).toBe(302);
    expect(navigation.headers.get("location")).toBe(
      "/auth/signin?return_to=%2Fpagina%3Fx%3D1",
    );

    expect((await get("/api/data")).status).toBe(401);
    expect((await get("/mcp")).status).toBe(401);
  });

  it("deja pasar assets sin identidad", async () => {
    const response = await get("/_next/static/app.js");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.headers["oai-authenticated-user-email"]).toBeUndefined();
  });

  it("arma el redirect a Microsoft con state y cookie", async () => {
    const { response, location, stateCookie } = await signIn("/tareas?x=1");

    expect(response.status).toBe(302);
    expect(location.origin).toBe(idpUrl);
    expect(location.pathname).toBe(
      "/tenant-id/oauth2/v2.0/authorize",
    );
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/callback",
    );
    expect(location.searchParams.get("scope")).toBe("openid profile email");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(stateCookie.startsWith(`${stateCookieName()}=`)).toBe(true);
  });

  it("normaliza return_to peligrosos", async () => {
    const { stateCookie } = await signIn("//evil.example");
    const raw = stateCookie.slice(`${stateCookieName()}=`.length);
    const payload = decodeToken(decodeURIComponent(raw), SESSION_SECRET);
    expect(payload?.returnTo).toBe("/");
  });

  it("rechaza state ausente o distinto", async () => {
    const { stateCookie } = await signIn("/");
    expect((await callback("otro-state", stateCookie)).status).toBe(400);
    expect((await get("/auth/callback?code=abc")).status).toBe(400);
  });

  it("rechaza callback sin código", async () => {
    const { state, stateCookie } = await signIn("/");
    const response = await get(
      `/auth/callback?state=${encodeURIComponent(state)}`,
      { headers: { cookie: stateCookie } },
    );
    expect(response.status).toBe(400);
  });

  it("crea la sesión y entrega la identidad al Worker", async () => {
    const { state, stateCookie } = await signIn("/pagina");
    const response = await callback(state, stateCookie);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/pagina");
    const session = setCookies(response).find((value) =>
      value.startsWith(`${sessionCookieName()}=`),
    );
    expect(session).toBeTruthy();

    const authorized = await get("/pagina", {
      headers: { cookie: cookiePair(session) },
    });
    const body = await authorized.json();
    expect(body.headers["oai-authenticated-user-email"]).toBe(
      "ana@example.com",
    );
    expect(body.headers["oai-authenticated-user-id"]).toBe("oid-1");
    expect(body.headers["oai-authenticated-user-full-name"]).toBe(
      encodeURIComponent("Ana Torres"),
    );
  });

  it("rechaza cuentas de otro dominio", async () => {
    idpState.payload = {
      id_token: idToken(validClaims({ email: "ana@other.com" })),
    };
    const { state, stateCookie } = await signIn("/");
    const response = await callback(state, stateCookie);
    expect(response.status).toBe(403);
  });

  it("rechaza tokens con audiencia o expiración inválidas", async () => {
    const { state, stateCookie } = await signIn("/");

    idpState.payload = { id_token: idToken(validClaims({ aud: "otra-app" })) };
    expect((await callback(state, stateCookie)).status).toBe(401);

    idpState.payload = {
      id_token: idToken(
        validClaims({ exp: Math.floor(Date.now() / 1000) - 10 }),
      ),
    };
    expect((await callback(state, stateCookie)).status).toBe(401);
  });

  it("rechaza respuestas inválidas de Microsoft", async () => {
    const { state, stateCookie } = await signIn("/");

    idpState.status = 500;
    expect((await callback(state, stateCookie)).status).toBe(401);

    idpState.status = 200;
    idpState.payload = {};
    expect((await callback(state, stateCookie)).status).toBe(401);
  });

  it("ignora cookies de sesión manipuladas o vencidas", async () => {
    const { state, stateCookie } = await signIn("/");
    const response = await callback(state, stateCookie);
    const session = cookiePair(
      setCookies(response).find((value) =>
        value.startsWith(`${sessionCookieName()}=`),
      ),
    );

    const tampered = `${session}x`;
    const redirected = await get("/pagina", { headers: { cookie: tampered } });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toContain("/auth/signin");

    const expired = `${sessionCookieName()}=${encodeToken(
      {
        email: "ana@example.com",
        name: "Ana",
        id: "oid-1",
        exp: Date.now() - 1000,
      },
      SESSION_SECRET,
    )}`;
    const expiredResponse = await get("/api/data", {
      headers: { cookie: expired },
    });
    expect(expiredResponse.status).toBe(401);
  });

  it("responde 502 si Microsoft no responde", async () => {
    const { state, stateCookie } = await signIn("/");
    await stop(idp);
    expect((await callback(state, stateCookie)).status).toBe(502);
  });

  it("responde 502 si Microsoft devuelve algo inválido", async () => {
    idpState.raw = "<html>error</html>";
    const { state, stateCookie } = await signIn("/");
    expect((await callback(state, stateCookie)).status).toBe(502);
  });

  it("responde 502 si el Worker no está disponible", async () => {
    const deadProxy = createAuthProxy({
      config: { demo: DEMO, microsoft: null },
      upstreamUrl: "http://127.0.0.1:1",
    });
    const port = await listen(deadProxy);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(response.status).toBe(502);
    } finally {
      await stop(deadProxy);
    }
  });

  it("cierra la sesión", async () => {
    const response = await get("/auth/signout");
    expect(response.status).toBe(302);
    expect(
      setCookies(response).some(
        (value) =>
          value.startsWith(`${sessionCookieName()}=`) &&
          value.includes("Max-Age=0"),
      ),
    ).toBe(true);
  });
});
