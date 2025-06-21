import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { z } from "zod";
import { KrogerHandler } from "./kroger-handler.js";
import type { components } from "./services/kroger/cart.js";
import {
  cartClient,
  locationClient,
  productClient,
  configureKrogerAuth,
  type KrogerTokenInfo,
} from "./services/kroger/client.js";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
};

dotenv.config();

export class MyMCP extends McpAgent<Props, Env> {
  server = new McpServer({
    name: "kroger-ai-assistant",
    version: "1.0.0",
  });

  async init() {
    // Configure Kroger auth for all clients
    configureKrogerAuth(
      (): KrogerTokenInfo | null => {
        // Return current token info from props
        if (!this.props?.accessToken) return null;
        
        return {
          accessToken: this.props.accessToken as string,
          refreshToken: this.props.refreshToken as string | undefined,
          tokenExpiresAt: this.props.tokenExpiresAt as number,
          krogerClientId: (this.env as unknown as Env).KROGER_CLIENT_ID,
          krogerClientSecret: (this.env as unknown as Env).KROGER_CLIENT_SECRET,
        };
      },
      (newTokenInfo) => {
        // Update props with new token information
        if (newTokenInfo.accessToken) {
          this.props.accessToken = newTokenInfo.accessToken;
        }
        if (newTokenInfo.refreshToken) {
          this.props.refreshToken = newTokenInfo.refreshToken;
        }
        if (newTokenInfo.tokenExpiresAt) {
          this.props.tokenExpiresAt = newTokenInfo.tokenExpiresAt;
        }
      }
    );

    // Add to cart tool
    this.server.tool(
      "add_to_cart",
      "Adds specified items to a user's shopping cart. Use this tool when the user wants to add products to their cart for purchase. Prefer to use add to cart with multiple items.",
      {
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
      },
      async ({ items }) => {
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
              text: JSON.stringify({
                message: `Successfully added ${items.length} item(s) to cart`,
                itemsAdded: items.length,
                success: true,
              }),
            },
          ],
        };
      },
    );

    // List items tool can be added here in the future
    // Search locations tool
    this.server.tool(
      "search_locations",
      "Searches for Kroger store locations based on various filter criteria. Use this tool when the user needs to find nearby Kroger stores or specific store locations. Locations can be searched by zip code, latitude/longitude coordinates, radius, chain name, or department availability.",
      {
        zipCodeNear: z
          .string()
          .length(5, { message: "Zip code must be exactly 5 digits" })
          .default("98122"),
        limit: z.number().min(1).max(200).optional().default(1),
        chain: z.string().optional().default("QFC"),
      },
      async ({ zipCodeNear, limit, chain }) => {
        // Build query parameters
        const queryParams: Record<string, string | number> = {};

        // Add coordinates parameters (must use one of these)
        if (zipCodeNear) {
          queryParams["filter.zipCode.near"] = zipCodeNear;
        }

        if (limit !== undefined) {
          queryParams["filter.limit"] = limit;
        }
        if (chain) {
          queryParams["filter.chain"] = chain;
        }

        console.log("Query parameters for location search:", queryParams);
        // Make the API call to search for locations
        const { data, error } = await locationClient.GET("/v1/locations", {
          params: {
            query: queryParams,
          },
        });

        if (error) {
          console.error("Error searching locations:", error);
          throw new Error(
            `Failed to search locations: ${JSON.stringify(error)}`,
          );
        }

        // Format the response for display
        const locations = data?.data || [];
        console.log(`Found ${locations.length} locations`);

        // Return a successful response
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Found ${locations.length} location(s)`,
                count: locations.length,
                locations: locations,
                success: true,
              }),
            },
          ],
        };
      },
    );

    // Get location details tool
    this.server.tool(
      "get_location_details",
      "Retrieves detailed information about a specific Kroger store location using its location ID. Use this tool when the user needs comprehensive information about a particular store, including address, hours, departments, and geolocation.",
      {
        locationId: z.string().length(8, {
          message: "Location ID must be exactly 8 characters long",
        }),
      },
      async ({ locationId }) => {
        // Make the API call to get location details
        const { data, error } = await locationClient.GET(
          "/v1/locations/{locationId}",
          {
            params: { path: { locationId } },
          },
        );

        if (error) {
          console.error("Error getting location details:", error);
          throw new Error(
            `Failed to get location details: ${JSON.stringify(error)}`,
          );
        }

        const location = data?.data;
        if (!location) {
          throw new Error(
            `No information found for location ID: ${locationId}`,
          );
        }

        console.log(`Retrieved details for location: ${location.name}`);

        // Return successful response
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                location: location,
                success: true,
              }),
            },
          ],
        };
      },
    );
    // Search products tool
    this.server.tool(
      "search_products",
      "Searches for Kroger products based on various filter criteria. Use this tool when the user wants to find products by search term, brand, product ID, or other filters. Provides essential product details including pricing, availability.",
      {
        term: z
          .string()
          .max(100)
          .optional()
          .describe("Search term for products (e.g., 'milk', 'bread')"),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .describe(
            "Location ID to check product availability at a specific store",
          ),
        productId: z
          .string()
          .optional()
          .describe("Comma-separated list of specific product IDs to return"),
        start: z
          .number()
          .nonnegative()
          .optional()
          .describe("Number of products to skip (for pagination)"),
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .describe("Number of products to return (maximum 50)")
          .default(10),
      },
      async ({ term, locationId, productId, start, limit }) => {
        // Validate that at least one search parameter is provided
        if (!term && !productId) {
          throw new Error(
            "At least one search parameter (term, productId, or brand) must be provided",
          );
        }

        // Build query parameters
        const queryParams: Record<string, string | number> = {};

        // Add required search parameters
        if (term) {
          queryParams["filter.term"] = term;
        }
        if (productId) {
          queryParams["filter.productId"] = productId;
        }

        // Add optional parameters
        if (locationId) {
          queryParams["filter.locationId"] = locationId;
        }
        queryParams["filter.fulfillment"] = "ais";
        if (start !== undefined) {
          queryParams["filter.start"] = start;
        }
        if (limit !== undefined) {
          queryParams["filter.limit"] = limit;
        } else {
          // Default limit to avoid too many results
          queryParams["filter.limit"] = 10;
        }

        // Make the API call to search for products
        const { data, error } = await productClient.GET("/v1/products", {
          params: {
            query: queryParams,
          },
        });

        if (error) {
          console.error("Error searching products:", error);
          throw new Error(
            `Failed to search products: ${JSON.stringify(error)}`,
          );
        }

        // Format the response for display
        const products = data?.data || [];
        console.log(`Found ${products.length} products`);

        if (products.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  message: "No products found matching your search criteria.",
                  count: 0,
                  products: [],
                  success: true,
                }),
              },
            ],
          };
        }

        // Return a successful response
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Found ${products.length} products`,
                count: products.length,
                products: products,
                success: true,
              }),
            },
          ],
        };
      },
    );

    // Get product details tool
    this.server.tool(
      "get_product_details",
      "Retrieves detailed information about a specific Kroger product using its product ID. Use this tool when the user needs comprehensive details about a particular product, including pricing, availability, nutritional information, and images.",
      {
        productId: z
          .string()
          .length(13, { message: "Product ID must be a 13-digit UPC number" }),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "Location ID to check product availability and pricing at a specific store",
          ),
      },
      async ({ productId, locationId }) => {
        // Build query parameters
        const queryParams: Record<string, string> = {};

        if (locationId) {
          queryParams["filter.locationId"] = locationId;
        }

        // Make the API call to get product details
        const { data, error } = await productClient.GET("/v1/products/{id}", {
          params: {
            path: { id: productId },
            query: queryParams,
          },
        });

        if (error) {
          console.error("Error getting product details:", error);
          throw new Error(
            `Failed to get product details: ${JSON.stringify(error)}`,
          );
        }

        const product = data.data;
        if (!product) {
          throw new Error(`No information found for product ID: ${productId}`);
        }

        console.log(`Retrieved details for product: ${product.description}`);

        // Return successful response
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                product: product,
                success: true,
              }),
            },
          ],
        };
      },
    );
  }
}
export default new OAuthProvider({
  apiRoute: "/sse",
  // @ts-ignore
  apiHandler: MyMCP.mount("/sse"),
  // @ts-ignore
  defaultHandler: KrogerHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
