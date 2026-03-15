import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSessionScopedUserId, type ToolContext } from "./types.js";

export function registerResources(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  ctx.server.registerResource(
    "Pantry Inventory",
    "shopping://user/pantry",
    {
      description:
        "Items currently in the user's pantry. Use this to avoid suggesting duplicate purchases and to help with meal planning based on available ingredients.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) {
        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/pantry",
              text: JSON.stringify({ error: "User not authenticated" }),
            },
          ],
        };
      }

      const pantry = await ctx.storage.pantry.getAll(props.id);

      return {
        contents: [
          {
            type: "text",
            uri: "shopping://user/pantry",
            text: JSON.stringify(
              {
                itemCount: pantry.length,
                items: pantry,
                lastUpdated: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  ctx.server.registerResource(
    "Equipment Inventory",
    "shopping://user/equipment",
    {
      description:
        "Kitchen equipment and tools the user owns. Use this to suggest recipes that match available equipment and to help with meal planning based on what tools are available.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) {
        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/equipment",
              text: JSON.stringify({ error: "User not authenticated" }),
            },
          ],
        };
      }

      const equipment = await ctx.storage.equipment.getAll(props.id);

      return {
        contents: [
          {
            type: "text",
            uri: "shopping://user/equipment",
            text: JSON.stringify(
              {
                itemCount: equipment.length,
                items: equipment,
                lastUpdated: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  ctx.server.registerResource(
    "Preferred Store Location",
    "shopping://user/location",
    {
      description:
        "The user's preferred shopping location. Use this for product searches and availability checks when no location is explicitly specified. IMPORTANT: If no location is set, proactively ask the user for their zip code and help them find and set their preferred store using search_locations and set_preferred_location tools.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) {
        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/location",
              text: JSON.stringify({ error: "User not authenticated" }),
            },
          ],
        };
      }

      const location = await ctx.storage.preferredLocation.get(props.id);

      if (!location) {
        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/location",
              text: JSON.stringify({
                message: "No preferred location set",
                instruction:
                  "Ask the user for their zip code, then use search_locations to find nearby stores and set_preferred_location to save their choice.",
              }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            type: "text",
            uri: "shopping://user/location",
            text: JSON.stringify(location, null, 2),
          },
        ],
      };
    },
  );

  ctx.server.registerResource(
    "Order History",
    "shopping://user/orders",
    {
      description:
        "The user's past orders and purchase history. Use this to identify frequently purchased items, shopping patterns, and to make personalized recommendations.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) {
        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/orders",
              text: JSON.stringify({ error: "User not authenticated" }),
            },
          ],
        };
      }

      const orders = await ctx.storage.orderHistory.getRecent(props.id, 20);

      return {
        contents: [
          {
            type: "text",
            uri: "shopping://user/orders",
            text: JSON.stringify(
              {
                orderCount: orders.length,
                orders: orders,
                lastUpdated: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  ctx.server.registerResource(
    "Shopping List",
    "shopping://user/shopping-list",
    {
      description:
        "The user's current shopping list of items they plan to buy. Items may have UPCs (ready for cart checkout) or just names (need product search). Use this to help users plan purchases, find products for items without UPCs, and coordinate checkout.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) {
        return {
          contents: [
            {
              type: "text",
              uri: "shopping://user/shopping-list",
              text: JSON.stringify({ error: "User not authenticated" }),
            },
          ],
        };
      }

      const scopedId = getSessionScopedUserId(props.id, ctx.getSessionId());
      const list = await ctx.storage.shoppingList.getAll(scopedId);
      const unchecked = list.filter((i) => !i.checked);
      const withUpc = unchecked.filter((i) => i.upc);
      const withoutUpc = unchecked.filter((i) => !i.upc);

      return {
        contents: [
          {
            type: "text",
            uri: "shopping://user/shopping-list",
            text: JSON.stringify(
              {
                totalItems: list.length,
                uncheckedCount: unchecked.length,
                readyForCheckout: withUpc.length,
                needsUpc: withoutUpc.length,
                items: list,
                lastUpdated: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  ctx.server.registerResource(
    "Product Details",
    new ResourceTemplate("shopping://product/{productId}", {
      list: undefined,
    }),
    {
      description:
        "Detailed information about a specific product by its ID (13-digit UPC). Includes pricing, availability, and location information.",
      mimeType: "application/json",
    },
    async (uri: URL) => {
      const match = uri.href.match(/shopping:\/\/product\/([0-9]{13})/);
      if (!match) {
        return {
          contents: [
            {
              type: "text",
              uri: uri.href,
              text: JSON.stringify({
                error:
                  "Invalid product URI format. Expected: shopping://product/{13-digit-upc}",
              }),
            },
          ],
        };
      }

      const productId = match[1];

      let locationId: string | undefined;
      const props = ctx.getUser();
      if (props?.id) {
        const location = await ctx.storage.preferredLocation.get(props.id);
        locationId = location?.locationId;
      }

      const queryParams: Record<string, string> = {};
      if (locationId) {
        queryParams["filter.locationId"] = locationId;
      }

      const { data, error } = await productClient.GET("/v1/products/{id}", {
        params: {
          path: { id: productId },
          query: queryParams,
        },
      });

      if (error) {
        return {
          contents: [
            {
              type: "text",
              uri: uri.href,
              text: JSON.stringify({
                error: `Failed to fetch product: ${JSON.stringify(error)}`,
              }),
            },
          ],
        };
      }

      const product = data.data;
      if (!product) {
        return {
          contents: [
            {
              type: "text",
              uri: uri.href,
              text: JSON.stringify({
                error: `No product found with ID: ${productId}`,
              }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            type: "text",
            uri: uri.href,
            text: JSON.stringify(product, null, 2),
          },
        ],
      };
    },
  );
}
