import { env } from "cloudflare:workers";
import { draftPilot, pilotConfig, sendPilot } from "../mail-pilot";

export const dynamic = "force-dynamic";

const result = (id: unknown, value: unknown) =>
  Response.json(
    { jsonrpc: "2.0", id, result: value },
    { headers: { "Cache-Control": "no-store" } },
  );

const failure = (id: unknown, message: string) =>
  result(id, { content: [{ type: "text", text: message }], isError: true });

function configuredOwner(): string {
  return String((env as any).MCP_OWNER_EMAIL || "").trim().toLowerCase();
}

// El piloto solo permite avisos explícitamente confirmados a la cuenta
// configurada en MAIL_PILOT_RECIPIENT.
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const id = body?.id ?? null;
  if (body?.method === "server/discover") {
    return result(id, {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
    });
  }
  if (body?.method === "initialize") {
    return result(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "arpoli-piloto", version: "1.0.0" },
    });
  }
  if (body?.method === "tools/list") {
    return result(id, {
      tools: [
        {
          name: "consultar_tareas_prueba",
          description:
            "Consulta las tareas asignadas a la cuenta configurada para el piloto. No modifica ni envía nada.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "preparar_aviso_prueba",
          description: "Prepara un aviso para revisión. No envía correos.",
          inputSchema: {
            type: "object",
            properties: { task_id: { type: "integer" } },
            required: ["task_id"],
            additionalProperties: false,
          },
        },
        {
          name: "enviar_aviso_prueba_confirmado",
          description:
            "Envía un único aviso a la cuenta configurada en MAIL_PILOT_RECIPIENT. Úsalo solo tras mostrar el borrador y recibir confirmación explícita. Nunca ejecutar automáticamente.",
          inputSchema: {
            type: "object",
            properties: {
              task_id: { type: "integer" },
              request_id: {
                type: "string",
                description: "UUID v4 único para evitar duplicados",
              },
              confirmacion: { type: "boolean" },
            },
            required: ["task_id", "request_id", "confirmacion"],
            additionalProperties: false,
          },
        },
      ],
    });
  }
  if (body?.method !== "tools/call") return failure(id, "Operación no disponible");

  const email = request.headers.get("oai-authenticated-user-email")?.toLowerCase();
  const userId = request.headers.get("oai-authenticated-user-id");
  const owner = configuredOwner();
  if (!userId || !owner || email !== owner) {
    return failure(id, "Sin autorización para esta prueba");
  }

  try {
    if (!env.DB) return failure(id, "Base de datos no disponible");
    const config = pilotConfig(env);
    const name = body?.params?.name;

    if (name === "consultar_tareas_prueba") {
      const rows = await env.DB.prepare(
        "SELECT id,title,due,status FROM tasks WHERE assignee = ? ORDER BY due LIMIT 50",
      )
        .bind(config.recipient)
        .all();
      return result(id, {
        content: [{ type: "text", text: JSON.stringify({ tasks: rows.results }) }],
      });
    }

    if (
      name !== "preparar_aviso_prueba" &&
      name !== "enviar_aviso_prueba_confirmado"
    ) {
      return failure(id, "Operación no disponible");
    }

    const args = body?.params?.arguments || {};
    if (!Number.isSafeInteger(args.task_id) || args.task_id < 1) {
      return failure(id, "Tarea inválida");
    }

    const task: any = await env.DB.prepare(
      "SELECT id,title,due,status,assignee FROM tasks WHERE id=? AND assignee=?",
    )
      .bind(args.task_id, config.recipient)
      .first();
    if (!task) return failure(id, "Tarea no disponible para la prueba");

    if (name === "preparar_aviso_prueba") {
      return result(id, {
        content: [{ type: "text", text: JSON.stringify(draftPilot(task, config)) }],
      });
    }

    if (args.confirmacion !== true) {
      return failure(id, "Primero revisa y confirma el aviso");
    }

    const answer = await sendPilot(
      env.DB,
      env,
      task,
      String(args.request_id || ""),
    );
    return result(id, {
      content: [{ type: "text", text: JSON.stringify(answer) }],
    });
  } catch {
    return failure(id, "No fue posible consultar las tareas de prueba");
  }
}
