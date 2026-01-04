import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import dotenv from "dotenv";
import { z } from "zod";
import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import type { components } from "./services/kroger/cart.js";
import {
  cartClient,
  configureKrogerAuth,
  isKrogerTokenExpiring,
  type KrogerTokenInfo,
  locationClient,
  productClient,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import type {
  Coupon,
  CouponsResponse,
} from "./services/kroger/weekly-deals.js";
import {
  formatLocation,
  formatLocationList,
  formatOrderHistory,
  formatPantryList,
  formatPreferredLocation,
  formatProductList,
  formatWeeklyDealsList,
  type WeeklyDeal,
} from "./utils/format-response.js";
import {
  createUserStorage,
  type OrderRecord,
  type PantryItem,
  type PreferredLocation,
} from "./utils/user-storage.js";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
  id: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  // Kroger credentials stored for token refresh in tokenExchangeCallback
  krogerClientId: string;
  krogerClientSecret: string;
};

dotenv.config();

export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "kroger-ai-assistant",
    version: "1.0.0",
  });

  async init() {
    // Register MCP prompts for guided workflows
    registerPrompts(this.server);

    // Configure Kroger auth for all clients
    configureKrogerAuth((): KrogerTokenInfo | null => {
      // Return current token info from props
      if (!this.props?.accessToken) return null;

      return {
        accessToken: this.props.accessToken,
        refreshToken: this.props.refreshToken,
        tokenExpiresAt: this.props.tokenExpiresAt,
        // Use credentials from props (stored during initial auth)
        krogerClientId: this.props.krogerClientId,
        krogerClientSecret: this.props.krogerClientSecret,
      };
    });

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

        // Return a successful response with formatted text
        const formattedLocations = formatLocationList(locations);

        return {
          content: [
            {
              type: "text",
              text: `Found ${locations.length} location(s):\n\n${formattedLocations}`,
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

        // Return successful response with formatted text
        const formattedLocation = formatLocation(location);

        return {
          content: [
            {
              type: "text",
              text: `Location Details:\n\n${formattedLocation}`,
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
          .min(6)
          .max(50)
          .optional()
          .describe("Number of products to return (minimum 6, maximum 50)")
          .default(15),
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

        // Sort products: pickup in-stock first, then delivery-only, then out-of-stock last
        products.sort((a, b) => {
          const aItem = a.items?.[0];
          const bItem = b.items?.[0];
          const aPickup =
            aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
          const bPickup =
            bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

          // Pickup available items come first
          if (aPickup && !bPickup) return -1;
          if (!aPickup && bPickup) return 1;
          return 0;
        });

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

        // Return a successful response with formatted products
        const formattedProducts = formatProductList(products);

        return {
          content: [
            {
              type: "text",
              text: `Found ${products.length} product(s):\n\n${formattedProducts}`,
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

        // Return successful response with formatted product
        const formattedProduct = formatProductList([product]);

        return {
          content: [
            {
              type: "text",
              text: `Product Details:\n\n${formattedProduct}`,
            },
          ],
        };
      },
    );

    // Get coupons tool
    this.server.tool(
      "get_coupons",
      "Retrieves available digital coupons from QFC/Kroger. Use this tool when the user wants to see coupons, digital deals, or savings offers. Returns active coupons that can be clipped to the user's loyalty card. Example: 'Show me available coupons' or 'What coupons are available?'",
      {
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .describe("The store location ID to get coupons for")
          .default("70500847"),
        facilityId: z
          .string()
          .describe("The facility ID for the store")
          .default("4468"),
        filterWeeklyDeals: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, only show Weekly Digital Deals (WDD) and Expiring For You (EFY) coupons",
          ),
      },
      async ({ locationId, facilityId, filterWeeklyDeals }) => {
        try {
          console.log(
            "Fetching coupons for location:",
            locationId,
            "facility:",
            facilityId,
          );

          // Build request matching the exact working browser request
          const headers = new Headers();

          // x-laf-object with location details - using exact structure from working request
          const xLafObject = [
            {
              modality: {
                type: "PICKUP",
                handoffLocation: {
                  storeId: locationId,
                  facilityId: facilityId,
                },
                handoffAddress: {
                  address: {
                    addressLines: ["1401 Broadway"],
                    cityTown: "Seattle",
                    name: "Harvard Market",
                    postalCode: "98122",
                    stateProvince: "WA",
                    residential: false,
                    countryCode: "US",
                  },
                  location: {
                    lat: 47.6137629,
                    lng: -122.3211541,
                  },
                },
              },
              sources: [
                {
                  storeId: locationId,
                  facilityId: facilityId,
                },
              ],
              assortmentKeys: ["edec10f5-2d40-4941-a280-2a405a537dcb"],
              listingKeys: [locationId],
            },
            {
              modality: {
                type: "IN_STORE",
                handoffLocation: {
                  storeId: locationId,
                  facilityId: facilityId,
                },
                handoffAddress: {
                  address: {
                    addressLines: ["1401 Broadway"],
                    cityTown: "Seattle",
                    name: "Harvard Market",
                    postalCode: "98122",
                    stateProvince: "WA",
                    residential: false,
                    countryCode: "US",
                  },
                  location: {
                    lat: 47.6137629,
                    lng: -122.3211541,
                  },
                },
              },
              sources: [
                {
                  storeId: locationId,
                  facilityId: facilityId,
                },
              ],
              assortmentKeys: ["41352481-ccbf-41a3-9c25-37ef5bd7ff9f"],
              listingKeys: [locationId],
            },
            {
              modality: {
                type: "DELIVERY",
                handoffAddress: {
                  address: {
                    postalCode: "98122",
                    stateProvince: "WA",
                    countryCode: "US",
                    county: "King County",
                  },
                  location: {
                    lat: 47.61154175,
                    lng: -122.31268311,
                  },
                },
              },
              sources: [
                {
                  storeId: locationId,
                  facilityId: facilityId,
                },
                {
                  storeId: "70500887",
                  facilityId: "16715",
                },
              ],
              assortmentKeys: ["fc64173a-28f6-4d21-8da5-1c6b1f3238d1"],
              listingKeys: [locationId, "70500887"],
            },
          ];

          // Set headers exactly as in the working browser request
          headers.set("accept", "application/json, text/plain, */*");
          headers.set("accept-language", "en-US,en;q=0.9,es;q=0.8");
          headers.set("device-memory", "8");
          headers.set("priority", "u=1, i");
          headers.set(
            "sec-ch-ua",
            '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
          );
          headers.set("sec-ch-ua-mobile", "?0");
          headers.set("sec-ch-ua-platform", '"Windows"');
          headers.set("sec-fetch-dest", "empty");
          headers.set("sec-fetch-mode", "cors");
          headers.set("sec-fetch-site", "same-origin");
          headers.set(
            "x-ab-test",
            '[{"testVersion":"B","testID":"76503b","testOrigin":"f4"},{"testVersion":"B","testID":"76503b","testOrigin":"f4"}]',
          );
          headers.set(
            "x-call-origin",
            '{"page":"coupons","component":"ALL_COUPONS"}',
          );
          headers.set("x-facility-id", facilityId);
          headers.set("x-kroger-channel", "WEB");
          headers.set("x-laf-object", JSON.stringify(xLafObject));
          headers.set(
            "x-modality",
            `{"type":"PICKUP","locationId":"${locationId}"}`,
          );
          headers.set("x-modality-type", "PICKUP");

          console.log("Request headers set");

          // Build URL exactly as in working request
          const couponsUrl = new URL(
            "https://www.qfc.com/atlas/v1/savings-coupons/v1/coupons",
          );
          couponsUrl.searchParams.append("projections", "coupons.compact");
          couponsUrl.searchParams.append("filter.status", "unclipped");
          couponsUrl.searchParams.append("filter.status", "active");
          couponsUrl.searchParams.append("page.size", "24");
          couponsUrl.searchParams.append("page.offset", "0");

          console.log("Fetching coupons from:", couponsUrl.toString());

          const response = await fetch(couponsUrl.toString(), {
            method: "GET",
            headers,
          });

          console.log("Response status:", response.status, response.statusText);

          if (!response.ok) {
            const errorText = await response.text();
            console.error("Error response status:", response.status);
            console.error("Error response body:", errorText.substring(0, 500));
            throw new Error(
              `Failed to fetch coupons: ${response.status} ${response.statusText}`,
            );
          }

          const responseText = await response.text();
          console.log("Response body length:", responseText.length);

          const couponsData: CouponsResponse = JSON.parse(responseText);
          const coupons = couponsData.data.coupons;

          console.log(`Found ${coupons.length} total coupons`);

          if (coupons.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No coupons found for this location at this time.",
                },
              ],
            };
          }

          // Optionally filter for Weekly Digital Deals (WDD) and Expiring For You (EFY)
          const displayCoupons = filterWeeklyDeals
            ? coupons.filter((coupon: Coupon) =>
                coupon.specialSavings?.some(
                  (saving) => saving.name === "WDD" || saving.name === "EFY",
                ),
              )
            : coupons;

          console.log(
            `Displaying ${displayCoupons.length} coupons${filterWeeklyDeals ? " (filtered for WDD/EFY)" : ""}`,
          );

          if (displayCoupons.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: filterWeeklyDeals
                    ? "No weekly digital deals found at this time. Check back later for new deals!"
                    : "No coupons found for this location at this time.",
                },
              ],
            };
          }

          // Format coupons for display
          const formattedDeals: WeeklyDeal[] = displayCoupons
            .slice(0, 25)
            .map((coupon: Coupon) => ({
              product: coupon.displayDescription || coupon.shortDescription,
              details: coupon.brand,
              price: `Save $${coupon.value.toFixed(2)}`,
              savings: coupon.categories.join(", "),
              loyalty: `Use up to ${coupon.redemptionsAllowed}x`,
              department: coupon.categories[0] || "General",
              validFrom: new Date(coupon.displayStartDate).toLocaleDateString(),
              validTill: new Date(coupon.displayEndDate).toLocaleDateString(),
              disclaimer: coupon.requirementDescription,
            }));

          // Format the deals list
          const formattedDealsList = formatWeeklyDealsList(formattedDeals);

          // Get date range from first coupon
          const dateRange =
            displayCoupons.length > 0
              ? `Valid: ${new Date(displayCoupons[0].displayStartDate).toLocaleDateString()} - ${new Date(displayCoupons[0].displayEndDate).toLocaleDateString()}`
              : "";

          const title = filterWeeklyDeals
            ? "Weekly Digital Deals"
            : "Available Coupons";

          // Return successful response
          return {
            content: [
              {
                type: "text",
                text: `Found ${displayCoupons.length} ${filterWeeklyDeals ? "weekly deal coupons" : "coupons"} (showing ${Math.min(25, displayCoupons.length)}):\n\n**${title}**\n${dateRange}\n\n${formattedDealsList}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error fetching coupons:", error);
          console.error("Error details:", {
            name: error instanceof Error ? error.name : "Unknown",
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : "No stack trace",
          });
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch coupons: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          };
        }
      },
    );

    // Set preferred location tool
    this.server.tool(
      "set_preferred_location",
      "Sets the user's preferred store location for future shopping. Use this when the user wants to save their favorite store. This makes it easier to search products and check deals without specifying location each time.",
      {
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" }),
      },
      async ({ locationId }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        // Get location details to store complete information
        const { data, error } = await locationClient.GET(
          "/v1/locations/{locationId}",
          {
            params: { path: { locationId } },
          },
        );

        if (error || !data?.data) {
          throw new Error(
            `Failed to get location details: ${JSON.stringify(error)}`,
          );
        }

        const location = data.data;
        const storage = createUserStorage(this.env.USER_DATA_KV);

        const preferredLocation: PreferredLocation = {
          locationId: location.locationId || "",
          locationName: location.name || "",
          address:
            `${location.address?.addressLine1 || ""}, ${location.address?.city || ""}, ${location.address?.state || ""} ${location.address?.zipCode || ""}`.trim(),
          chain: location.chain || "",
          setAt: new Date().toISOString(),
        };

        await storage.preferredLocation.set(this.props.id, preferredLocation);

        const formatted = formatPreferredLocation(preferredLocation);

        return {
          content: [
            {
              type: "text",
              text: `Preferred location set successfully:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Get preferred location tool
    this.server.tool(
      "get_preferred_location",
      "Retrieves the user's saved preferred store location. Use this to check which store the user has set as their default for shopping.",
      {},
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const location = await storage.preferredLocation.get(this.props.id);

        if (!location) {
          return {
            content: [
              {
                type: "text",
                text: "No preferred location set. Use set_preferred_location to save your favorite store.",
              },
            ],
          };
        }

        const formatted = formatPreferredLocation(location);

        return {
          content: [
            {
              type: "text",
              text: `Your preferred location:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Add to pantry tool
    this.server.tool(
      "add_to_pantry",
      "Adds items to your personal pantry inventory. Use this to track what groceries you already have at home. Helps avoid buying duplicates and manage inventory.",
      {
        items: z.array(
          z.object({
            productId: z
              .string()
              .length(13, { message: "Product ID must be 13 digits" }),
            productName: z.string(),
            quantity: z.number().min(1),
            expiresAt: z.string().optional(),
          }),
        ),
      },
      async ({ items }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const now = new Date().toISOString();

        for (const item of items) {
          const pantryItem: PantryItem = {
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            addedAt: now,
            expiresAt: item.expiresAt,
          };

          await storage.pantry.add(this.props.id, pantryItem);
        }

        const pantry = await storage.pantry.getAll(this.props.id);
        const formatted = formatPantryList(pantry);

        return {
          content: [
            {
              type: "text",
              text: `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Remove from pantry tool
    this.server.tool(
      "remove_from_pantry",
      "Removes an item from your pantry inventory. Use this when you've used up an item or want to remove it from tracking.",
      {
        productId: z
          .string()
          .length(13, { message: "Product ID must be 13 digits" }),
      },
      async ({ productId }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        await storage.pantry.remove(this.props.id, productId);

        const pantry = await storage.pantry.getAll(this.props.id);
        const formatted = formatPantryList(pantry);

        return {
          content: [
            {
              type: "text",
              text: `Item removed from pantry.\n\nYour pantry:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // View pantry tool
    this.server.tool(
      "view_pantry",
      "Displays all items currently in your pantry inventory. Use this to see what groceries you have at home before shopping.",
      {},
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const pantry = await storage.pantry.getAll(this.props.id);
        const formatted = formatPantryList(pantry);

        return {
          content: [
            {
              type: "text",
              text: `Your pantry (${pantry.length} items):\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // Clear pantry tool
    this.server.tool(
      "clear_pantry",
      "Removes all items from your pantry inventory. Use this to start fresh with pantry tracking.",
      {},
      async () => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        await storage.pantry.clear(this.props.id);

        return {
          content: [
            {
              type: "text",
              text: "Pantry cleared successfully.",
            },
          ],
        };
      },
    );

    // Mark order placed tool
    this.server.tool(
      "mark_order_placed",
      "Records a completed order in your order history. Use this after successfully placing an order to track your purchases over time.",
      {
        items: z.array(
          z.object({
            productId: z.string(),
            productName: z.string(),
            quantity: z.number().min(1),
            price: z.number().optional(),
          }),
        ),
        locationId: z.string().optional(),
        notes: z.string().optional(),
      },
      async ({ items, locationId, notes }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);

        // Generate order ID with timestamp
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
        const estimatedTotal = items.reduce((sum, item) => {
          return sum + (item.price || 0) * item.quantity;
        }, 0);

        const order: OrderRecord = {
          orderId,
          items,
          totalItems,
          estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
          placedAt: new Date().toISOString(),
          locationId,
          notes,
        };

        await storage.orderHistory.add(this.props.id, order);

        const formatted = formatOrderHistory([order]);

        return {
          content: [
            {
              type: "text",
              text: `Order recorded successfully:\n\n${formatted}`,
            },
          ],
        };
      },
    );

    // View order history tool
    this.server.tool(
      "view_order_history",
      "Displays your past order history. Use this to see previous purchases and track shopping patterns. Returns most recent orders first.",
      {
        limit: z
          .number()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Number of recent orders to display"),
      },
      async ({ limit }) => {
        if (!this.props?.id) {
          throw new Error("User not authenticated");
        }

        const storage = createUserStorage(this.env.USER_DATA_KV);
        const orders = await storage.orderHistory.getRecent(
          this.props.id,
          limit,
        );

        const formatted = formatOrderHistory(orders);

        return {
          content: [
            {
              type: "text",
              text: `Order History (${orders.length} recent orders):\n\n${formatted}`,
            },
          ],
        };
      },
    );
  }
}
export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: MyMCP.mount("/sse"),
  // @ts-expect-error - Hono handler type mismatch with OAuthProvider
  defaultHandler: KrogerHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",

  /**
   * Token exchange callback - syncs Kroger tokens during MCP token refresh.
   *
   * CRITICAL: This is the ONLY place where Kroger tokens are refreshed.
   * Kroger uses single-use refresh tokens - once used, they're invalidated.
   * This callback is the only place that can persist the new refresh token
   * to the grant. Middleware does NOT refresh to avoid token conflicts.
   *
   * When the MCP token expires, this callback:
   * 1. Checks if Kroger token is expiring (5-minute buffer)
   * 2. Uses the refresh token to get new access + refresh tokens
   * 3. Saves new tokens to props (persisted in the grant)
   * 4. Matches MCP token TTL to Kroger's for synchronized expiry
   */
  tokenExchangeCallback: async ({ grantType, props }) => {
    // Only handle refresh token grants
    if (grantType !== "refresh_token") {
      console.log(
        `Token exchange callback: ignoring grant type "${grantType}"`,
      );
      return {};
    }

    const typedProps = props as Props;

    // Check if we have a refresh token and credentials
    if (!typedProps?.refreshToken || !typedProps?.tokenExpiresAt) {
      console.warn(
        "Token exchange callback: No Kroger refresh token or expiry available",
        {
          hasRefreshToken: !!typedProps?.refreshToken,
          hasTokenExpiresAt: !!typedProps?.tokenExpiresAt,
        },
      );
      return {};
    }

    if (!typedProps?.krogerClientId || !typedProps?.krogerClientSecret) {
      console.warn(
        "Token exchange callback: No Kroger credentials in props. This should not happen.",
      );
      return {};
    }

    // Check if Kroger token is expiring (with 5-minute buffer)
    const tokenExpiresIn = typedProps.tokenExpiresAt - Date.now();
    if (!isKrogerTokenExpiring(typedProps.tokenExpiresAt)) {
      console.log(
        `Token exchange callback: Kroger token still valid (expires in ${Math.round(tokenExpiresIn / 1000)}s), no refresh needed`,
      );
      return {};
    }

    try {
      console.log(
        `Token exchange callback: Refreshing Kroger token (expires in ${Math.round(tokenExpiresIn / 1000)}s)...`,
      );

      const refreshResult = await refreshKrogerToken(
        typedProps.refreshToken,
        typedProps.krogerClientId,
        typedProps.krogerClientSecret,
      );

      console.log(
        `Token exchange callback: Kroger token refreshed successfully. New token expires in ${refreshResult.expiresIn}s`,
      );

      // CRITICAL: Kroger returns a NEW refresh token that must be saved
      // The old refresh token is now invalid (single-use tokens)
      if (!refreshResult.refreshToken) {
        console.error(
          "Token exchange callback: CRITICAL - Kroger refresh response missing new refresh token. " +
            "Old refresh token is now invalid (single-use). User will need to re-authenticate.",
        );
        // Return empty object - this will cause the next refresh to fail,
        // triggering re-authentication flow
        return {};
      }

      return {
        // Update props with new Kroger tokens
        newProps: {
          ...typedProps,
          accessToken: refreshResult.accessToken,
          // MUST use new refresh token (old one is invalid)
          refreshToken: refreshResult.refreshToken,
          tokenExpiresAt: refreshResult.tokenExpiresAt,
        },
        // Match MCP access token TTL to Kroger's to keep them in sync
        accessTokenTTL: refreshResult.expiresIn,
      };
    } catch (error) {
      console.error(
        "Token exchange callback: Failed to refresh Kroger token:",
        error instanceof Error ? error.message : String(error),
      );
      // Return empty to keep existing props - user will need to re-authenticate
      // if the token can't be refreshed
      return {};
    }
  },
});
