import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { err, ok } from "neverthrow";
import * as z from "zod/v4";
import { notFoundError } from "../errors.js";
import {
  formatLocation,
  formatLocationListCompact,
  formatPreferredLocationCompact,
} from "../utils/format-response.js";
import { fromApiResponse, requireAuth, safeStorage, toMcpResponse } from "../utils/result.js";
import type { PreferredLocation } from "../utils/user-storage.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import type { ToolContext } from "./types.js";

export function registerLocationTools(ctx: ToolContext) {
  const { locationClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "search_locations",
    {
      title: "Search Store Locations",
      description: "Searches for Kroger/QFC store locations by zip code and chain name.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
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

      const result = await fromApiResponse(
        locationClient.GET("/v1/locations", {
          params: { query: queryParams },
        }),
        "search locations",
      ).map((data) => {
        const locations = data?.data || [];
        return {
          locations,
          text: `Found ${locations.length} location(s):\n${formatLocationListCompact(locations)}`,
        };
      });

      if (result.isErr()) {
        return toMcpResponse(result.map(() => ""));
      }

      const { locations, text } = result.value;

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { locations },
      };
    },
  );

  registerAppTool(
    ctx.server,
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
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      inputSchema: z.object({
        locationId: z.string().length(8, {
          message: "Location ID must be exactly 8 characters long",
        }),
      }),
    },
    async ({ locationId }) => {
      const result = await fromApiResponse(
        locationClient.GET("/v1/locations/{locationId}", {
          params: { path: { locationId } },
        }),
        "get location details",
      ).andThen((data) => {
        const location = data?.data;
        if (!location) {
          return err(notFoundError(`No information found for location ID: ${locationId}`));
        }
        return ok(location);
      });

      if (result.isErr()) {
        return toMcpResponse(result.map(() => ""));
      }

      const location = result.value;

      return {
        content: [
          {
            type: "text" as const,
            text: `Location Details:\n\n${formatLocation(location)}`,
          },
        ],
        structuredContent: { location },
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
        locationId: z.string().length(8, { message: "Location ID must be exactly 8 characters" }),
      }),
    },
    async ({ locationId }) => {
      const result = requireAuth(ctx.getUser).asyncAndThen((props) =>
        fromApiResponse(
          locationClient.GET("/v1/locations/{locationId}", {
            params: { path: { locationId } },
          }),
          "get location details",
        ).andThen((data) => {
          const location = data?.data;
          if (!location) {
            return err(notFoundError(`No information found for location ID: ${locationId}`));
          }

          const preferredLocation: PreferredLocation = {
            locationId: location.locationId || "",
            locationName: location.name || "",
            address:
              `${location.address?.addressLine1 || ""}, ${location.address?.city || ""}, ${location.address?.state || ""} ${location.address?.zipCode || ""}`.trim(),
            chain: location.chain || "",
            setAt: new Date().toISOString(),
          };

          return safeStorage(
            () => ctx.storage.preferredLocation.set(props.id, preferredLocation),
            "save preferred location",
          ).map(
            () =>
              `Preferred location set successfully:\n\n${formatPreferredLocationCompact(preferredLocation)}`,
          );
        }),
      );

      return toMcpResponse(await result);
    },
  );
}
