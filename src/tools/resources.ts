import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getProps, safeStorage } from "../utils/result.js";
import { toonResource } from "../utils/toon.js";
import { type ToolContext } from "./types.js";

export function registerResources(ctx: ToolContext) {
  ctx.server.registerResource(
    "Pantry Inventory",
    "shopping://user/pantry",
    {
      description:
        "Items currently in the user's pantry. Use this to avoid suggesting duplicate purchases and to help with meal planning based on available ingredients.",
      mimeType: "text/toon",
    },
    async () => {
      getProps();

      const result = await safeStorage(() => ctx.storage.pantry.getAll(), "fetch pantry");

      if (result.isErr()) {
        return toonResource("shopping://user/pantry", { error: "Failed to fetch pantry data" });
      }
      return toonResource("shopping://user/pantry", {
        itemCount: result.value.length,
        items: result.value,
        lastUpdated: new Date().toISOString(),
      });
    },
  );

  ctx.server.registerResource(
    "Kitchen Equipment",
    "shopping://user/kitchen-equipment",
    {
      description:
        "Kitchen equipment and tools the user owns. Use this to suggest recipes that match available equipment and to help with meal planning based on what tools are available.",
      mimeType: "text/toon",
    },
    async () => {
      getProps();

      const result = await safeStorage(() => ctx.storage.equipment.getAll(), "fetch equipment");

      if (result.isErr()) {
        return toonResource("shopping://user/kitchen-equipment", {
          error: "Failed to fetch equipment data",
        });
      }
      return toonResource("shopping://user/kitchen-equipment", {
        itemCount: result.value.length,
        items: result.value,
        lastUpdated: new Date().toISOString(),
      });
    },
  );

  ctx.server.registerResource(
    "Preferred Store",
    "shopping://user/preferred-store",
    {
      description:
        "The user's preferred Kroger/QFC store. Use this for product searches, weekly deals, and cart operations when no location is explicitly specified. If unset, ask for a zip code and use search_stores followed by set_preferred_store.",
      mimeType: "text/toon",
    },
    async () => {
      getProps();

      const result = await safeStorage(
        () => ctx.storage.preferredLocation.get(),
        "fetch preferred location",
      );

      if (result.isErr()) {
        return toonResource("shopping://user/preferred-store", {
          error: "Failed to fetch preferred store data",
        });
      }
      if (!result.value) {
        return toonResource("shopping://user/preferred-store", {
          message: "No preferred store set",
          instruction:
            "Ask the user for their zip code, then use search_stores to find nearby stores and set_preferred_store to save their choice.",
        });
      }
      return toonResource("shopping://user/preferred-store", result.value);
    },
  );

  ctx.server.registerResource(
    "Order History",
    "shopping://user/order-history",
    {
      description:
        "The user's past orders and purchase history. Use this to identify frequently purchased items, shopping patterns, and to make personalized recommendations.",
      mimeType: "text/toon",
    },
    async () => {
      getProps();

      const result = await safeStorage(
        () => ctx.storage.orderHistory.getRecent(10),
        "fetch order history",
      );

      if (result.isErr()) {
        return toonResource("shopping://user/order-history", {
          error: "Failed to fetch order data",
        });
      }
      return toonResource("shopping://user/order-history", {
        orderCount: result.value.length,
        orders: result.value,
        lastUpdated: new Date().toISOString(),
      });
    },
  );

  ctx.server.registerResource(
    "Product Details",
    new ResourceTemplate("shopping://product/{upc}", {
      list: undefined,
      complete: {
        upc: async (value) => {
          // Suggest 13-digit UPCs from the user's recent orders, filtered by
          // the in-flight prefix. The shopping list is no longer a source:
          // lists are now request-scoped via create_shopping_list, not a
          // session-persistent document.
          getProps();
          const prefix = value.trim();

          const ordersResult = await safeStorage(
            () => ctx.storage.orderHistory.getRecent(20),
            "fetch orders for completion",
          );

          const upcs = new Set<string>();
          ordersResult.map((orders) => {
            for (const order of orders) {
              for (const item of order.items) {
                if (/^\d{13}$/.test(item.upc)) {
                  upcs.add(item.upc);
                }
              }
            }
          });

          const matches = [...upcs].filter((upc) => !prefix || upc.startsWith(prefix));
          return matches.slice(0, 50);
        },
      },
    }),
    {
      description:
        "Detailed information about a specific product by 13-digit UPC. Includes pricing, availability, and location information.",
      mimeType: "text/toon",
    },
    async (uri: URL) => {
      const match = uri.href.match(/shopping:\/\/product\/([0-9]{13})/);
      if (!match) {
        return toonResource(uri.href, {
          error: "Invalid product URI format. Expected: shopping://product/{13-digit-upc}",
        });
      }

      const upc = match[1];

      getProps();
      const locationResult = await safeStorage(
        () => ctx.storage.preferredLocation.get(),
        "fetch preferred location",
      );
      const locationId = locationResult.isOk() ? locationResult.value?.locationId : undefined;

      const result = await ctx.productService.getProduct(upc, locationId);

      if (result.isOk()) return toonResource(uri.href, result.value);
      if (result.error.type === "NOT_FOUND") {
        return toonResource(uri.href, { error: `No product found with UPC: ${upc}` });
      }
      return toonResource(uri.href, { error: `Failed to fetch product: ${result.error.message}` });
    },
  );
}
