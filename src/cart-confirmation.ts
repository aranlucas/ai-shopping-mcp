import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { ToolContext } from "./tools/types.js";

import { validationError } from "./errors.js";

export type CartConfirmationItem = {
  upc: string;
  quantity: number;
  productName?: string;
};

export type ShopForItemsContinuation = {
  kind: "shop-for-items";
  inputFingerprint: string;
  listId: string;
  responseText: string;
};

export type CartConfirmationState = {
  kind: "cart-confirmation";
  items: CartConfirmationItem[];
  continuation?: ShopForItemsContinuation;
};

const checkoutConfirmationSchema = z.object({
  confirm: z.boolean().optional().default(true),
});

function sameItems(expected: CartConfirmationItem[], actual: CartConfirmationItem[]): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export async function requestCheckoutConfirmation(
  ctx: ToolContext,
  requestContext: ServerContext,
  items: CartConfirmationItem[],
  continuation?: ShopForItemsContinuation,
) {
  const state = requestContext.mcpReq.requestState<CartConfirmationState>();
  const response = inputResponse(requestContext.mcpReq.inputResponses, "checkout");

  if (
    state?.kind !== "cart-confirmation" ||
    !sameItems(state.items, items) ||
    response.kind === "missing"
  ) {
    const itemList = items
      .map((item) => `${item.productName ?? item.upc} x${item.quantity}`)
      .join(", ");
    return inputRequired({
      inputRequests: {
        checkout: inputRequired.elicit({
          message: `Add ${items.length} item(s) to your Kroger cart? Items: ${itemList}`,
          requestedSchema: checkoutConfirmationSchema,
        }),
      },
      requestState: await ctx.requestStateCodec.mint(
        { kind: "cart-confirmation", items, continuation },
        requestContext,
      ),
    });
  }

  if (response.kind !== "elicit") {
    return err(validationError("Checkout confirmation returned an unexpected response."));
  }
  if (response.action !== "accept") {
    return err(validationError("Checkout cancelled. Your shopping list remains unchanged."));
  }

  const accepted =
    response.content === undefined
      ? { confirm: true }
      : acceptedContent(
          requestContext.mcpReq.inputResponses,
          "checkout",
          checkoutConfirmationSchema,
        );
  if (!accepted) {
    return err(validationError("Checkout confirmation was invalid. Please try again."));
  }
  if (!accepted.confirm) {
    return err(validationError("Checkout cancelled. Your shopping list remains unchanged."));
  }

  return ok(undefined);
}
