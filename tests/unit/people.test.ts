// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  demoPeople,
  initialPeople,
  parsePeople,
} from "../../lib/people";

describe("people", () => {
  it("usa personas ficticias cuando no hay configuración", () => {
    expect(initialPeople(undefined)).toBe(demoPeople);
    expect(demoPeople.every((person) => person.email.endsWith("@example.com"))).toBe(
      true,
    );
  });

  it("parsea una allowlist válida y normaliza mayúsculas", () => {
    const parsed = parsePeople(
      JSON.stringify([
        {
          email: "Owner@Example.com",
          name: "Owner",
          role: "owner",
          manager: null,
        },
        {
          email: "Staff@Example.com",
          name: "Staff",
          role: "staff",
          manager: "Owner@Example.com",
        },
      ]),
    );

    expect(parsed).toEqual([
      { email: "owner@example.com", name: "Owner", role: "owner", manager: null },
      {
        email: "staff@example.com",
        name: "Staff",
        role: "staff",
        manager: "owner@example.com",
      },
    ]);
  });

  it("rechaza JSON inválido, listas vacías y roles desconocidos", () => {
    expect(parsePeople("{")).toBeNull();
    expect(parsePeople("[]")).toBeNull();
    expect(
      parsePeople(
        JSON.stringify([
          { email: "x@example.com", name: "X", role: "root", manager: null },
        ]),
      ),
    ).toBeNull();
  });

  it("falla en cerrado si AUTHORIZED_PEOPLE está configurado pero es inválido", () => {
    expect(() => initialPeople("{")).toThrow(/AUTHORIZED_PEOPLE/);
  });
});
