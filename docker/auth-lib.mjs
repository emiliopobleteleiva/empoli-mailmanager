import crypto from "node:crypto";

export function readEnv(env, name) {
  const value = env?.[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lee la configuración desde variables de entorno. Falla en cerrado si la
 * configuración de Microsoft está incompleta, para no caer en modo demo por
 * accidente en producción.
 */
export function loadConfig(env = process.env) {
  const tenantId = readEnv(env, "MS_TENANT_ID");
  const clientId = readEnv(env, "MS_CLIENT_ID");
  const clientSecret = readEnv(env, "MS_CLIENT_SECRET");
  const sessionSecret = readEnv(env, "SESSION_SECRET");
  const allowedDomain = readEnv(env, "ALLOWED_EMAIL_DOMAIN").toLowerCase();
  const loginBaseUrl = (
    readEnv(env, "MS_LOGIN_BASE_URL") || "https://login.microsoftonline.com"
  ).replace(/\/+$/, "");
  const port = Number(env.PORT || 3000);
  const redirectUri =
    readEnv(env, "MS_REDIRECT_URI") || `http://localhost:${port}/auth/callback`;

  const configured = [tenantId, clientId, clientSecret, sessionSecret].filter(
    Boolean,
  ).length;
  if (configured !== 0 && configured !== 4) {
    throw new Error(
      "Configuración de Microsoft incompleta: define MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET y SESSION_SECRET, o ninguna para modo demo.",
    );
  }

  return {
    port,
    upstreamUrl: readEnv(env, "WORKER_URL") || "http://127.0.0.1:8787",
    demo: {
      email: (
        readEnv(env, "DEMO_USER_EMAIL") || "ana.torres@example.com"
      ).toLowerCase(),
      name: readEnv(env, "DEMO_USER_NAME") || "Ana Torres",
      id: readEnv(env, "DEMO_USER_ID") || "local-demo-user",
    },
    microsoft:
      configured === 4
        ? {
            tenantId,
            clientId,
            clientSecret,
            sessionSecret,
            redirectUri,
            allowedDomain,
            loginBaseUrl,
            secureCookies: redirectUri.startsWith("https://"),
          }
        : null,
  };
}

export function signBody(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

export function encodeToken(value, secret) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${signBody(secret, body)}`;
}

export function decodeToken(raw, secret, now = Date.now()) {
  if (typeof raw !== "string") return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  const expected = signBody(secret, body);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Number.isFinite(payload?.exp) || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Igual que decodeToken, pero exige que sea una sesión con correo. */
export function decodeSession(raw, secret, now = Date.now()) {
  const payload = decodeToken(raw, secret, now);
  return payload?.email ? payload : null;
}

export function safeReturnTo(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }
  if (value.startsWith("/auth/")) return "/";
  return value;
}

export function parseCookies(header) {
  const result = new Map();
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    try {
      result.set(
        part.slice(0, index).trim(),
        decodeURIComponent(part.slice(index + 1).trim()),
      );
    } catch {
      // Ignora cookies mal codificadas.
    }
  }
  return result;
}

export function serializeCookie(name, value, maxAge, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function decodeJwt(token) {
  try {
    const [, payload] = String(token).split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Valida lo mínimo del id_token de Microsoft: aplicación, emisor, vencimiento
 * y correo. La firma no se verifica acá porque el token se obtuvo directamente
 * del endpoint de token por TLS en esta misma petición.
 */
export function validateClaims(claims, microsoft, now = Date.now()) {
  if (!claims || typeof claims !== "object") {
    return { ok: false, reason: "token" };
  }
  const issuer = String(claims.iss || "");
  if (
    claims.aud !== microsoft.clientId ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 < now ||
    !issuer.startsWith(`${microsoft.loginBaseUrl}/`)
  ) {
    return { ok: false, reason: "token" };
  }

  const email = String(
    claims.email || claims.preferred_username || claims.upn || "",
  )
    .trim()
    .toLowerCase();
  if (!email) return { ok: false, reason: "email" };
  if (
    microsoft.allowedDomain &&
    !email.endsWith(`@${microsoft.allowedDomain}`)
  ) {
    return { ok: false, reason: "domain" };
  }

  return {
    ok: true,
    identity: {
      email,
      name: String(claims.name || email),
      id: String(claims.oid || claims.sub || email),
    },
  };
}

export function stateCookieName() {
  return "arpoli_oauth_state";
}

export function sessionCookieName() {
  return "arpoli_session";
}
