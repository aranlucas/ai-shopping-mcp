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
      title: "Search Store Locations",
      description:
        "Searches for Kroger/QFC store locations by zip code and chain name.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
        return {
          content: [
            {
              type: "text",
              text: `Failed to search locations: ${JSON.stringify(error)}`,
            },
          ],
          isError: true,
        };
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
      title: "Get Store Details",
      description:
        "Retrieves detailed information about a specific Kroger store by its location ID, including address, hours, and departments.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
        return {
          content: [
            {
              type: "text",
              text: `Failed to get location details: ${JSON.stringify(error)}`,
            },
          ],
          isError: true,
        };
      }

      const location = data?.data;
      if (!location) {
        return {
          content: [
            {
              type: "text",
              text: `No information found for location ID: ${locationId}`,
            },
          ],
          isError: true,
        };
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
      title: "Set Preferred Store",
      description:
        "Saves a store as your preferred location for future product searches and cart operations.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
        return {
          content: [
            {
              type: "text",
              text: `Failed to get location details: ${JSON.stringify(error)}`,
            },
          ],
          isError: true,
        };
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
