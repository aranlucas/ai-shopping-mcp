import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productClient } from "../services/kroger/client";

export function registerProductTools(server: McpServer) {
  // Search products tool
  server.tool(
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
            Authorization: `Bearer ${process.env.KROGER_USER_TOKEN}`,
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
            product.items && product.items.length > 0 ? product.items[0] : null;
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
  server.tool(
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
            Authorization: `Bearer ${process.env.KROGER_USER_TOKEN}`,
          },
        });

        if (error) {
          console.error("Error getting product details:", error);
          throw new Error(
            `Failed to get product details: ${JSON.stringify(error)}`,
          );
        }

        const product = data?.data;
        if (!product) {
          throw new Error(`No information found for product ID: ${productId}`);
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
