import { z } from "zod";
import type { components } from "../services/kroger/cart.js";
import { cartClient } from "../services/kroger/client.js";
import { createUserStorage } from "../utils/user-storage.js";
import { requireAuth, resolveLocationId, type ToolContext } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

export function registerCartTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "add_to_cart",
    {
      title: "Add Items to Cart",
      description:
        "Adds items to the user's Kroger shopping cart. Supports adding multiple items at once. Location defaults to the user's preferred location if not specified.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        items: z.array(
          z.object({
            upc: z.string().length(13, {
              message: "UPC must be exactly 13 characters long",
            }),
            quantity: z
              .number()
              .min(1, { message: "Quantity must be at least 1" }),
            modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
          }),
        ),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "Store location ID for the cart. If not provided, uses your preferred location.",
          ),
      }),
    },
    async ({ items, locationId }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);

      let resolved: { locationId: string; locationName?: string };
      try {
        resolved = await resolveLocationId(storage, props.id, locationId);
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }

      const cartItems: CartItem[] = items.map((item) => ({
        upc: item.upc,
        quantity: item.quantity,
        modality: item.modality,
      }));

      const requestBody: CartItemRequest = {
        items: cartItems,
      };

      const { error } = await cartClient.PUT("/v1/cart/add", {
        body: requestBody,
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (error) {
        console.error("Error adding items to cart:", error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to add items to cart: ${JSON.stringify(error)}`,
            },
          ],
          isError: true,
        };
      }

      console.log(
        `Items successfully added to cart for location ${resolved.locationId}`,
      );

      const locationInfo = resolved.locationName
        ? ` at ${resolved.locationName}`
        : ` (Location: ${resolved.locationId})`;

      return {
        content: [
          {
            type: "text",
            text: `Successfully added ${items.length} item(s) to cart${locationInfo}.`,
          },
        ],
      };
    },
  );
}
