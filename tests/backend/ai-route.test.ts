// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/chatgpt-auth", () => ({
  getChatGPTUser: vi.fn(),
}));

import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { POST } from "../../app/api/ai/route";
import { FakeDb } from "../helpers/fake-d1";
import { FakeR2 } from "../helpers/fake-r2";

const MANAGER = "bruno.silva@example.com";
const mockedUser = vi.mocked(getChatGPTUser);
let db: FakeDb;
let bucket: FakeR2;

function signIn(email = MANAGER) {
  mockedUser.mockResolvedValue({
    userId: "test-user",
    displayName: email,
    email,
    fullName: null,
  });
}

function ask(body: unknown) {
  return new Request("http://localhost/api/ai", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockOpenAI(payload: unknown, status = 200) {
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
  bucket = new FakeR2();
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
      assignee: "staff@example.com",
      status: "pending",
      due: "2026-12-01",
      created: "2026-11-01T00:00:00.000Z",
    },
  ]);
  (env as Record<string, unknown>).DB = db;
  (env as Record<string, unknown>).BUCKET = bucket;
  (env as Record<string, unknown>).OPENAI_API_KEY = "sk-test";
  mockedUser.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/ai", () => {
  it("rechaza orígenes distintos", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai", {
        method: "POST",
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("exige sesión", async () => {
    mockedUser.mockResolvedValue(null);
    const response = await POST(ask({ question: "hola" }));
    expect(response.status).toBe(403);
  });

  it("avisa cuando falta la clave de OpenAI", async () => {
    signIn();
    (env as Record<string, unknown>).OPENAI_API_KEY = undefined;
    const response = await POST(ask({ question: "hola" }));
    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({
      error: expect.stringMatching(/no está configurada/i),
    });
  });

  it("valida la consulta", async () => {
    signIn();
    const response = await POST(ask({ question: "" }));
    expect(response.status).toBe(400);
  });

  it("devuelve la respuesta de la IA", async () => {
    signIn();
    const fetchMock = mockOpenAI({
      output: [{ content: [{ type: "output_text", text: "Respuesta lista" }] }],
    });

    const response = await POST(ask({ question: "¿Qué tareas tengo?" }));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ answer: "Respuesta lista" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("traduce el límite de OpenAI a 503", async () => {
    signIn();
    mockOpenAI({}, 429);
    const response = await POST(ask({ question: "hola" }));
    expect(response.status).toBe(503);
  });

  it("traduce otros errores de OpenAI a 502", async () => {
    signIn();
    mockOpenAI({}, 500);
    const response = await POST(ask({ question: "hola" }));
    expect(response.status).toBe(502);
  });

  it("adjunta imágenes y documentos autorizados", async () => {
    signIn();
    db.seed("attachments", [
      {
        id: "img",
        task_id: 1,
        object_key: "tasks/1/img",
        name: "foto.png",
        mime: "image/png",
        size: 3,
      },
      {
        id: "doc",
        task_id: 1,
        object_key: "tasks/1/doc",
        name: "informe.pdf",
        mime: "application/pdf",
        size: 5,
      },
    ]);
    await bucket.put("tasks/1/img", new Uint8Array([1, 2, 3]));
    await bucket.put("tasks/1/doc", new Uint8Array([37, 80, 68, 70, 45]));
    const fetchMock = mockOpenAI({
      output: [{ content: [{ type: "output_text", text: "Comparado" }] }],
    });

    const response = await POST(
      ask({ question: "Compara los archivos", files: ["img", "doc"] }),
    );

    expect(response.status).toBe(200);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(String(request.body));
    const types = sent.input[0].content.map((item: { type: string }) => item.type);
    expect(types).toEqual(["input_text", "input_image", "input_file"]);
  });

  it("no permite archivos de tareas ajenas", async () => {
    signIn();
    db.seed("attachments", [
      {
        id: "ajeno",
        task_id: 99,
        object_key: "tasks/99/ajeno",
        name: "secreto.pdf",
        mime: "application/pdf",
        size: 1,
      },
    ]);
    const response = await POST(
      ask({ question: "hola", files: ["ajeno"] }),
    );
    expect(response.status).toBe(403);
  });

  it("limita la cantidad de archivos", async () => {
    signIn();
    const response = await POST(
      ask({ question: "hola", files: ["a", "b", "c", "d", "e"] }),
    );
    expect(response.status).toBe(400);
  });
});
