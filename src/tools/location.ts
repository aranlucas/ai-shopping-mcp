import { z } from "zod";
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
import { requireAuth, type ToolContext } from "./types.js";

export function registerLocationTools(ctx: ToolContext) {
  ctx.server.registerTool(
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
      const queryParams: Record<string, string | number> = {};

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
      const { data, error } = await locationClient.GET("/v1/locations", {
        params: {
          query: queryParams,
        },
      });

      if (error) {
        console.error("Error searching locations:", error);
        throw new Error(`Failed to search locations: ${JSON.stringify(error)}`);
      }

      const locations = data?.data || [];
      console.log(`Found ${locations.length} locations`);

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

  ctx.server.registerTool(
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

  ctx.server.registerTool(
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
      const props = requireAuth(ctx);

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
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);

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
}
