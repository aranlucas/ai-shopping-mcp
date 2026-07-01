import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";

import { registerResources } from "../../src/tools/resources.js";

type AuthContext = {
  props?: { id: string; accessToken: string; tokenExpiresAt: number };
};

type ResourceHandler = (uri: URL) => Promise<{
  contents: Array<{ type: string; uri: string; mimeType?: string; text: string }>;
}>;

type CompleteFn = (value: string) => Promise<string[]>;

type CapturedResource = {
  name: string;
  uriOrTemplate: unknown;
  handler: ResourceHandler;
};

const testState = vi.hoisted(() => ({
  authContext: undefined as AuthContext | undefined,
  capturedResources: [] as CapturedResource[],
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => testState.authContext,
}));

function authenticate(userId = "user-123") {
  testState.authContext = {
    props: { id: userId, accessToken: "test-token", tokenExpiresAt: Date.now() + 60_000 },
  };
}

function unauthenticate() {
  testState.authContext = undefined;
}

function decodeResource(result: { contents: Array<{ text: string }> }): Record<string, unknown> {
  return decode(result.contents[0]?.text ?? "") as Record<string, unknown>;
}

function makeServer() {
  return {
    registerResource: (
      name: string,
      uriOrTemplate: unknown,
      _config: unknown,
      handler: ResourceHandler,
    ) => {
      testState.capturedResources.push({ name, uriOrTemplate, handler });
    },
  } as unknown as ToolContext["server"];
}

type StorageSeed = {
  pantry?: unknown[];
  pantryThrows?: boolean;
  equipment?: unknown[];
  equipmentThrows?: boolean;
  location?: unknown;
  locationThrows?: boolean;
  orders?: unknown[];
  ordersThrows?: boolean;
};

function makeStorage(seed: StorageSeed = {}): UserStorage {
  const reject = () => Promise.reject(new Error("storage failure"));
  return {
    pantry: {
      getAll: seed.pantryThrows ? reject : async () => seed.pantry ?? [],
    },
    equipment: {
      getAll: seed.equipmentThrows ? reject : async () => seed.equipment ?? [],
    },
    preferredLocation: {
      get: seed.locationThrows ? reject : async () => seed.location ?? null,
    },
    orderHistory: {
      getRecent: seed.ordersThrows ? reject : async () => seed.orders ?? [],
    },
  } as unknown as UserStorage;
}

