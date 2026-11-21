import { sendGraphMail, type MailResult } from "../lib/graph-mail";

type Task = { id: number; title: string; due: string; status: string; assignee: string };

export type PilotConfig = { recipient: string; sender: string };

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function pilotConfig(env: unknown): PilotConfig {
  const record = (env ?? {}) as Record<string, unknown>;
  const recipient =
    typeof record.MAIL_PILOT_RECIPIENT === "string"
      ? record.MAIL_PILOT_RECIPIENT.trim().toLowerCase()
      : "";
  const sender =
    typeof record.MAIL_PILOT_SENDER === "string"
      ? record.MAIL_PILOT_SENDER.trim()
      : "";
  if (!recipient || !sender) {
    throw new Error(
      "Falta configurar MAIL_PILOT_RECIPIENT y MAIL_PILOT_SENDER para el piloto de correo.",
    );
  }
  return { recipient, sender };
}

export function draftPilot(task: Task, config: PilotConfig) {
  if (task.assignee.toLowerCase() !== config.recipient) {
    throw new Error("La tarea no pertenece a la cuenta de prueba");
  }
  return {
    recipient: config.recipient,
    sender: config.sender,
    subject: "Arpoli Gestión · Aviso de prueba",
    text: `Hola:\n\nEste es un aviso de prueba para la tarea «${task.title}».\nFecha: ${task.due}.\n\nArpoli Gestión`,
  };
}

/**
 * Reserva el aviso en D1 antes de enviarlo, para que un reintento con el mismo
 * identificador no duplique correos. El envío real usa Microsoft Graph
 * (Outlook/Microsoft 365).
 */
export async function sendPilot(
  db: D1Database,
  env: unknown,
  task: Task,
  requestId: string,
  send: typeof fetch = fetch,
): Promise<MailResult> {
  const config = pilotConfig(env);
  const draft = draftPilot(task, config);
  if (!uuidV4.test(requestId)) throw new Error("Identificador inválido");

  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        "INSERT INTO pilot_notices(id,task_id,recipient,status,created,updated) VALUES(?,?,?,'sending',?,?)",
      )
      .bind(requestId, task.id, config.recipient, now, now)
      .run();
  } catch {
    throw new Error("La solicitud ya existe o no fue posible registrar el intento");
  }

  let result: MailResult;
  try {
    result = await sendGraphMail(
      env,
      { to: draft.recipient, subject: draft.subject, text: draft.text },
      send,
    );
  } catch {
    result = {
      status: "unknown",
      message: "No se pudo confirmar el resultado; revisa Outlook antes de repetir.",
      providerId: null,
    };
  }

  await db
    .prepare(
      "UPDATE pilot_notices SET status=?,updated=?,provider_id=? WHERE id=?",
    )
    .bind(result.status, new Date().toISOString(), result.providerId, requestId)
    .run();

  return result;
}
