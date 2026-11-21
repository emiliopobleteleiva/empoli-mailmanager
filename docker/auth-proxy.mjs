import crypto from "node:crypto";
import http from "node:http";

// Proxy local que entrega identidad al Worker. En producción la identidad la
// inyecta ChatGPT Sites; en autohospedaje la inyecta este proxy, ya sea con un
// usuario demo (desarrollo) o con un login real de Microsoft Entra ID.
const port = Number(process.env.PORT || 3000);
const upstream = new URL(process.env.WORKER_URL || "http://127.0.0.1:8787");
const demoEmail = (process.env.DEMO_USER_EMAIL || "ana.torres@example.com")
  .trim()
  .toLowerCase();
const demoName = process.env.DEMO_USER_NAME || "Ana Torres";
const demoId = process.env.DEMO_USER_ID || "local-demo-user";

function read(name) {
  return typeof process.env[name] === "string" ? process.env[name].trim() : "";
}

const tenantId = read("MS_TENANT_ID");
const clientId = read("MS_CLIENT_ID");
const clientSecret = read("MS_CLIENT_SECRET");
const sessionSecret = read("SESSION_SECRET");
const redirectUri = read("MS_REDIRECT_URI") || `http://localhost:${port}/auth/callback`;
const allowedDomain = read("ALLOWED_EMAIL_DOMAIN").toLowerCase();
const sessionMaxAge = 8 * 60 * 60;
const secureCookies = redirectUri.startsWith("https://");

const configured = [tenantId, clientId, clientSecret, sessionSecret].filter(Boolean).length;
if (configured !== 0 && configured !== 4) {
  console.error(
    "[arpoli] Configuración de Microsoft incompleta: define MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET y SESSION_SECRET, o ninguna para modo demo.",
  );
  process.exit(1);
}
const microsoftMode = configured === 4;

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function sign(body) {
  return crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
}

function encode(value) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(raw) {
  if (typeof raw !== "string") return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.email || !Number.isFinite(payload.exp) || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function decodeJwt(token) {
  try {
    const [, payload] = String(token).split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function cookies(request) {
  const result = new Map();
  for (const part of String(request.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    result.set(
      part.slice(0, index).trim(),
      decodeURIComponent(part.slice(index + 1).trim()),
    );
  }
  return result;
}

function addCookie(response, cookie) {
  const previous = response.getHeader("Set-Cookie");
  const values = previous
    ? Array.isArray(previous)
      ? previous
      : [String(previous)]
    : [];
  values.push(cookie);
  response.setHeader("Set-Cookie", values);
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`;
}

function safeReturnTo(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  if (value.startsWith("/auth/")) return "/";
  return value;
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function text(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(message);
}

function handleSignIn(response, url) {
  if (!microsoftMode) return redirect(response, "/");

  const returnTo = safeReturnTo(url.searchParams.get("return_to"));
  const state = crypto.randomUUID();
  addCookie(
    response,
    cookie(
      "arpoli_oauth_state",
      encode({ state, returnTo, exp: Date.now() + 10 * 60 * 1000 }),
      600,
    ),
  );

  const authorize = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`,
  );
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_mode", "query");
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "select_account");
  redirect(response, authorize.toString());
}

async function handleCallback(request, response, url) {
  if (!microsoftMode) return redirect(response, "/");

  const state = decode(cookies(request).get("arpoli_oauth_state"));
  const receivedState = url.searchParams.get("state");
  if (!state || !receivedState || state.state !== receivedState) {
    return text(response, 400, "Estado OAuth inválido. Inicia sesión nuevamente.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return text(response, 400, "Microsoft no entregó un código de autorización.");
  }

  let tokenResponse;
  try {
    tokenResponse = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          scope: "openid profile email",
        }),
      },
    );
  } catch {
    return text(response, 502, "No se pudo contactar a Microsoft.");
  }
  if (!tokenResponse.ok) {
    return text(response, 401, "Microsoft rechazó el inicio de sesión.");
  }

  let tokenPayload;
  try {
    tokenPayload = await tokenResponse.json();
  } catch {
    return text(response, 502, "Respuesta inválida de Microsoft.");
  }

  const claims = decodeJwt(tokenPayload.id_token);
  const issuer = String(claims?.iss || "");
  if (
    !claims ||
    claims.aud !== clientId ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 < Date.now() ||
    !issuer.startsWith("https://login.microsoftonline.com/")
  ) {
    return text(response, 401, "Token de Microsoft inválido.");
  }

  const email = String(
    claims.email || claims.preferred_username || claims.upn || "",
  )
    .trim()
    .toLowerCase();
  if (!email) {
    return text(response, 401, "La cuenta de Microsoft no expone un correo.");
  }
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return text(response, 403, "Esta cuenta no pertenece al dominio permitido.");
  }

  addCookie(response, cookie("arpoli_oauth_state", "", 0));
  addCookie(
    response,
    cookie(
      "arpoli_session",
      encode({
        email,
        name: String(claims.name || email),
        id: String(claims.oid || claims.sub || email),
        exp: Date.now() + sessionMaxAge * 1000,
      }),
      sessionMaxAge,
    ),
  );
  return redirect(response, safeReturnTo(state.returnTo));
}

