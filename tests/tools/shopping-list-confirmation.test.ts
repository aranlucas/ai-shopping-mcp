import { describe, expect, it, vi } from "vitest";

import { requestCheckoutConfirmation } from "../../src/tools/shopping-list.js";

describe("requestCheckoutConfirmation", () => {
  it("proceeds (ok) when the client does not support form elicitation", async () => {
    const result = await requestCheckoutConfirmation(
      {
        elicitInput: vi
          .fn()
          .mockRejectedValue(new Error("Client does not support form elicitation.")),
      },
      [{ productName: "Milk", quantity: 1 }],
    );

    expect(result.isOk()).toBe(true);
  });

  it("returns an error when elicitation fails unexpectedly", async () => {
    const result = await requestCheckoutConfirmation(
      {
        elicitInput: vi.fn().mockRejectedValue(new Error("network timeout")),
      },
      [{ productName: "Milk", quantity: 1 }],
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("unexpectedly");
  });

  it("returns an error when the user declines confirmation", async () => {
    const result = await requestCheckoutConfirmation(
      {
        elicitInput: vi.fn().mockResolvedValue({ action: "decline" }),
      },
      [{ productName: "Milk", quantity: 1 }],
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("cancelled");
  });
});
