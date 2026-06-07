import * as z from "zod/v4";

export const addToCartInputSchema = z.object({
  items: z.array(
    z.object({
      upc: z.string().length(13, {
        message: "UPC must be exactly 13 characters long",
      }),
      quantity: z
        .number()
        .min(1, { message: "Quantity must be at least 1" })
        .max(99, { message: "Quantity must be at most 99" }),
      modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
    }),
  ),
  locationId: z
    .string()
    .length(8, { message: "Location ID must be exactly 8 characters" })
    .optional()
    .describe("Store location ID for the cart. If not provided, uses your preferred location."),
});

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";

import type { components } from "../services/kroger/cart.js";
import type { ToolContext } from "./types.js";

import {
  fromApiResponse,
  getProps,
  safeResolveLocationId,
  toMcpResponse,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

export function registerCartTools(ctx: ToolContext) {
  const { cartClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "add_to_cart",
    {
      title: "Add Items to Cart",
      description:
        "Adds items to the user's Kroger shopping cart. Supports adding multiple items at once. Location defaults to the user's preferred location if not specified.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: addToCartInputSchema,
    },
    async ({ items, locationId }) => {
      const props = getProps();
      const result = safeResolveLocationId(ctx.storage, props.id, locationId).andThen(
        (resolved) => {
          const cartItems: CartItem[] = items.map((item) => ({
            upc: item.upc,
            quantity: item.quantity,
            modality: item.modality,
          }));

          const requestBody: CartItemRequest = { items: cartItems };

          return fromApiResponse(
            cartClient.PUT("/v1/cart/add", {
              body: requestBody,
              headers: { "Content-Type": "application/json" },
            }),
            "add items to cart",
          ).map(() => {
            const locationInfo = resolved.locationName
              ? ` at ${resolved.locationName}`
              : ` (Location: ${resolved.locationId})`;

            return `Successfully added ${items.length} item(s) to cart${locationInfo}.`;
          });
        },
      );

      return toMcpResponse(await result);
    },
  );
}
