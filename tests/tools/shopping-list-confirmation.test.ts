import {
  isInputRequiredResult,
  type InputResponses,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import type { CartConfirmationState } from "../../src/cart-confirmation.js";
import type { ToolContext } from "../../src/tools/types.js";

import { requestCheckoutConfirmation } from "../../src/cart-confirmation.js";
import { testCartConfirmationCodec } from "../cart-confirmation.js";

const ITEMS = [
  {
    upc: "0001111041700",
    productName: "Milk",
    quantity: 1,
  },
  {
    upc: "0001111008728",
    productName: "Bread",
    quantity: 2,
  },
];

function makeToolContext(): ToolContext {
  return {
    requestStateCodec: testCartConfirmationCodec,
  } as ToolContext;
}

function makeRequestContext(
  state?: CartConfirmationState,
  inputResponses?: InputResponses,
): ServerContext {
  return {
    mcpReq: {
      inputResponses,
      requestState: () => state,
    },
  } as unknown as ServerContext;
}

describe("requestCheckoutConfirmation", () => {
  it("returns input_required with the exact cart items on the first round", async () => {
    const result = await requestCheckoutConfirmation(
      makeToolContext(),
      makeRequestContext(),
      ITEMS,
    );

    expect(isInputRequiredResult(result)).toBe(true);
    if (!isInputRequiredResult(result)) return;

    expect(result.requestState).toMatch(/^v1\./u);
    expect(result.inputRequests?.checkout).toBeDefined();
  });

  it("accepts a matching signed continuation response", async () => {
    const state: CartConfirmationState = {
      kind: "cart-confirmation",
      items: ITEMS,
    };
    const result = await requestCheckoutConfirmation(
      makeToolContext(),
      makeRequestContext(state, {
        checkout: { action: "accept", content: { confirm: true } },
      }),
      ITEMS,
    );

    expect(isInputRequiredResult(result)).toBe(false);
    if (isInputRequiredResult(result)) return;
    expect(result.isOk()).toBe(true);
  });

  it.each(["decline", "cancel"] as const)(
    "returns a cancellation error when the user chooses %s",
    async (action) => {
      const state: CartConfirmationState = {
        kind: "cart-confirmation",
        items: ITEMS,
      };
      const result = await requestCheckoutConfirmation(
        makeToolContext(),
        makeRequestContext(state, {
          checkout: { action },
        }),
        ITEMS,
      );

      expect(isInputRequiredResult(result)).toBe(false);
      if (isInputRequiredResult(result)) return;
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("cancelled");
    },
  );

  it("re-prompts when the echoed state names different cart items", async () => {
    const state: CartConfirmationState = {
      kind: "cart-confirmation",
      items: [{ upc: "different", productName: "Different", quantity: 1 }],
    };
    const result = await requestCheckoutConfirmation(
      makeToolContext(),
      makeRequestContext(state, {
        checkout: { action: "accept", content: { confirm: true } },
      }),
      ITEMS,
    );

    expect(isInputRequiredResult(result)).toBe(true);
  });
});
