import { randomUUID } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import {
  decodeJwt,
  decodeSession,
  decodeToken,
  encodeToken,
  loadConfig,
  parseCookies,
  safeReturnTo,
  serializeCookie,
  sessionCookieName,
  stateCookieName,
  validateClaims,
} from "./auth-lib.mjs";

const SESSION_MAX_AGE = 8 * 60 * 60;

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

function addCookie(response, value) {
  const previous = response.getHeader("Set-Cookie");
  const cookies = previous
    ? Array.isArray(previous)
      ? previous
      : [String(previous)]
    : [];
  cookies.push(value);
  response.setHeader("Set-Cookie", cookies);
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

/**
 * Crea el proxy HTTP. En modo Microsoft exige login de Entra ID; en modo demo
 * inyecta una identidad ficticia. Exportado para poder probarlo con un
 * proveedor de identidad falso.
 */
export function createAuthProxy({ config, upstreamUrl }) {
  const upstream = new URL(upstreamUrl);
  const microsoft = config.microsoft;
  const secureCookies = Boolean(microsoft?.secureCookies);

  function cookieHeader(name, value, maxAge) {
    return serializeCookie(name, value, maxAge, secureCookies);
  }

  function handleSignIn(response, url) {
    if (!microsoft) return redirect(response, "/");

    const returnTo = safeReturnTo(url.searchParams.get("return_to"));
    const state = randomUUID();
    addCookie(
      response,
      cookieHeader(
        stateCookieName(),
        encodeToken(
          { state, returnTo, exp: Date.now() + 10 * 60 * 1000 },
          microsoft.sessionSecret,
        ),
        600,
      ),
    );

    const authorize = new URL(
      `${microsoft.loginBaseUrl}/${encodeURIComponent(microsoft.tenantId)}/oauth2/v2.0/authorize`,
    );
    authorize.searchParams.set("client_id", microsoft.clientId);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("redirect_uri", microsoft.redirectUri);
    authorize.searchParams.set("response_mode", "query");
    authorize.searchParams.set("scope", "openid profile email");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("prompt", "select_account");
    redirect(response, authorize.toString());
  }

  async function handleCallback(request, response, url) {
    if (!microsoft) return redirect(response, "/");

    const state = decodeToken(
      parseCookies(request.headers.cookie).get(stateCookieName()),
      microsoft.sessionSecret,
    );
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
        `${microsoft.loginBaseUrl}/${encodeURIComponent(microsoft.tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: microsoft.clientId,
            client_secret: microsoft.clientSecret,
            code,
            redirect_uri: microsoft.redirectUri,
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

    const validation = validateClaims(
      decodeJwt(tokenPayload.id_token),
      microsoft,
    );
    if (!validation.ok) {
      if (validation.reason === "domain") {
        return text(
          response,
          403,
          "Esta cuenta no pertenece al dominio permitido.",
        );
      }
      return text(response, 401, "Token de Microsoft inválido.");
    }

    addCookie(response, cookieHeader(stateCookieName(), "", 0));
    addCookie(
      response,
      cookieHeader(
        sessionCookieName(),
        encodeToken(
          {
            ...validation.identity,
            exp: Date.now() + SESSION_MAX_AGE * 1000,
          },
          microsoft.sessionSecret,
        ),
        SESSION_MAX_AGE,
      ),
    );
    return redirect(response, safeReturnTo(state.returnTo));
  }

  function handleSignOut(response) {
    addCookie(response, cookieHeader(sessionCookieName(), "", 0));
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
        for (const [name, value] of Object.entries(
          upstreamResponse.headers,
        )) {
          if (hopByHop.has(name)) continue;
          responseHeaders[name] = value;
        }
        response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
        upstreamResponse.pipe(response);
      },
    );

    proxied.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, {
          "Content-Type": "text/plain; charset=utf-8",
        });
      }
      response.end(`No se pudo contactar al Worker: ${error.message}`);
    });

    request.pipe(proxied);
  }

  return http.createServer((request, response) => {
    let url;
    try {
      url = new URL(
        request.url || "/",
        `http://${request.headers.host || "localhost"}`,
      );
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

    if (microsoft) {
      const session = decodeSession(
        parseCookies(request.headers.cookie).get(sessionCookieName()),
        microsoft.sessionSecret,
      );
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

    return proxy(request, response, config.demo);
  });
}

const isMain =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`[arpoli] ${error.message}`);
    process.exit(1);
  }

  const server = createAuthProxy({
    config,
    upstreamUrl: config.upstreamUrl,
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`[arpoli] Proxy de autenticación escuchando en :${config.port}`);
    if (config.microsoft) {
      console.log(
        `[arpoli] Login con Microsoft Entra ID (${config.microsoft.allowedDomain ? `solo @${config.microsoft.allowedDomain}` : "cualquier cuenta Microsoft"})`,
      );
    } else {
      console.log(`[arpoli] Modo demo: identidad inyectada ${config.demo.email}`);
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
}
