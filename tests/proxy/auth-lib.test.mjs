// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodeJwt,
  decodeSession,
  decodeToken,
  encodeToken,
  loadConfig,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  validateClaims,
} from "../../docker/auth-lib.mjs";

const microsoft = {
  clientId: "client-id",
  loginBaseUrl: "https://login.microsoftonline.com",
  allowedDomain: "example.com",
};

function claims(overrides = {}) {
  return {
    aud: "client-id",
    iss: "https://login.microsoftonline.com/tenant-id/v2.0",
    exp: Math.floor(Date.now() / 1000) + 60,
    email: "Ana@Example.com",
    name: "Ana Torres",
    oid: "oid-1",
    ...overrides,
  };
}

describe("loadConfig", () => {
  it("queda en modo demo si no hay configuración de Microsoft", () => {
    const config = loadConfig({});
    expect(config.microsoft).toBeNull();
    expect(config.demo.email).toBe("ana.torres@example.com");
    expect(config.port).toBe(3000);
  });

  it("falla en cerrado con configuración Microsoft incompleta", () => {
    expect(() => loadConfig({ MS_TENANT_ID: "tenant" })).toThrow(
      /Configuración de Microsoft incompleta/,
    );
  });

  it("arma la configuración completa y respeta el login base", () => {
    const config = loadConfig({
      MS_TENANT_ID: "tenant",
      MS_CLIENT_ID: "client",
      MS_CLIENT_SECRET: "secret",
      SESSION_SECRET: "session",
      MS_LOGIN_BASE_URL: "http://127.0.0.1:9999/",
      ALLOWED_EMAIL_DOMAIN: "Example.com",
      PORT: "4010",
    });
    expect(config.microsoft).toMatchObject({
      tenantId: "tenant",
      clientId: "client",
      clientSecret: "secret",
      sessionSecret: "session",
      loginBaseUrl: "http://127.0.0.1:9999",
      allowedDomain: "example.com",
      redirectUri: "http://localhost:4010/auth/callback",
      secureCookies: false,
    });
  });
});

describe("tokens firmados", () => {
  it("hace roundtrip y detecta manipulación", () => {
    const token = encodeToken({ email: "a@b.c", exp: Date.now() + 1000 }, "s");
    expect(decodeToken(token, "s")).toMatchObject({ email: "a@b.c" });
    expect(decodeToken(token, "otro")).toBeNull();
    expect(decodeToken(`${token}x`, "s")).toBeNull();
    expect(decodeToken("basura", "s")).toBeNull();
  });

  it("rechaza tokens vencidos", () => {
    const token = encodeToken(
      { email: "a@b.c", exp: Date.now() - 1000 },
      "s",
    );
    expect(decodeToken(token, "s")).toBeNull();
  });

  it("permite state sin correo pero exige correo para la sesión", () => {
    const state = encodeToken(
      { state: "uuid", returnTo: "/", exp: Date.now() + 1000 },
      "s",
    );
    expect(decodeToken(state, "s")).toMatchObject({ state: "uuid" });
    expect(decodeSession(state, "s")).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it("solo permite rutas internas", () => {
    expect(safeReturnTo("/tareas?x=1")).toBe("/tareas?x=1");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("/auth/signout")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });
});

describe("cookies", () => {
  it("parsea cookies y tolera valores mal codificados", () => {
    const cookies = parseCookies("a=1; b=hola%20mundo; mala=%E0%A4%A");
    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("b")).toBe("hola mundo");
    expect(cookies.has("mala")).toBe(false);
  });

  it("serializa con HttpOnly y Secure opcional", () => {
    expect(serializeCookie("x", "1", 60, false)).toBe(
      "x=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=60",
    );
    expect(serializeCookie("x", "1", 60, true)).toContain("; Secure");
  });
});

describe("decodeJwt", () => {
  it("devuelve null para tokens malformados", () => {
    expect(decodeJwt("no-es-jwt")).toBeNull();
    expect(decodeJwt(undefined)).toBeNull();
  });

  it("lee el payload sin verificar firma", () => {
    const token = `e30.${Buffer.from(JSON.stringify(claims())).toString("base64url")}.firma`;
    expect(decodeJwt(token)).toMatchObject({ email: "Ana@Example.com" });
  });
});

describe("validateClaims", () => {
  it("acepta un token válido y normaliza el correo", () => {
    expect(validateClaims(claims(), microsoft)).toEqual({
      ok: true,
      identity: {
        email: "ana@example.com",
        name: "Ana Torres",
        id: "oid-1",
      },
    });
  });

  it("rechaza audiencia u emisor incorrectos", () => {
    expect(validateClaims(claims({ aud: "otra-app" }), microsoft)).toEqual({
      ok: false,
      reason: "token",
    });
    expect(
      validateClaims(claims({ iss: "https://evil.example/v2.0" }), microsoft),
    ).toEqual({ ok: false, reason: "token" });
  });

  it("rechaza tokens vencidos", () => {
    expect(
      validateClaims(
        claims({ exp: Math.floor(Date.now() / 1000) - 10 }),
        microsoft,
      ),
    ).toEqual({ ok: false, reason: "token" });
  });

  it("rechaza cuentas sin correo o de otro dominio", () => {
    expect(validateClaims(claims({ email: undefined }), microsoft)).toEqual({
      ok: false,
      reason: "email",
    });
    expect(validateClaims(claims({ email: "x@other.com" }), microsoft)).toEqual({
      ok: false,
      reason: "domain",
    });
  });

  it("permite cualquier dominio si no se configuró allowlist", () => {
    const result = validateClaims(claims({ email: "x@other.com" }), {
      ...microsoft,
      allowedDomain: "",
    });
    expect(result.ok).toBe(true);
  });
});
