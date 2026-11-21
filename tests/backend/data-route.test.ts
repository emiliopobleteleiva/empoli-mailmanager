// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/chatgpt-auth", () => ({
  getChatGPTUser: vi.fn(),
}));

import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { GET, POST } from "../../app/api/data/route";
import { type Row, FakeDb } from "../helpers/fake-d1";

const OWNER = "ana.torres@example.com";
const MANAGER = "bruno.silva@example.com";
const OTHER_MANAGER = "carla.mendez@example.com";

const mockedUser = vi.mocked(getChatGPTUser);
let db: FakeDb;

function signIn(email: string) {
  mockedUser.mockResolvedValue({
    userId: "test-user",
    displayName: email,
    email,
    fullName: null,
  });
}

function postJson(body: unknown) {
  return new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface ApiBody {
  error?: string;
  recurringPending?: boolean;
  me?: { email: string; name: string; role: string };
  tasks?: Array<{ id: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

async function body(response: Response): Promise<ApiBody> {
  return (await response.json()) as ApiBody;
}

function task(overrides: Row = {}): Row {
  return {
    id: 1,
    title: "Preparar cotización",
    description: "",
    assignee: "staff@example.com",
    creator: MANAGER,
    due: "2026-12-01",
    status: "pending",
    created: "2026-11-01T00:00:00.000Z",
    series_id: null,
    ...overrides,
  };
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
  (env as Record<string, unknown>).DB = db;
  delete (env as Record<string, unknown>).AUTHORIZED_PEOPLE;
  mockedUser.mockReset();
});

describe("GET /api/data", () => {
  it("rechaza visitantes sin sesión", async () => {
    mockedUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(403);
    expect((await body(response)).error).toMatch(/sin acceso/i);
  });

  it("rechaza cuentas que no están en la lista de personas", async () => {
    signIn("intruso@example.com");
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("usa AUTHORIZED_PEOPLE como allowlist cuando está configurado", async () => {
    (env as Record<string, unknown>).AUTHORIZED_PEOPLE = JSON.stringify([
      {
        email: "custom@example.com",
        name: "Custom User",
        role: "owner",
        manager: null,
      },
    ]);
    signIn("custom@example.com");

    const response = await GET();
    const payload = await body(response);
    expect(response.status).toBe(200);
    expect(payload.me?.name).toBe("Custom User");
  });

  it("falla en cerrado si AUTHORIZED_PEOPLE es inválido", async () => {
    (env as Record<string, unknown>).AUTHORIZED_PEOPLE = "{";
    signIn(OWNER);
    const response = await GET();
    expect(response.status).toBe(500);
  });

  it("el owner ve todas las tareas", async () => {
    signIn(OWNER);
    db.seed("tasks", [
      task({ id: 1, creator: MANAGER }),
      task({ id: 2, creator: OTHER_MANAGER, assignee: "otra@example.com" }),
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    expect((await body(response)).tasks).toHaveLength(2);
  });

  it("un manager solo ve sus tareas", async () => {
    signIn(MANAGER);
    db.seed("tasks", [
      task({ id: 1, creator: MANAGER }),
      task({ id: 2, creator: OTHER_MANAGER }),
    ]);

    const response = await GET();
    const payload = await body(response);
    expect(payload.me?.email).toBe(MANAGER);
    expect(payload.tasks?.map((item) => item.id)).toEqual([1]);
  });
});

describe("POST /api/data", () => {
  it("crea una tarea para una persona a cargo", async () => {
    signIn(MANAGER);
    const response = await POST(
      postJson({
        action: "create",
        title: "Enviar informe",
        assignee: "staff@example.com",
        due: "2026-12-15",
        frequency: "none",
      }),
    );

    expect(response.status).toBe(200);
    expect(db.tables.tasks).toHaveLength(1);
    expect(db.tables.tasks[0]).toMatchObject({
      title: "Enviar informe",
      assignee: "staff@example.com",
      creator: MANAGER,
      status: "pending",
    });
  });

  it("crea una serie cuando la tarea es repetitiva", async () => {
    signIn(MANAGER);
    const response = await POST(
      postJson({
        action: "create",
        title: "Cierre mensual",
        assignee: "staff@example.com",
        due: "2026-12-31",
        frequency: "monthly",
      }),
    );

    expect((await body(response)).recurringPending).toBe(true);
    expect(db.tables.recurring_series).toHaveLength(1);
    expect(db.tables.recurring_series[0].setup_status).toBe("pending");
    expect(db.tables.tasks[0].series_id).toBe(
      db.tables.recurring_series[0].id,
    );
  });

  it("no deja asignar tareas a personas de otro manager", async () => {
    signIn(MANAGER);
    const response = await POST(
      postJson({
        action: "create",
        title: "Tarea ajena",
        assignee: "ana.torres@example.com",
        due: "2026-12-15",
        frequency: "none",
      }),
    );

    expect(response.status).toBe(400);
    expect(db.tables.tasks).toHaveLength(0);
  });

  it("no permite modificar tareas sin permiso", async () => {
    signIn(OTHER_MANAGER);
    db.seed("tasks", [task({ id: 1, creator: MANAGER })]);

    const response = await POST(
      postJson({ action: "update", id: 1, status: "done", body: "Listo" }),
    );

    expect(response.status).toBe(403);
  });

  it("registra un avance en una tarea propia", async () => {
    signIn(MANAGER);
    db.seed("tasks", [task({ id: 1, creator: MANAGER })]);

    const response = await POST(
      postJson({
        action: "update",
        id: 1,
        status: "active",
        body: "Cotización enviada",
      }),
    );

    expect(response.status).toBe(200);
    expect(db.tables.tasks[0].status).toBe("active");
    expect(db.tables.updates).toHaveLength(1);
    expect(db.tables.updates[0]).toMatchObject({
      task_id: 1,
      author: MANAGER,
      body: "Cotización enviada",
    });
  });
});
