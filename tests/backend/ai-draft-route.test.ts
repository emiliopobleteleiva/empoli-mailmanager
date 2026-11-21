// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/chatgpt-auth", () => ({
  getChatGPTUser: vi.fn(),
}));

import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { POST } from "../../app/api/ai-draft/route";
import { FakeDb } from "../helpers/fake-d1";

const MANAGER = "bruno.silva@example.com";
const mockedUser = vi.mocked(getChatGPTUser);
let db: FakeDb;

function signIn() {
  mockedUser.mockResolvedValue({
    userId: "test-user",
    displayName: MANAGER,
    email: MANAGER,
    fullName: null,
  });
}

function request(body: unknown) {
  return new Request("http://localhost/api/ai-draft", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    kind: "task",
    message: "Borrador listo",
    title: "Preparar informe",
    description: "",
    assignee: "Diego Fuentes",
    due: "2026-12-15",
    task_id: "",
    status: "",
    body: "",
    frequency: "none",
    ...overrides,
  };
}

function mockDraft(payload: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return (await response.json()) as T;
}

beforeEach(() => {
  db = new FakeDb();
  db.seed("people", [
    {
      email: "staff@example.com",
      name: "Diego Fuentes",
      role: "staff",
      manager: MANAGER,
    },
  ]);
  db.seed("tasks", [
    {
      id: 1,
      title: "Cotizar",
      creator: MANAGER,
      assignee: MANAGER,
      status: "pending",
      due: "2026-12-01",
      created: "2026-11-01T00:00:00.000Z",
    },
  ]);
  (env as Record<string, unknown>).DB = db;
  (env as Record<string, unknown>).OPENAI_API_KEY = "sk-test";
  mockedUser.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/ai-draft", () => {
  it("avisa cuando falta la clave", async () => {
    signIn();
    (env as Record<string, unknown>).OPENAI_API_KEY = undefined;
    const response = await POST(request({ message: "crea una tarea" }));
    expect(response.status).toBe(503);
  });

  it("valida el mensaje", async () => {
    signIn();
    const response = await POST(request({ message: "   " }));
    expect(response.status).toBe(400);
  });

  it("prepara un borrador de tarea y resuelve el responsable", async () => {
    signIn();
    mockDraft({
      output: [
        {
          content: [
            { type: "output_text", text: JSON.stringify(draft()) },
          ],
        },
      ],
    });

    const response = await POST(request({ message: "crea una tarea" }));

    expect(response.status).toBe(200);
    const payload = await json<{ draft: Record<string, unknown> }>(response);
    expect(payload.draft).toMatchObject({
      kind: "task",
      title: "Preparar informe",
      assignee: "staff@example.com",
      due: "2026-12-15",
      frequency: "none",
    });
  });

  it("resuelve el responsable y la fecha a partir del texto hablado", async () => {
    signIn();
    mockDraft({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(
                draft({ assignee: "diego", due: "no-lo-se" }),
              ),
            },
          ],
        },
      ],
    });

    const response = await POST(
      request({ message: "asigna a Diego la tarea para el 15/12/2026" }),
    );

    const payload = await json<{ draft: Record<string, unknown> }>(response);
    expect(payload.draft.assignee).toBe("staff@example.com");
    expect(payload.draft.due).toBe("2026-12-15");
  });

  it("pide aclaración si el avance apunta a una tarea no autorizada", async () => {
    signIn();
    mockDraft({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(
                draft({
                  kind: "update",
                  task_id: "999",
                  body: "avance",
                  status: "done",
                }),
              ),
            },
          ],
        },
      ],
    });

    const response = await POST(request({ message: "registra un avance" }));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      draft: { kind: "clarify" },
    });
  });

  it("responde 502 cuando OpenAI falla", async () => {
    signIn();
    mockDraft({}, 429);
    const response = await POST(request({ message: "crea una tarea" }));
    expect(response.status).toBe(502);
    expect(await json(response)).toMatchObject({
      error: expect.stringMatching(/límite|saldo/i),
    });
  });

  it("responde 500 si el borrador no es JSON válido", async () => {
    signIn();
    mockDraft({
      output: [{ content: [{ type: "output_text", text: "no-json" }] }],
    });
    const response = await POST(request({ message: "crea una tarea" }));
    expect(response.status).toBe(500);
  });

  it("rechaza un borrador con kind inválido", async () => {
    signIn();
    mockDraft({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(draft({ kind: "otra-cosa" })),
            },
          ],
        },
      ],
    });
    const response = await POST(request({ message: "crea una tarea" }));
    expect(response.status).toBe(502);
  });
});
