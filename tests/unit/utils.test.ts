// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cn } from "../../lib/utils";

describe("cn", () => {
  it("combina clases y resuelve conflictos de Tailwind", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm");
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn({ hidden: false, block: true })).toBe("block");
  });
});
