import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Props } from "../server.js";
import { locationClient } from "../services/kroger/client.js";
import {
  formatLocation,
  formatLocationListCompact,
  formatPreferredLocationCompact,
} from "../utils/format-response.js";
import {
  createUserStorage,
  type PreferredLocation,
} from "../utils/user-storage.js";

/**
 * Registers location-related tools with the MCP server.
 *
 * Tools:
 * - search_locations: Find stores by zip code, chain name, etc.
 * - get_location_details: Get detailed info about a specific store
 * - set_preferred_location: Save user's preferred store
 * - get_preferred_location: Retrieve saved preferred store
 */
export function registerLocationTools(
  server: McpServer,
  env: Env,
  getProps: () => Props | undefined,
) {
  // Search locations tool
  server.registerTool(
    "search_locations",
    {
      description:
        "Searches for Kroger store locations based on various filter criteria. Use this tool when the user needs to find nearby Kroger stores or specific store locations. Locations can be searched by zip code, latitude/longitude coordinates, radius, chain name, or department availability.",
      inputSchema: z.object({
        zipCodeNear: z
          .string()
          .length(5, { message: "Zip code must be exactly 5 digits" })
          .default("98122"),
        limit: z.number().min(1).max(200).optional().default(1),
        chain: z.string().optional().default("QFC"),
      }),
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
        throw new Error(`Failed to search locations: ${JSON.stringify(error)}`);
      }

      // Format the response for display
      const locations = data?.data || [];
      console.log(`Found ${locations.length} locations`);

      // Return a successful response with compact formatting
      const formattedLocations = formatLocationListCompact(locations);

      return {
        content: [
          {
            type: "text",
            text: `Found ${locations.length} location(s):\n${formattedLocations}`,
          },
        ],
      };
    },
  );

  // Get location details tool
  server.registerTool(
    "get_location_details",
    {
      description:
        "Retrieves detailed information about a specific Kroger store location using its location ID. Use this tool when the user needs comprehensive information about a particular store, including address, hours, departments, and geolocation.",
      inputSchema: z.object({
        locationId: z.string().length(8, {
          message: "Location ID must be exactly 8 characters long",
        }),
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
        throw new Error(`No information found for location ID: ${locationId}`);
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

  // Set preferred location tool
  server.registerTool(
    "set_preferred_location",
    {
      description:
        "Sets the user's preferred store location for future shopping. Use this when the user wants to save their favorite store. This makes it easier to search products and check deals without specifying location each time.",
      inputSchema: z.object({
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" }),
      }),
    },
    async ({ locationId }) => {
      const props = getProps();
      if (!props?.id) {
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
      const storage = createUserStorage(env.USER_DATA_KV);

      const preferredLocation: PreferredLocation = {
        locationId: location.locationId || "",
        locationName: location.name || "",
        address:
          `${location.address?.addressLine1 || ""}, ${location.address?.city || ""}, ${location.address?.state || ""} ${location.address?.zipCode || ""}`.trim(),
        chain: location.chain || "",
        setAt: new Date().toISOString(),
      };

      await storage.preferredLocation.set(props.id, preferredLocation);

      const formatted = formatPreferredLocationCompact(preferredLocation);

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
  server.registerTool(
    "get_preferred_location",
    {
      description:
        "Retrieves the user's saved preferred store location. Use this to check which store the user has set as their default for shopping.",
      inputSchema: z.object({}),
    },
    async () => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);
      const location = await storage.preferredLocation.get(props.id);

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

      const formatted = formatPreferredLocationCompact(location);

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
}
