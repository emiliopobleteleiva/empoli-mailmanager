// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ConnectorBinding } from "../../lib/connector-contract.mjs";
import {
  getConnectorBinding,
  runWithConnectorBinding,
} from "../../lib/connector-context";

describe("connector-context", () => {
  it("aísla el binding por request", () => {
    expect(getConnectorBinding()).toBeUndefined();

    const binding = {
      getContext: async () => ({ status: "binding_unavailable" }),
      invoke: async () => ({ status: "binding_unavailable" }),
    } as unknown as ConnectorBinding;

    const seenInside = runWithConnectorBinding(binding, () =>
      getConnectorBinding(),
    );

    expect(seenInside).toBe(binding);
    expect(getConnectorBinding()).toBeUndefined();
  });
});
