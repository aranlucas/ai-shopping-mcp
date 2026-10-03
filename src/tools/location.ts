import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { PreferredLocation } from "../domain/shopping.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type {
  components as LocationComponents,
  operations,
} from "../services/kroger/location.js";
import type { LocationData } from "../app-results.js";
import type { PreferredLocationStore } from "../utils/shopping-store.js";

import { appResult } from "../app-results.js";
import { notFoundError, validationError } from "../errors.js";
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
function compactLocation(location: Location): LocationData {
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
    departments: location.departments?.map((department) => ({
      name: department.name,
    })),
  };
}

/** zipCode, or the value of any zip-like key a model misspelled it as. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The deliberately loose MCP input accepts misspelled zip keys; each candidate is parsed before use.
function zipCodeFrom(input: Record<string, unknown>): string | undefined {
  const direct = z.string().safeParse(input.zipCode);

  if (direct.success) return direct.data.trim();

  for (const [key, value] of Object.entries(input)) {
    if (!/^(zip|postal)/i.test(key)) continue;
    const parsed = z.string().safeParse(value);

    if (parsed.success) return parsed.data.trim();
  }

  return undefined;
}

export type LocationToolDependencies = {
  locationClient: KrogerClients["locationClient"];
  preferredLocation: PreferredLocationStore;
};

export function registerLocationTools(
  server: McpServer,
  {
    locationClient,
    preferredLocation: preferredLocationStore,
  }: LocationToolDependencies,
): void {
  registerAppTool(
    server,
    "search_stores",
    {
      title: "Search Stores",
      description:
        "Finds Kroger-family stores (Kroger, QFC, Fred Meyer, Ralphs, …) near a zip code, returning each store's storeId, address, and phone. Pass storeId instead to get one store's hours and departments.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      // Loose so a misspelled zip key (zip, zipCodeNear, postalCode, …) is
      // still read as zipCode instead of rejected; see zipCodeFrom.
      inputSchema: z
        .looseObject({
          zipCode: z
            .string()
            .trim()
            .length(5, { message: "Zip code must be exactly 5 digits" })
            .optional()
            .describe(
              "5-digit zip code to search near. Ask the user if you don't know it.",
            ),
          storeId: storeIdSchema
            .optional()
            .describe(
              "8-character storeId to look up one store's hours and departments",
            ),
          limit: z.coerce.number().int().min(1).max(20).optional().default(5),
          chain: z
            .string()
            .optional()
            .describe(
              "Only return one banner, e.g. 'QFC' or 'KROGER'. Omit to search every banner.",
            ),
        })
        .refine((input) => Boolean(zipCodeFrom(input) ?? input.storeId), {
          message:
            'Pass zipCode (5 digits) to search, or storeId for one store. Example: {"zipCode":"98105"}',
        }),
    },
    async (input) => {
      const { storeId, limit, chain } = input;

      if (storeId) return getStoreDetails(storeId);
      const zipCodeNear = zipCodeFrom(input);

      if (!zipCodeNear || !/^\d{5}$/.test(zipCodeNear)) {
        return toMcpError(
          validationError(
            'zipCode must be 5 digits. Example: {"zipCode":"98105"}',
          ),
        );
      }

      const queryParams: operations["SearchLocations"]["parameters"]["query"] =
        {
          "filter.limit": limit,
          "filter.zipCode.near": zipCodeNear,
        };

      if (chain) queryParams["filter.chain"] = chain;

      const result = await fromApiResponse(
        () =>
          locationClient.GET("/v1/locations", {
            params: { query: queryParams },
          }),
        "search locations",
      ).map((data) => data?.data || []);

      if (result.isErr()) return toMcpError(result.error);
      const stores = result.value;

      return {
        content: [
          { type: "text" as const, text: formatStoreListMarkdown(stores) },
        ],
        ...appResult("search_stores", {
          stores: stores.map(compactLocation),
        }),
      };
    },
  );

  async function getStoreDetails(storeId: string) {
    const result = await fromApiResponse(
      () =>
        locationClient.GET("/v1/locations/{locationId}", {
          params: { path: { locationId: storeId } },
        }),
      "get location details",
    ).andThen((data) => {
      const location = data?.data;

      if (!location) {
        return err(
          notFoundError(`No information found for location ID: ${storeId}`),
        );
      }

      return ok(location);
    });

    if (result.isErr()) return toMcpError(result.error);
    const location = result.value;

    return {
      content: [
        {
          type: "text" as const,
          text: formatStoreDetailMarkdown(location),
        },
      ],
      ...appResult("get_store", { store: compactLocation(location) }),
    };
  }

  registerAppTool(
    server,
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
        storeId: storeIdSchema.describe(
          "8-character storeId from search_stores",
        ),
      }),
    },
    async ({ storeId }) => {
      const result = await fromApiResponse(
        () =>
          locationClient.GET("/v1/locations/{locationId}", {
            params: { path: { locationId: storeId } },
          }),
        "get location details",
      ).andThen((data) => {
        const location = data?.data;

        if (!location) {
          return err(
            notFoundError(`No information found for location ID: ${storeId}`),
          );
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
          () => preferredLocationStore.set(preferredLocation),
          "save preferred location",
        ).map(() =>
          Object.assign(
            {
              content: [
                {
                  type: "text" as const,
                  text: `Preferred location set successfully:\n\n${formatPreferredLocationCompact(preferredLocation)}`,
                },
              ],
            },
            appResult("set_preferred_store", {
              store: preferredLocation,
              actionDetail: `Preferred store set to ${preferredLocation.locationName}`,
            }),
          ),
        );
      });

      return result.isOk() ? result.value : toMcpError(result.error);
    },
  );
}
