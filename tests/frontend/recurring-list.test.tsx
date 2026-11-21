import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RecurringList from "../../app/recurring-list";

const people = [{ email: "bruno.silva@example.com", name: "Bruno Silva" }];

describe("RecurringList", () => {
  it("muestra la configuración y su frecuencia", () => {
    render(
      <RecurringList
        people={people}
        notices={[
          {
            id: "n1",
            series_id: "s1",
            status: "sent",
            recipient: "staff@example.com",
            sent_at: "2026-11-05T00:00:00.000Z",
          },
        ]}
        series={[
          {
            id: "s1",
            title: "Cierre mensual",
            description: "Cierre de mes",
            assignee: "bruno.silva@example.com",
            creator: "bruno.silva@example.com",
            frequency: "monthly",
            first_due: "2026-11-30",
            next_due: "2026-12-31",
            setup_status: "pending",
            created: "2026-11-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("Cierre mensual")).toBeInTheDocument();
    expect(screen.getByText(/Mensual/)).toBeInTheDocument();
    expect(
      screen.getByText(/Próxima fecha prevista: 2026-12-31/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Enviado a staff@example\.com/)).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay series", () => {
    render(<RecurringList people={people} notices={[]} series={[]} />);
    expect(
      screen.getByText(/Aún no hay tareas repetitivas/),
    ).toBeInTheDocument();
  });
});
