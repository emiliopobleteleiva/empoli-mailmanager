export type PersonRole = "owner" | "manager" | "staff";

export type Person = {
  email: string;
  name: string;
  role: PersonRole;
  manager: string | null;
};

/**
 * Personas ficticias para desarrollo, tests y demos. No corresponden a
 * usuarios reales. En producción la lista autorizada se configura con
 * `AUTHORIZED_PEOPLE` (JSON) o se completa en la tabla `people` de D1.
 */
export const demoPeople: Person[] = [
  { email: "ana.torres@example.com", name: "Ana Torres", role: "owner", manager: null },
  { email: "bruno.silva@example.com", name: "Bruno Silva", role: "manager", manager: "ana.torres@example.com" },
  { email: "carla.mendez@example.com", name: "Carla Méndez", role: "manager", manager: "ana.torres@example.com" },
  { email: "diego.fuentes@example.com", name: "Diego Fuentes", role: "manager", manager: "ana.torres@example.com" },
  { email: "elena.rojas@example.com", name: "Elena Rojas", role: "manager", manager: "ana.torres@example.com" },
  { email: "felipe.soto@example.com", name: "Felipe Soto", role: "manager", manager: "ana.torres@example.com" },
  { email: "gabriela.nunez@example.com", name: "Gabriela Núñez", role: "manager", manager: "ana.torres@example.com" },
  { email: "hugo.paredes@example.com", name: "Hugo Paredes", role: "staff", manager: "ana.torres@example.com" },
];

const roles = new Set<PersonRole>(["owner", "manager", "staff"]);
const emailPattern = /^\S+@\S+\.\S+$/;

export function parsePeople(raw: unknown): Person[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const people: Person[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const role = record.role;
    const manager = record.manager;

    if (!emailPattern.test(email) || !name) return null;
    if (typeof role !== "string" || !roles.has(role as PersonRole)) return null;
    if (manager !== null && manager !== undefined && typeof manager !== "string") return null;

    people.push({
      email,
      name,
      role: role as PersonRole,
      manager: typeof manager === "string" ? manager.trim().toLowerCase() : null,
    });
  }
  return people;
}

/**
 * Lee la lista autorizada desde el binding `AUTHORIZED_PEOPLE`. Si no está
 * configurado, usa las personas ficticias de demo. Si está configurado pero es
 * inválido, falla en cerrado en vez de habilitar cuentas de demo por error.
 */
export function initialPeople(raw: unknown): Person[] {
  if (raw === undefined || raw === null || raw === "") return demoPeople;
  const parsed = parsePeople(raw);
  if (!parsed) throw new Error("AUTHORIZED_PEOPLE no es un JSON de personas válido");
  return parsed;
}
