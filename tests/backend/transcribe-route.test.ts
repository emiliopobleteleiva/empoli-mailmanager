// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/chatgpt-auth", () => ({
  getChatGPTUser: vi.fn(),
}));

import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { POST } from "../../app/api/transcribe/route";
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

function audioRequest(
  body?: Uint8Array,
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "audio/webm",
      ...headers,
    },
    body: body as unknown as BodyInit | undefined,
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
  (env as Record<string, unknown>).DB = db;
  (env as Record<string, unknown>).OPENAI_API_KEY = "sk-test";
  mockedUser.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/transcribe", () => {
  it("rechaza orígenes distintos", async () => {
    const response = await POST(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("exige sesión", async () => {
    mockedUser.mockResolvedValue(null);
    const response = await POST(audioRequest(new Uint8Array([1, 2])));
    expect(response.status).toBe(403);
  });

  it("avisa cuando falta la clave", async () => {
    signIn();
    (env as Record<string, unknown>).OPENAI_API_KEY = undefined;
    const response = await POST(audioRequest(new Uint8Array([1, 2])));
    expect(response.status).toBe(503);
  });

  it("rechaza formatos no soportados", async () => {
    signIn();
    const response = await POST(
      audioRequest(new Uint8Array([1, 2]), { "content-type": "video/mp4" }),
    );
    expect(response.status).toBe(415);
  });

  it("rechaza audio demasiado grande", async () => {
    signIn();
    const response = await POST(
      audioRequest(new Uint8Array([1, 2]), { "content-length": "9000000" }),
    );
    expect(response.status).toBe(413);
  });

  it("rechaza audio vacío", async () => {
    signIn();
    const response = await POST(audioRequest());
    expect(response.status).toBe(400);
  });

  it("devuelve la transcripción", async () => {
    signIn();
    const fetchMock = mockOpenAI({ text: "  hola mundo  " });
    const response = await POST(audioRequest(new Uint8Array([1, 2, 3])));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ text: "hola mundo" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("traduce el límite de OpenAI a 503", async () => {
    signIn();
    mockOpenAI({}, 429);
    const response = await POST(audioRequest(new Uint8Array([1, 2])));
    expect(response.status).toBe(503);
  });

  it("traduce otros errores de OpenAI a 502", async () => {
    signIn();
    mockOpenAI({}, 500);
    const response = await POST(audioRequest(new Uint8Array([1, 2])));
    expect(response.status).toBe(502);
  });

  it("responde 422 si no se reconoció voz", async () => {
    signIn();
    mockOpenAI({ text: "" });
    const response = await POST(audioRequest(new Uint8Array([1, 2])));
    expect(response.status).toBe(422);
  });
});
