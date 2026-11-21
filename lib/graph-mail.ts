export type MailStatus = "accepted" | "rejected" | "unknown";

export type MailResult = {
  status: MailStatus;
  message: string;
  providerId: string | null;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
};

type TokenCache = { token: string; expiresAt: number };

let cachedToken: TokenCache | null = null;

function readString(env: unknown, key: string): string {
  const record = (env ?? {}) as Record<string, unknown>;
  return typeof record[key] === "string" ? String(record[key]).trim() : "";
}

export function graphConfig(env: unknown): GraphConfig | null {
  const tenantId = readString(env, "MS_TENANT_ID");
  const clientId = readString(env, "MS_CLIENT_ID");
  const clientSecret = readString(env, "MS_CLIENT_SECRET");
  const sender = readString(env, "MAIL_PILOT_SENDER");
  if (!tenantId || !clientId || !clientSecret || !sender) return null;
  return { tenantId, clientId, clientSecret, sender };
}

export function resetGraphTokenCache() {
  cachedToken = null;
}

async function accessToken(
  config: GraphConfig,
  send: typeof fetch,
): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  let response: Response;
  try {
    response = await send(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!token) return null;

  const expiresIn = Number(payload.expires_in);
  const lifetime = Number.isFinite(expiresIn) && expiresIn > 120 ? expiresIn : 3600;
  cachedToken = {
    token,
    expiresAt: Date.now() + (lifetime - 60) * 1000,
  };
  return token;
}

/**
 * Envía correo con Microsoft Graph usando permisos de aplicación
 * (`Mail.Send`) sobre el buzón `MAIL_PILOT_SENDER`.
 */
export async function sendGraphMail(
  env: unknown,
  message: MailMessage,
  send: typeof fetch = fetch,
): Promise<MailResult> {
  const config = graphConfig(env);
  if (!config) {
    throw new Error(
      "Microsoft Graph no está configurado: define MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET y MAIL_PILOT_SENDER.",
    );
  }

  const token = await accessToken(config, send);
  if (!token) {
    return {
      status: "unknown",
      message: "No se pudo autenticar con Microsoft Graph; revisa la app de Entra ID.",
      providerId: null,
    };
  }

  let response: Response;
  try {
    response = await send(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: "Text", content: message.text },
            toRecipients: [{ emailAddress: { address: message.to } }],
          },
          saveToSentItems: false,
        }),
      },
    );
  } catch {
    return {
      status: "unknown",
      message: "No se pudo confirmar el envío con Microsoft Graph; revisa Outlook antes de repetir.",
      providerId: null,
    };
  }

  // Graph responde 202 Accepted y no entrega un id de mensaje en este endpoint.
  if (response.status === 202) {
    return {
      status: "accepted",
      message: "Microsoft aceptó el mensaje; la entrega al buzón aún no está confirmada.",
      providerId: null,
    };
  }
  if (response.status === 429 || response.status >= 500) {
    return {
      status: "unknown",
      message: "Microsoft no confirmó el envío; revisa Outlook antes de repetir.",
      providerId: null,
    };
  }
  return {
    status: "rejected",
    message: "Microsoft rechazó el envío; revisa los permisos Mail.Send y el buzón remitente.",
    providerId: null,
  };
}
