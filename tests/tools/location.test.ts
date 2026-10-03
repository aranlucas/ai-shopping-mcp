import { locationClient } from "../kroger-clients.js";
import { strictFake } from "../strict-fake.js";
import { appPayloadSchemas } from "../../src/app-results.js";
import { parseToolPayload } from "../app-payload.js";
// oxlint-disable perfectionist/sort-imports
// oxlint-disable perfectionist/sort-imports
import { beforeEach, describe, expect, it } from "vitest";

import type { PreferredLocation } from "../../src/domain/shopping.js";
import type { PreferredLocationStore } from "../../src/utils/shopping-store.js";

import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  makeStorage,
  resetToolTestHarness,
} from "./tool-test-harness.js";
import { registerLocationTools } from "../../src/tools/location.js";

function registerLocation(context: ReturnType<typeof makeContext>) {
  registerLocationTools(context.server, {
    locationClient: context.locationClient,
    preferredLocation: context.preferredLocation,
  });
}

describe("location storage-backed tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("searches stores with query filters and returns structured stores", async () => {
    const getCalls: Request[] = [];

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
    context.locationClient = locationClient(async (request) => {
      getCalls.push(request);

      return Response.json({ data: [location] });
    });
    registerLocation(context);

    const result = await getCapturedHandler("search_stores")({
      zipCode: "98122",
      limit: 3,
      chain: "QFC",
    });

    expect(result.text).toContain("QFC Broadway");
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "search_stores" },
      structuredContent: {
        stores: [{ locationId: "70500847", name: "QFC Broadway" }],
      },
    });

    const store = parseToolPayload(appPayloadSchemas.search_stores, result)
      .stores[0];

    expect(store).not.toHaveProperty("geolocation");
    expect(store).not.toHaveProperty("hours");
    expect(
      Object.fromEntries(new URL(getCalls[0].url).searchParams),
    ).toMatchObject({
      "filter.zipCode.near": "98122",
      "filter.limit": "3",
      "filter.chain": "QFC",
    });
  });

  it("requires a zip code or storeId on search_stores and defaults limit to 5", () => {
    const context = makeContext();
    registerLocation(context);
    const tool = getCapturedTool("search_stores");

    const config = tool.config;

    expect(config.inputSchema.safeParse({}).success).toBe(false);
    expect(config.inputSchema.safeParse({ zipCode: "98122" }).success).toBe(
      true,
    );
    expect(config.inputSchema.parse({ zipCode: "98122" }).limit).toBe(5);

    // Misspelled zip keys are read as zipCode rather than rejected.
    for (const key of ["zip", "zipCodeNear", "zipCodeNearv", "postalCode"]) {
      expect
        .soft(config.inputSchema.safeParse({ [key]: "98122" }).success)
        .toBe(true);
    }
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
      departments: [
        { name: "Bakery", phone: "206-555-9999", hours: { open24: false } },
      ],
      geolocation: { latitude: 47.6, longitude: -122.3 },
    };

    const context = makeContext();
    context.locationClient = locationClient(async () =>
      Response.json({ data: location }),
    );
    registerLocation(context);

    const result = await getCapturedHandler("search_stores")({
      storeId: "70500847",
    });

    expect(result.isError).toBe(false);
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

    const store = parseToolPayload(appPayloadSchemas.get_store, result).store;

    expect(store).not.toHaveProperty("geolocation");
  });

  it("returns an error when location details are missing", async () => {
    const context = makeContext();
    context.locationClient = locationClient(async () => Response.json({}));
    registerLocation(context);

    const result = await getCapturedHandler("search_stores")({
      storeId: "70500847",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      "No information found for location ID: 70500847",
    );
  });

  it("saves preferred location details for the authenticated user", async () => {
    const savedLocations: PreferredLocation[] = [];

    const context = makeContext(
      makeStorage({
        preferredLocation: strictFake<PreferredLocationStore>({
          set: async (location: PreferredLocation) => {
            savedLocations.push(location);
          },
          get: async () => savedLocations.at(-1) ?? null,
        }),
      }),
    );

    context.locationClient = locationClient(async () =>
      Response.json({
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
      }),
    );
    registerLocation(context);

    const result = await getCapturedHandler("set_preferred_store")({
      storeId: "70500847",
    });

    expect(result.text).toContain("Preferred location set successfully");
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
    context.locationClient = locationClient(async () => Response.json({}));
    registerLocation(context);

    const result = await getCapturedHandler("set_preferred_store")({
      storeId: "70500847",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      "No information found for location ID: 70500847",
    );
  });
});
