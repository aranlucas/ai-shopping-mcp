import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { z } from "zod";
import { KrogerHandler } from "./kroger-handler";
import type { components } from "./services/kroger/cart";
import {
  cartClient,
  locationClient,
  productClient,
} from "./services/kroger/client";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
  accessToken: string;
};

dotenv.config();

export class MyMCP extends McpAgent<Props, Env> {
  server = new McpServer({
    name: "kroger-ai-assistant",
    version: "1.0.0",
  });

  async init() {
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
              Authorization: `Bearer ${this.props.accessToken}`,
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
      async (args, extras) => {
        console.error("Received arguments:", extras);
        try {
          const { zipCodeNear, limit, chain } = args;
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
            headers: {
              Authorization: `Bearer ${this.props.accessToken}`,
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

          // Format as text to avoid json content type issues
          const locationsText = locations
            .map((location, index) => {
              return `
                Location ${index + 1}: ${location.name} (ID: ${
                  location.locationId
                })
                Address: ${
                  location.address
                    ? `${location.address.addressLine1}, ${location.address.city}, ${location.address.state} ${location.address.zipCode}`
                    : "Address not available"
                }
                `.trim();
            })
            .join("\n\n");

          // Return a successful response
          return {
            content: [
              {
                type: "text",
                text: `Found ${locations.length} location(s):\n\n${locationsText}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error in search-locations tool:", error);
          throw error;
        }
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
      async (args, extras) => {
        try {
          const { locationId } = args;

          // Make the API call to get location details
          const { data, error } = await locationClient.GET(
            "/v1/locations/{locationId}",
            {
              params: { path: { locationId } },
              headers: {
                Authorization: `Bearer ${this.props.accessToken}`,
              },
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

          // Format departments if available
          let departmentsText = "No departments information available";
          if (location.departments && location.departments.length > 0) {
            departmentsText = `Departments (${location.departments.length}):\n`;
            for (const dept of location.departments) {
              departmentsText += `- ${dept.name} (ID: ${dept.departmentId})`;
              if (dept.phone) departmentsText += `, Phone: ${dept.phone}`;
              departmentsText += "\n";
            }
          }

          // Create a formatted text response with all details
          const detailsText = `
            Location: ${location.name} (ID: ${location.locationId})
            Chain: ${location.chain || "N/A"}
            Phone: ${location.phone || "N/A"}
            Division: ${location.divisionNumber || "N/A"}, Store: ${
              location.storeNumber || "N/A"
            }
            `.trim();

          // Return successful response
          return {
            content: [
              {
                type: "text",
                text: detailsText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in get-location-details tool:", error);
          throw error;
        }
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
      async (args, extras) => {
        console.log(extras);
        try {
          const { term, locationId, productId, start, limit } = args;

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
            headers: {
              Authorization: `Bearer ${this.props.accessToken}`,
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
                  text: "No products found matching your search criteria.",
                },
              ],
            };
          }

          // Format as text to maintain compatibility
          let productsText = `Found ${products.length} products:\n\n`;

          products.forEach((product, index) => {
            const item =
              product.items && product.items.length > 0
                ? product.items[0]
                : null;
            const price = item?.price;
            const inventory = item?.inventory;
            const fulfillment = item?.fulfillment;

            productsText += `${index + 1}. ${product.description || "Unnamed Product"} (ID: ${product.productId})\n`;
            productsText += `   Brand: ${product.brand || "N/A"}\n`;

            if (price) {
              const currentPrice = price.promo || price.regular;
              const wasPrice = price.promo ? price.regular : null;

              productsText += `   Price: $${currentPrice?.toFixed(2)}`;
              if (wasPrice && price.promo) {
                productsText += ` (Was: $${wasPrice.toFixed(2)})`;
              }
              productsText += "\n";
            }

            if (item?.size) {
              productsText += `   Size: ${item.size}\n`;
            }

            if (inventory) {
              productsText += `   Stock: ${inventory.stockLevel || "Unknown"}\n`;
            }

            if (fulfillment) {
              const options = [];
              if (fulfillment.instore) options.push("In Store");
              if (fulfillment.curbside) options.push("Curbside Pickup");
              if (fulfillment.delivery) options.push("Delivery");
              if (fulfillment.shiptohome) options.push("Ship to Home");

              if (options.length > 0) {
                productsText += `   Available for: ${options.join(", ")}\n`;
              }
            }

            productsText += "\n";
          });

          // Return a successful response
          return {
            content: [
              {
                type: "text",
                text: productsText.trim(),
              },
            ],
          };
        } catch (error) {
          console.error("Error in search-products tool:", error);
          throw error;
        }
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
      async (args, extras) => {
        try {
          const { productId, locationId } = args;

          // Build query parameters
          const queryParams: Record<string, string | number> = {};

          if (locationId) {
            queryParams["filter.locationId"] = locationId;
          }

          // Make the API call to get product details
          const { data, error } = await productClient.GET("/v1/products/{id}", {
            params: {
              path: { id: productId },
              query: queryParams,
            },
            headers: {
              Authorization: `Bearer ${this.props.accessToken}`,
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
            throw new Error(
              `No information found for product ID: ${productId}`,
            );
          }

          console.log(`Retrieved details for product: ${product.description}`);

          // Format as text for the response
          let detailsText = `${product.description || "Product"} (ID: ${product.productId})\n`;
          detailsText += `Brand: ${product.brand || "N/A"}\n\n`;

          // Format item details (price, availability, etc.)
          if (product.items && product.items.length > 0) {
            const item = product.items[0];

            if (item.size) {
              detailsText += `Size: ${item.size}\n`;
            }

            if (item.soldBy) {
              detailsText += `Sold by: ${item.soldBy}\n`;
            }

            if (item.price) {
              detailsText += "\nPricing:\n";
              if (item.price.regular) {
                detailsText += `Regular price: $${item.price.regular.toFixed(2)}\n`;
              }
              if (item.price.promo) {
                detailsText += `Sale price: $${item.price.promo.toFixed(2)}\n`;
              }
              if (item.price.regularPerUnitEstimate) {
                detailsText += `Unit price: $${item.price.regularPerUnitEstimate.toFixed(2)}\n`;
              }
            }

            if (item.inventory?.stockLevel) {
              detailsText += `\nStock level: ${item.inventory.stockLevel}\n`;
            }

            if (item.fulfillment) {
              detailsText += "\nAvailability:\n";
              detailsText += `In-store: ${item.fulfillment.instore ? "Yes" : "No"}\n`;
              detailsText += `Curbside pickup: ${item.fulfillment.curbside ? "Yes" : "No"}\n`;
              detailsText += `Delivery: ${item.fulfillment.delivery ? "Yes" : "No"}\n`;
              detailsText += `Ship to home: ${item.fulfillment.shiptohome ? "Yes" : "No"}\n`;
            }
          }

          // Add temperature information if available
          if (product.temperature) {
            detailsText += "\nStorage:\n";
            if (product.temperature.indicator) {
              detailsText += `Temperature: ${product.temperature.indicator}\n`;
            }
            detailsText += `Heat sensitive: ${product.temperature.heatSensitive ? "Yes" : "No"}\n`;
          }

          // Add country of origin if available
          if (product.countryOrigin) {
            detailsText += `\nCountry of origin: ${product.countryOrigin}\n`;
          }

          // Add categories if available
          if (product.categories && product.categories.length > 0) {
            detailsText += `\nCategories: ${product.categories.join(", ")}\n`;
          }

          // Add aisle location information if available
          if (
            locationId &&
            product.aisleLocations &&
            product.aisleLocations.length > 0
          ) {
            const location = product.aisleLocations[0];
            detailsText += "\nStore Location:\n";
            if (location.description) {
              detailsText += `${location.description}\n`;
            } else if (location.number) {
              detailsText += `Aisle ${location.number}`;
              if (location.side) {
                detailsText += `, Side ${location.side}`;
              }
              detailsText += "\n";
            }

            if (location.shelfNumber) {
              detailsText += `Shelf ${location.shelfNumber}\n`;
            }
          }

          // Add product link if available
          if (product.productPageURI) {
            detailsText += `\nProduct page: https://www.kroger.com${product.productPageURI}\n`;
          }

          // Return successful response
          return {
            content: [
              {
                type: "text",
                text: detailsText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in get-product-details tool:", error);
          throw error;
        }
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
