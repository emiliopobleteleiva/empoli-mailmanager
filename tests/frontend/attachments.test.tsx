import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Attachments from "../../app/attachments";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Attachments", () => {
  it("lista los archivos que devuelve el backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          attachments: [
            {
              id: "a1",
              task_id: 1,
              name: "cotizacion.pdf",
              mime: "application/pdf",
              size: 2 * 1024 * 1024,
              uploader: "bruno.silva@example.com",
              created: "2026-11-01T00:00:00.000Z",
            },
          ],
        }),
      }),
    );

    render(
      <Attachments taskId={1} me={{ email: "bruno.silva@example.com", role: "staff" }} />,
    );

    expect(await screen.findByText("cotizacion.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute(
      "href",
      "/api/attachments?id=a1&open=1",
    );
  });

  it("muestra el error del backend cuando no hay acceso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Sin acceso" }),
      }),
    );

    render(
      <Attachments taskId={1} me={{ email: "bruno.silva@example.com", role: "staff" }} />,
    );

    expect(await screen.findByText("Sin acceso")).toBeInTheDocument();
  });
});
