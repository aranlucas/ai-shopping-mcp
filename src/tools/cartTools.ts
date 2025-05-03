import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { components } from "../services/kroger/cart";
import { cartClient } from "../services/kroger/client";

export function registerCartTools(server: McpServer) {
  // Add to cart tool
  server.tool(
    "add_to_cart",
    "Adds specified items to a user's shopping cart. Use this tool when the user wants to add products to their cart for purchase. Prefer to use add to cart with multiple items.",
    {
      items: z.array(
        z.object({
          upc: z
            .string()
            .length(13, { message: "UPC must be exactly 13 characters long" }),
          quantity: z
            .number()
            .min(1, { message: "Quantity must be at least 1" }),
          modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
        }),
      ),
    },
    async ({ items }, extras) => {
      try {
        // Convert items to the format expected by the Kroger API
        const cartItems: components["schemas"]["cart.cartItemModel"][] =
          items.map((item) => ({
            upc: item.upc,
            quantity: item.quantity,
            modality: item.modality,
          }));

        const requestBody: components["schemas"]["cart.cartItemRequestModel"] =
          {
            items: cartItems,
          };

        // Make the API call to add items to the cart
        const { error } = await cartClient.PUT("/v1/cart/add", {
          body: requestBody,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.KROGER_USER_TOKEN}`,
          },
        });

        if (error) {
          console.error("Error adding items to cart:", error);
          throw new Error(
            `Failed to add items to cart: ${JSON.stringify(error)}`,
          );
        }

        console.log("Items successfully added to cart");

        // Return a success response
        return {
          content: [
            {
              type: "text",
              text: `Successfully added ${items.length} item(s) to cart`,
            },
          ],
        };
      } catch (error) {
        console.error("Error in add-to-cart tool:", error);
        throw error;
      }
    },
  );

  // List items tool can be added here in the future
}
