import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { components as LocationComponents } from "../services/kroger/location.js";
import type { PreferredLocation } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";

type Location = LocationComponents["schemas"]["locations.location"];

function compactLocationForContent(location: Location) {
  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ] as const;
  return {
    locationId: location.locationId,
    name: location.name,
    chain: location.chain,
    address: location.address
      ? {
          addressLine1: location.address.addressLine1,
          city: location.address.city,
          state: location.address.state,
          zipCode: location.address.zipCode,
        }
      : undefined,
    phone: location.phone,
    hours: location.hours
      ? {
          timezone: location.hours.timezone,
          ...Object.fromEntries(
            days
              .map((day) => {
                const h = location.hours?.[day];
                return h ? [day, { open: h.open, close: h.close }] : null;
              })
              .filter((e) => e !== null),
          ),
        }
      : undefined,
    departments: location.departments?.map((d) => d.name).filter((n): n is string => n != null),
  };
}

import { notFoundError } from "../errors.js";
import { formatPreferredLocationCompact } from "../utils/format-response.js";
import {
  fromApiResponse,
  getProps,
  safeStorage,
  toMcpError,
  toMcpResponse,
} from "../utils/result.js";
import { toonResult } from "../utils/toon.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";

export function registerLocationTools(ctx: ToolContext) {
  const { locationClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "search_locations",
    {
      title: "Search Store Locations",
      description:
        "Finds Kroger or QFC store locations near a zip code. Returns store names, addresses, and location IDs. Use this to help the user set their preferred store or find a store to pick up an order.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
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

      const result = await fromApiResponse(
        locationClient.GET("/v1/locations", {
          params: { query: queryParams },
        }),
        "search locations",
      ).map((data) => data?.data || []);

      return result.match(
        (locations) => ({
          ...toonResult({
            count: locations.length,
            locations: locations.map(compactLocationForContent),
          }),
          structuredContent: { _view: "search_locations", locations },
        }),
        toMcpError,
      );
    },
  );

  registerAppTool(
    ctx.server,
    "get_location_details",
    {
      title: "Get Store Details",
      description:
        "Retrieves detailed information about a specific Kroger store by its location ID, including address, hours, and departments.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
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

      return result.match(
        (location) => ({
          ...toonResult(compactLocationForContent(location)),
          structuredContent: { _view: "get_location_details", location },
        }),
        toMcpError,
      );
    },
  );

  registerAppTool(
    ctx.server,
    "set_preferred_location",
    {
      title: "Set Preferred Store",
      description:
        "Saves a store as your preferred location for future product searches and cart operations.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
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
      const props = getProps();
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
      });

      return toMcpResponse(result);
    },
  );
}