function makeContext(storage: UserStorage, productClient: unknown = {}): ToolContext {
  return {
    server: makeServer(),
    clients: { productClient } as unknown as ToolContext["clients"],
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}

function getResource(name: string): CapturedResource {
  const resource = testState.capturedResources.find((r) => r.name === name);
  expect(resource).toBeDefined();
  return resource as CapturedResource;
}

async function callResource(name: string, uri = "shopping://x") {
  return await getResource(name).handler(new URL(uri));
}

function getCompleteFn(name: string, field: string): CompleteFn {
  const template = getResource(name).uriOrTemplate as {
    callbacks?: { complete?: Record<string, CompleteFn> };
    _callbacks?: { complete?: Record<string, CompleteFn> };
  };
  const complete = template.callbacks?.complete ?? template._callbacks?.complete;
  const fn = complete?.[field];
  expect(fn).toBeTypeOf("function");
  return fn as CompleteFn;
}

describe("registerResources", () => {
  beforeEach(() => {
    testState.capturedResources.length = 0;
    authenticate();
  });

  afterEach(() => {
    unauthenticate();
  });

  it("returns pantry inventory for an authenticated user", async () => {
    registerResources(
      makeContext(
        makeStorage({
          pantry: [{ productName: "Milk", quantity: 1, addedAt: "2026-06-01T00:00:00.000Z" }],
        }),
      ),
    );

    const decoded = decodeResource(await callResource("Pantry Inventory"));
    expect(decoded.itemCount).toBe(1);
  });

  it("throws when reading pantry outside an authenticated request", async () => {
    unauthenticate();
    registerResources(makeContext(makeStorage()));

    await expect(callResource("Pantry Inventory")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns a fetch error when pantry storage throws", async () => {
    registerResources(makeContext(makeStorage({ pantryThrows: true })));

    const decoded = decodeResource(await callResource("Pantry Inventory"));
    expect(decoded.error).toContain("Failed to fetch pantry data");
  });

  it("returns kitchen equipment and handles storage failures", async () => {
    registerResources(
      makeContext(makeStorage({ equipment: [{ equipmentName: "Oven", addedAt: "x" }] })),
    );
    expect(decodeResource(await callResource("Kitchen Equipment")).itemCount).toBe(1);

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ equipmentThrows: true })));
    expect(decodeResource(await callResource("Kitchen Equipment")).error).toContain(
      "Failed to fetch equipment data",
    );

    testState.capturedResources.length = 0;
    unauthenticate();
    registerResources(makeContext(makeStorage()));
    await expect(callResource("Kitchen Equipment")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns the preferred store, a prompt when unset, and errors", async () => {
    registerResources(
      makeContext(
        makeStorage({
          location: {
            locationId: "12345678",
            locationName: "QFC",
            address: "1 Main",
            chain: "QFC",
            setAt: "x",
          },
        }),
      ),
    );
    expect(decodeResource(await callResource("Preferred Store")).locationName).toBe("QFC");

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ location: null })));
    const unset = decodeResource(await callResource("Preferred Store"));
    expect(unset.message).toContain("No preferred store set");
    expect(unset.instruction).toContain("search_stores");
    expect(unset.instruction).toContain("set_preferred_store");
    expect(unset.instruction).not.toContain("search_locations");
    expect(unset.instruction).not.toContain("set_preferred_location");

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ locationThrows: true })));
    expect(decodeResource(await callResource("Preferred Store")).error).toContain(
      "Failed to fetch preferred store data",
    );

    testState.capturedResources.length = 0;
    unauthenticate();
    registerResources(makeContext(makeStorage()));
    await expect(callResource("Preferred Store")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns order history and handles failures", async () => {
    registerResources(
      makeContext(
        makeStorage({
          orders: [{ orderId: "o1", items: [], totalItems: 0, placedAt: "x" }],
        }),
      ),
    );
    expect(decodeResource(await callResource("Order History")).orderCount).toBe(1);

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ ordersThrows: true })));
    expect(decodeResource(await callResource("Order History")).error).toContain(
      "Failed to fetch order data",
    );

    testState.capturedResources.length = 0;
    unauthenticate();
    registerResources(makeContext(makeStorage()));
    await expect(callResource("Order History")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("does not register a session shopping list resource", () => {
    registerResources(makeContext(makeStorage()));

    expect(testState.capturedResources.map((resource) => resource.name)).toEqual([
      "Pantry Inventory",
      "Kitchen Equipment",
      "Preferred Store",
      "Order History",
      "Product Details",
    ]);
    expect(testState.capturedResources.map((resource) => resource.name)).not.toContain(
      "Shopping List",
    );
  });

  it("registers workflow-first resource URIs", () => {
    registerResources(makeContext(makeStorage()));

    expect(testState.capturedResources.map((resource) => resource.uriOrTemplate)).toEqual(
      expect.arrayContaining([
        "shopping://user/pantry",
        "shopping://user/kitchen-equipment",
        "shopping://user/preferred-store",
        "shopping://user/order-history",
      ]),
    );
    expect(testState.capturedResources.map((resource) => resource.uriOrTemplate)).not.toEqual(
      expect.arrayContaining([
        "shopping://user/equipment",
        "shopping://user/location",
        "shopping://user/orders",
        "shopping://user/shopping-list",
      ]),
    );
  });

  describe("Product Details template", () => {
    function makeProductClient(overrides: { product?: unknown; error?: boolean } = {}) {
      return {
        GET: async () => {
          if (overrides.error) {
            return {
              data: undefined,
              response: new Response(null, { status: 500, statusText: "Server Error" }),
            };
          }
          const product =
            "product" in overrides
              ? overrides.product
              : { upc: "0001112223334", description: "Milk" };
          return {
            data: { data: product },
            response: new Response(null, { status: 200 }),
          };
        },
      };
    }

    it("rejects an invalid product URI", async () => {
      registerResources(makeContext(makeStorage(), makeProductClient()));

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/abc"),
      );
      expect(decoded.error).toContain("Invalid product URI format");
    });

    it("fetches product details using the preferred location filter", async () => {
      registerResources(
        makeContext(
          makeStorage({
            location: {
              locationId: "12345678",
              locationName: "QFC",
              address: "x",
              chain: "QFC",
              setAt: "x",
            },
          }),
          makeProductClient({ product: { upc: "0001112223334", description: "Whole Milk" } }),
        ),
      );

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/0001112223334"),
      );
      expect(decoded.description).toBe("Whole Milk");
    });

    it("returns product data when no preferred location is configured", async () => {
      // When location is null the API call should still succeed without filter.locationId.
      registerResources(
        makeContext(
          makeStorage({ location: null }),
          makeProductClient({ product: { upc: "0001112223334", description: "Organic Milk" } }),
        ),
      );

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/0001112223334"),
      );
      expect(decoded.description).toBe("Organic Milk");
      expect(decoded.error).toBeUndefined();
    });

    it("returns a not-found message when the product is missing", async () => {
      registerResources(makeContext(makeStorage(), makeProductClient({ product: null })));

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/0001112223334"),
      );
      expect(decoded.error).toContain("No product found");
    });

    it("returns an error when the product API fails", async () => {
      registerResources(makeContext(makeStorage(), makeProductClient({ error: true })));

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/0001112223334"),
      );
      expect(decoded.error).toContain("Failed to fetch product");
    });

    it("suggests UPC completions from recent orders", async () => {
      registerResources(
        makeContext(
          makeStorage({
            orders: [
              {
                orderId: "o1",
                items: [
                  { productId: "2222222222222", productName: "Eggs", quantity: 1 },
                  { productId: "short", productName: "Bad", quantity: 1 },
                ],
                totalItems: 2,
                placedAt: "x",
              },
            ],
          }),
        ),
      );

      const complete = getCompleteFn("Product Details", "upc");
      const all = await complete("");
      expect(all).toContain("2222222222222");
      expect(all).not.toContain("short");

      const prefixed = await complete("2222");
      expect(prefixed).toEqual(["2222222222222"]);
    });

    it("deduplicates UPCs that appear more than once in order history", async () => {
      registerResources(
        makeContext(
          makeStorage({
            orders: [
              {
                orderId: "o1",
                items: [{ productId: "3333333333333", productName: "Milk", quantity: 1 }],
                totalItems: 1,
                placedAt: "x",
              },
              {
                orderId: "o2",
                items: [{ productId: "3333333333333", productName: "Milk", quantity: 1 }],
                totalItems: 1,
                placedAt: "x",
              },
            ],
          }),
        ),
      );

      const complete = getCompleteFn("Product Details", "upc");
      const all = await complete("");
      const occurrences = all.filter((upc) => upc === "3333333333333").length;
      expect(occurrences).toBe(1);
    });

    it("returns empty completions when order history storage fails", async () => {
      registerResources(
        makeContext(
          makeStorage({
            ordersThrows: true,
          }),
        ),
      );

      const complete = getCompleteFn("Product Details", "upc");
      const all = await complete("");
      expect(all).toEqual([]);
    });

    it("throws when completing outside an authenticated request", async () => {
      registerResources(makeContext(makeStorage()));
      unauthenticate();

      const complete = getCompleteFn("Product Details", "upc");
      await expect(complete("1")).rejects.toThrow("outside an authenticated MCP request");
    });
  });
});
