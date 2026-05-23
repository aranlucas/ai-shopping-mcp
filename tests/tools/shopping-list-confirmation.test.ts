import { describe, expect, it, vi } from "vitest";

import { requestCheckoutConfirmation } from "../../src/tools/shopping-list.js";

describe("requestCheckoutConfirmation", () => {
  it("returns an error when the client cannot complete elicitation", async () => {
    const result = await requestCheckoutConfirmation(
      {
        elicitInput: vi.fn().mockRejectedValue(new Error("not supported")),
      },
      [{ productName: "Milk", quantity: 1 }],
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("requires confirmation");
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
