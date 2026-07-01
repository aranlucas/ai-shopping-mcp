import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { fromApiResponse, getProps, safeStorage } from "../utils/result.js";
import { toonResource } from "../utils/toon.js";
import { type ToolContext } from "./types.js";

export function registerResources(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  ctx.server.registerResource(
    "Pantry Inventory",
    "shopping://user/pantry",
    {
      description:
        "Items currently in the user's pantry. Use this to avoid suggesting duplicate purchases and to help with meal planning based on available ingredients.",
      mimeType: "text/toon",
    },
    async () => {
      const props = getProps();

      const result = await safeStorage(() => ctx.storage.pantry.getAll(props.id), "fetch pantry");

      return result.match(
        (pantry) =>
          toonResource("shopping://user/pantry", {
            itemCount: pantry.length,
            items: pantry,
            lastUpdated: new Date().toISOString(),
          }),
        () =>
          toonResource("shopping://user/pantry", {
            error: "Failed to fetch pantry data",
          }),
      );
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
      const props = getProps();

      const result = await safeStorage(
        () => ctx.storage.equipment.getAll(props.id),
        "fetch equipment",
      );

      return result.match(
        (equipment) =>
          toonResource("shopping://user/kitchen-equipment", {
            itemCount: equipment.length,
            items: equipment,
            lastUpdated: new Date().toISOString(),
          }),
        () =>
          toonResource("shopping://user/kitchen-equipment", {
            error: "Failed to fetch equipment data",
          }),
      );
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
      const props = getProps();

      const result = await safeStorage(
        () => ctx.storage.preferredLocation.get(props.id),
        "fetch preferred location",
      );

      return result.match(
        (location) => {
          if (!location) {
            return toonResource("shopping://user/preferred-store", {
              message: "No preferred store set",
              instruction:
                "Ask the user for their zip code, then use search_stores to find nearby stores and set_preferred_store to save their choice.",
            });
          }
          return toonResource("shopping://user/preferred-store", location);
        },
        () =>
          toonResource("shopping://user/preferred-store", {
            error: "Failed to fetch preferred store data",
          }),
      );
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
      const props = getProps();

      const result = await safeStorage(
        () => ctx.storage.orderHistory.getRecent(props.id, 10),
        "fetch order history",
      );

      return result.match(
        (orders) =>
          toonResource("shopping://user/order-history", {
            orderCount: orders.length,
            orders,
            lastUpdated: new Date().toISOString(),
          }),
        () =>
          toonResource("shopping://user/order-history", {
            error: "Failed to fetch order data",
          }),
      );
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
          const props = getProps();
          const prefix = value.trim();

          const ordersResult = await safeStorage(
            () => ctx.storage.orderHistory.getRecent(props.id, 20),
            "fetch orders for completion",
          );

          const upcs = new Set<string>();
          ordersResult.map((orders) => {
            for (const order of orders) {
              for (const item of order.items) {
                if (item.productId && /^\d{13}$/.test(item.productId)) {
                  upcs.add(item.productId);
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

      const props = getProps();
      const locationId = (
        await safeStorage(
          () => ctx.storage.preferredLocation.get(props.id),
          "fetch preferred location",
        )
      ).match(
        (location) => location?.locationId,
        () => undefined,
      );

      const queryParams: Record<string, string> = {};
      if (locationId) {
        queryParams["filter.locationId"] = locationId;
      }

      const result = await fromApiResponse(
        productClient.GET("/v1/products/{id}", {
          params: {
            path: { id: upc },
            query: queryParams,
          },
        }),
        "fetch product details",
      );

      return result.match(
        (data) => {
          const product = data.data;
          if (!product) {
            return toonResource(uri.href, {
              error: `No product found with UPC: ${upc}`,
            });
          }
          return toonResource(uri.href, product);
        },
        (error) =>
          toonResource(uri.href, {
            error: `Failed to fetch product: ${error.message}`,
          }),
      );
    },
  );
}