function handleSignOut(response) {
  addCookie(response, cookie("arpoli_session", "", 0));
  redirect(response, "/");
}

function proxy(request, response, identity) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (hopByHop.has(name)) continue;
    if (name.startsWith("oai-authenticated-user-")) continue;
    headers[name] = value;
  }
  if (identity) {
    headers["oai-authenticated-user-id"] = identity.id;
    headers["oai-authenticated-user-email"] = identity.email;
    headers["oai-authenticated-user-full-name"] = encodeURIComponent(
      identity.name || identity.email,
    );
    headers["oai-authenticated-user-full-name-encoding"] =
      "percent-encoded-utf-8";
  }

  const proxied = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = {};
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (hopByHop.has(name)) continue;
        responseHeaders[name] = value;
      }
      response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );

  proxied.on("error", (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    response.end(`No se pudo contactar al Worker: ${error.message}`);
  });

  request.pipe(proxied);
}

const server = http.createServer((request, response) => {
  let url;
  try {
    url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  } catch {
    return text(response, 400, "Solicitud inválida");
  }

  if (url.pathname === "/auth/signin") return handleSignIn(response, url);
  if (url.pathname === "/auth/callback") {
    return void handleCallback(request, response, url).catch(() =>
      text(response, 500, "No se pudo completar el inicio de sesión."),
    );
  }
  if (url.pathname === "/auth/signout") return handleSignOut(response);

  if (microsoftMode) {
    const session = decode(cookies(request).get("arpoli_session"));
    const isAsset =
      url.pathname.startsWith("/_next/") ||
      url.pathname === "/favicon.svg" ||
      url.pathname === "/favicon.ico";
    if (!session) {
      if (isAsset) return proxy(request, response, null);
      if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
        return text(response, 401, "No autenticado");
      }
      const returnTo = `${url.pathname}${url.search}`;
      return redirect(
        response,
        `/auth/signin?return_to=${encodeURIComponent(returnTo)}`,
      );
    }
    return proxy(request, response, session);
  }

  return proxy(request, response, {
    email: demoEmail,
    name: demoName,
    id: demoId,
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[arpoli] Proxy de autenticación escuchando en :${port}`);
  if (microsoftMode) {
    console.log(
      `[arpoli] Login con Microsoft Entra ID (${allowedDomain ? `solo @${allowedDomain}` : "cualquier cuenta Microsoft"})`,
    );
  } else {
    console.log(`[arpoli] Modo demo: identidad inyectada ${demoEmail}`);
    console.log(
      "[arpoli] Para login real define MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET y SESSION_SECRET.",
    );
  }
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
