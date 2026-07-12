import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { PreferredLocation } from "../utils/user-storage.js";
import type { ToolContext } from "./types.js";
import type { components as LocationComponents } from "../services/kroger/location.js";
import type { LocationData } from "../app-results.js";

import { appResult } from "../app-results.js";
import { notFoundError } from "../errors.js";
import {
  formatPreferredLocationCompact,
  formatStoreDetailMarkdown,
  formatStoreListMarkdown,
} from "../utils/format-response.js";
import { fromApiResponse, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema } from "./schemas.js";

type Location = LocationComponents["schemas"]["locations.location"];

/** Location fields rendered by the store list and detail views. */
export function compactLocation(location: Location): LocationData {
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
    departments: location.departments?.map((department) => ({ name: department.name })),
  };
}

export function registerLocationTools(ctx: ToolContext) {
  const { locationClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "search_stores",
    {
      title: "Search Store Locations",
      description:
        "Finds Kroger or QFC stores near a 5-digit zip code. Returns store names, addresses, and 8-character location IDs for preferred-store setup, product availability, and pickup or delivery planning.",
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
          .describe("5-digit zip code. Ask the user for their zip code if you don't know it."),
        limit: z.coerce.number().min(1).max(200).optional().default(5),
        chain: z
          .string()
          .optional()
          .default("QFC")
          .describe(
            "Kroger family chain to search. Defaults to QFC — pass e.g. 'KROGER' to widen results to other banners.",
          ),
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

      if (result.isErr()) return toMcpError(result.error);
      const stores = result.value;
      return {
        content: [{ type: "text" as const, text: formatStoreListMarkdown(stores) }],
        ...appResult("search_stores", { stores: stores.map(compactLocation) }),
      };
    },
  );

  registerAppTool(
    ctx.server,
    "get_store",
    {
      title: "Get Store Details",
      description:
        "Retrieves detailed information for one Kroger/QFC store by its storeId, including address, phone, hours, and departments. Use the 8-character storeId from search_stores output.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        storeId: storeIdSchema.describe("8-character storeId from search_stores"),
      }),
    },
    async ({ storeId }) => {
      const result = await fromApiResponse(
        locationClient.GET("/v1/locations/{locationId}", {
          params: { path: { locationId: storeId } },
        }),
        "get location details",
      ).andThen((data) => {
        const location = data?.data;
        if (!location) {
          return err(notFoundError(`No information found for location ID: ${storeId}`));
        }
        return ok(location);
      });

      if (result.isErr()) return toMcpError(result.error);
      const location = result.value;
      return {
        content: [{ type: "text" as const, text: formatStoreDetailMarkdown(location) }],
        ...appResult("get_store", { store: compactLocation(location) }),
      };
    },
  );

  registerAppTool(
    ctx.server,
    "set_preferred_store",
    {
      title: "Set Preferred Store",
      description:
        "Validates a Kroger/QFC store by its storeId and saves it as the user's preferred store for future product searches, weekly deals, and cart operations. Use the 8-character storeId from search_stores output.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        storeId: storeIdSchema.describe("8-character storeId from search_stores"),
      }),
    },
    async ({ storeId }) => {
      const result = await fromApiResponse(
        locationClient.GET("/v1/locations/{locationId}", {
          params: { path: { locationId: storeId } },
        }),
        "get location details",
      ).andThen((data) => {
        const location = data?.data;
        if (!location) {
          return err(notFoundError(`No information found for location ID: ${storeId}`));
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
          () => ctx.storage.preferredLocation.set(preferredLocation),
          "save preferred location",
        ).map(() => ({
          content: [
            {
              type: "text" as const,
              text: `Preferred location set successfully:\n\n${formatPreferredLocationCompact(preferredLocation)}`,
            },
          ],
          ...appResult("set_preferred_store", {
            store: preferredLocation,
            actionDetail: `Preferred store set to ${preferredLocation.locationName}`,
          }),
        }));
      });

      return result.isOk() ? result.value : toMcpError(result.error);
    },
  );
}
