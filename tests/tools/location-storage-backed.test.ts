// oxlint-disable perfectionist/sort-imports
// tool-test-harness installs module mocks before the tool module is imported.
import { beforeEach, describe, expect, it } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type { PreferredLocation } from "../../src/utils/user-storage.js";

import {
  getCapturedHandler,
  getCapturedTool,
  isErrorResult,
  makeContext,
  makeStorage,
  resetToolTestHarness,
  textFromResult,
} from "./tool-test-harness.js";
import { registerLocationTools } from "../../src/tools/location.js";

describe("location storage-backed tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("searches stores with query filters and returns structured stores", async () => {
    const getCalls: unknown[] = [];
    const location = {
      locationId: "70500847",
      name: "QFC Broadway",
      chain: "QFC",
      address: {
        addressLine1: "500 Broadway E",
        city: "Seattle",
        state: "WA",
        zipCode: "98102",
      },
      geolocation: { latitude: 47.6, longitude: -122.3 },
      hours: { timezone: "America/Los_Angeles" },
    };
    const context = makeContext();
    context.clients = {
      locationClient: {
        GET: async (_path: string, request: unknown) => {
          getCalls.push(request);
          return {
            data: { data: [location] },
            response: new Response(null, { status: 200 }),
          };
        },
      },
    } as unknown as ToolContext["clients"];
    registerLocationTools(context);

    const result = await getCapturedHandler("search_stores")({
      zipCodeNear: "98122",
      limit: 3,
      chain: "QFC",
    });

    expect(textFromResult(result)).toContain("QFC Broadway");
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "search_stores" },
      structuredContent: {
        stores: [{ locationId: "70500847", name: "QFC Broadway" }],
      },
    });
    const store = (result as { structuredContent: { stores: Array<Record<string, unknown>> } })
      .structuredContent.stores[0];
    expect(store).not.toHaveProperty("geolocation");
    expect(store).not.toHaveProperty("hours");
    expect(getCalls[0]).toMatchObject({
      params: {
        query: {
          "filter.zipCode.near": "98122",
          "filter.limit": 3,
          "filter.chain": "QFC",
        },
      },
    });
  });

  it("requires zipCodeNear on search_stores (no default) and defaults limit to 5", () => {
    const context = makeContext();
    registerLocationTools(context);
    const tool = getCapturedTool("search_stores");
    const config = tool.config as {
      inputSchema: {
        safeParse: (v: unknown) => { success: boolean };
        parse: (v: unknown) => { limit: number };
      };
    };

    expect(config.inputSchema.safeParse({}).success).toBe(false);
    expect(config.inputSchema.safeParse({ zipCodeNear: "98122" }).success).toBe(true);
    expect(config.inputSchema.parse({ zipCodeNear: "98122" }).limit).toBe(5);
  });

  it("returns structured store details for a valid storeId", async () => {
    const location = {
      locationId: "70500847",
      name: "QFC Broadway",
      chain: "QFC",
      phone: "206-555-1234",
      address: {
        addressLine1: "500 Broadway E",
        city: "Seattle",
        state: "WA",
        zipCode: "98102",
      },
      departments: [{ name: "Bakery", phone: "206-555-9999", hours: { open24: false } }],
      geolocation: { latitude: 47.6, longitude: -122.3 },
    };
    const context = makeContext();
    context.clients = {
      locationClient: {
        GET: async () => ({
          data: { data: location },
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    registerLocationTools(context);

    const result = await getCapturedHandler("get_store")({
      storeId: "70500847",
    });

    expect(isErrorResult(result)).toBe(false);
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "get_store" },
      structuredContent: {
        store: {
          locationId: "70500847",
          name: "QFC Broadway",
          chain: "QFC",
          phone: "206-555-1234",
          departments: [{ name: "Bakery" }],
        },
      },
    });
    const store = (result as { structuredContent: { store: Record<string, unknown> } })
      .structuredContent.store;
    expect(store).not.toHaveProperty("geolocation");
  });

  it("returns an error when location details are missing", async () => {
    const context = makeContext();
    context.clients = {
      locationClient: {
        GET: async () => ({
          data: {},
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    registerLocationTools(context);

    const result = await getCapturedHandler("get_store")({
      storeId: "70500847",
    });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No information found for location ID: 70500847");
  });

  it("saves preferred location details for the authenticated user", async () => {
    const savedLocations: PreferredLocation[] = [];
    const context = makeContext(
      makeStorage({
        preferredLocation: {
          set: async (location: PreferredLocation) => {
            savedLocations.push(location);
          },
          get: async () => savedLocations.at(-1) ?? null,
        } as unknown as UserStorage["preferredLocation"],
      }),
    );
    context.clients = {
      locationClient: {
        GET: async () => ({
          data: {
            data: {
              locationId: "70500847",
              name: "QFC Broadway",
              chain: "QFC",
              address: {
                addressLine1: "500 Broadway E",
                city: "Seattle",
                state: "WA",
                zipCode: "98102",
              },
            },
          },
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    registerLocationTools(context);

    const result = await getCapturedHandler("set_preferred_store")({
      storeId: "70500847",
    });

    expect(textFromResult(result)).toContain("Preferred location set successfully");
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "set_preferred_store" },
      structuredContent: {
        store: {
          locationId: "70500847",
          locationName: "QFC Broadway",
        },
      },
    });
    expect(savedLocations).toMatchObject([
      {
        locationId: "70500847",
        locationName: "QFC Broadway",
        address: "500 Broadway E, Seattle, WA 98102",
        chain: "QFC",
      },
    ]);
  });

  it("returns an error when the API returns no data for the given storeId", async () => {
    const context = makeContext();
    context.clients = {
      locationClient: {
        GET: async () => ({
          data: {},
          response: new Response(null, { status: 200 }),
        }),
      },
    } as unknown as ToolContext["clients"];
    registerLocationTools(context);

    const result = await getCapturedHandler("set_preferred_store")({
      storeId: "70500847",
    });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No information found for location ID: 70500847");
  });
});
