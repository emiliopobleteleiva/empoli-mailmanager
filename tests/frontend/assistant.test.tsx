import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Assistant from "../../app/assistant";

const MANAGER = "bruno.silva@example.com";

function data() {
  return {
    me: { email: MANAGER, name: "Bruno Silva", role: "manager" },
    people: [
      { email: MANAGER, name: "Bruno Silva", role: "manager" },
      {
        email: "staff@example.com",
        name: "Diego Fuentes",
        role: "staff",
        manager: MANAGER,
      },
    ],
    tasks: [
      {
        id: 1,
        title: "Cotizar",
        description: "",
        assignee: "staff@example.com",
        creator: MANAGER,
        due: "2020-01-01",
        status: "pending",
      },
      {
        id: 2,
        title: "Informe",
        description: "",
        assignee: MANAGER,
        creator: MANAGER,
        due: "2026-12-01",
        status: "done",
      },
    ],
    updates: [
      {
        id: 1,
        task_id: 1,
        author: MANAGER,
        body: "En curso",
        created: "2026-11-01T00:00:00.000Z",
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Assistant", () => {
  it("lista las tareas vencidas", () => {
    render(<Assistant data={data()} onSaved={async () => {}} />);

    fireEvent.change(screen.getByLabelText("¿En qué te ayudo?"), {
      target: { value: "Tareas vencidas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));

    expect(screen.getByText(/Tareas vencidas:/)).toBeInTheDocument();
  });

  it("resume avances y tareas desde las sugerencias", () => {
    render(<Assistant data={data()} onSaved={async () => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Resumir avances" }));

    expect(screen.getByText(/Último avance: En curso/)).toBeInTheDocument();
    expect(screen.getByText(/Informe/)).toBeInTheDocument();
  });

  it("abre el borrador de encargo y lo guarda", async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Assistant data={data()} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Crear tarea" }));
    expect(
      screen.getByRole("heading", { name: "Revisar nuevo encargo" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tarea"), {
      target: { value: "Nuevo encargo" },
    });
    fireEvent.change(screen.getByLabelText("Responsable"), {
      target: { value: "staff@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Fecha límite"), {
      target: { value: "2026-12-20" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/data",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("prepara un recordatorio sin enviarlo", () => {
    render(<Assistant data={data()} onSaved={async () => {}} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Preparar recordatorio" }),
    );
    fireEvent.change(screen.getByLabelText("Tarea"), {
      target: { value: "1" },
    });

    expect(
      (screen.getByLabelText("Mensaje") as HTMLTextAreaElement).value,
    ).toContain("Cotizar");
  });
});
