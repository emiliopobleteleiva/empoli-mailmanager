import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "../../app/page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home", () => {
  it("pinta el resumen cuando /api/data responde", async () => {
    const me = {
      email: "ana.torres@example.com",
      name: "Ana Torres",
      role: "owner",
      manager: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          me,
          people: [me],
          tasks: [],
          updates: [],
          series: [],
          notices: [],
          pilotNotices: [],
        }),
      }),
    );

    render(<Home />);

    expect(
      await screen.findByRole("heading", { name: /Hola,\s*Ana/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tu espacio está listo para comenzar"),
    ).toBeInTheDocument();
  });
});
