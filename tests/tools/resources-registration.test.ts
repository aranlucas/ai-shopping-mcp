import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";

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
  shoppingList?: unknown[];
  shoppingListThrows?: boolean;
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
    shoppingList: {
      getAll: seed.shoppingListThrows ? reject : async () => seed.shoppingList ?? [],
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
    const { registerResources } = await import("../../src/tools/resources.js");
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
    const { registerResources } = await import("../../src/tools/resources.js");
    registerResources(makeContext(makeStorage()));

    await expect(callResource("Pantry Inventory")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns a fetch error when pantry storage throws", async () => {
    const { registerResources } = await import("../../src/tools/resources.js");
    registerResources(makeContext(makeStorage({ pantryThrows: true })));

    const decoded = decodeResource(await callResource("Pantry Inventory"));
    expect(decoded.error).toContain("Failed to fetch pantry data");
  });

  it("returns equipment inventory and handles storage failures", async () => {
    const { registerResources } = await import("../../src/tools/resources.js");

    registerResources(
      makeContext(makeStorage({ equipment: [{ equipmentName: "Oven", addedAt: "x" }] })),
    );
    expect(decodeResource(await callResource("Equipment Inventory")).itemCount).toBe(1);

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ equipmentThrows: true })));
    expect(decodeResource(await callResource("Equipment Inventory")).error).toContain(
      "Failed to fetch equipment data",
    );

    testState.capturedResources.length = 0;
    unauthenticate();
    registerResources(makeContext(makeStorage()));
    await expect(callResource("Equipment Inventory")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns the preferred location, a prompt when unset, and errors", async () => {
    const { registerResources } = await import("../../src/tools/resources.js");

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
    expect(decodeResource(await callResource("Preferred Store Location")).locationName).toBe("QFC");

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ location: null })));
    expect(decodeResource(await callResource("Preferred Store Location")).message).toContain(
      "No preferred location set",
    );

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ locationThrows: true })));
    expect(decodeResource(await callResource("Preferred Store Location")).error).toContain(
      "Failed to fetch location data",
    );

    testState.capturedResources.length = 0;
    unauthenticate();
    registerResources(makeContext(makeStorage()));
    await expect(callResource("Preferred Store Location")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns order history and handles failures", async () => {
    const { registerResources } = await import("../../src/tools/resources.js");

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

  it("summarizes the shopping list and handles failures", async () => {
    const { registerResources } = await import("../../src/tools/resources.js");

    registerResources(
      makeContext(
        makeStorage({
          shoppingList: [
            {
              productName: "Milk",
              upc: "0001112223334",
              quantity: 1,
              addedAt: "x",
              checked: false,
            },
            { productName: "Bread", quantity: 1, addedAt: "x", checked: false },
            { productName: "Eggs", quantity: 1, addedAt: "x", checked: true },
          ],
        }),
      ),
    );
    const decoded = decodeResource(await callResource("Shopping List"));
    expect(decoded.totalItems).toBe(3);
    expect(decoded.uncheckedCount).toBe(2);
    expect(decoded.readyForCheckout).toBe(1);
    expect(decoded.needsUpc).toBe(1);

    testState.capturedResources.length = 0;
    registerResources(makeContext(makeStorage({ shoppingListThrows: true })));
    expect(decodeResource(await callResource("Shopping List")).error).toContain(
      "Failed to fetch shopping list data",
    );

    testState.capturedResources.length = 0;
    unauthenticate();
    registerResources(makeContext(makeStorage()));
    await expect(callResource("Shopping List")).rejects.toThrow(
      "outside an authenticated MCP request",
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
      const { registerResources } = await import("../../src/tools/resources.js");
      registerResources(makeContext(makeStorage(), makeProductClient()));

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/abc"),
      );
      expect(decoded.error).toContain("Invalid product URI format");
    });

    it("fetches product details using the preferred location filter", async () => {
      const { registerResources } = await import("../../src/tools/resources.js");
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

    it("returns a not-found message when the product is missing", async () => {
      const { registerResources } = await import("../../src/tools/resources.js");
      registerResources(makeContext(makeStorage(), makeProductClient({ product: null })));

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/0001112223334"),
      );
      expect(decoded.error).toContain("No product found");
    });

    it("returns an error when the product API fails", async () => {
      const { registerResources } = await import("../../src/tools/resources.js");
      registerResources(makeContext(makeStorage(), makeProductClient({ error: true })));

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/0001112223334"),
      );
      expect(decoded.error).toContain("Failed to fetch product");
    });

    it("suggests UPC completions from shopping list and orders", async () => {
      const { registerResources } = await import("../../src/tools/resources.js");
      registerResources(
        makeContext(
          makeStorage({
            shoppingList: [
              {
                productName: "Milk",
                upc: "1111111111111",
                quantity: 1,
                addedAt: "x",
                checked: false,
              },
              { productName: "NoUpc", quantity: 1, addedAt: "x", checked: false },
            ],
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

      const complete = getCompleteFn("Product Details", "productId");
      const all = await complete("");
      expect(all).toContain("1111111111111");
      expect(all).toContain("2222222222222");
      expect(all).not.toContain("short");

      const prefixed = await complete("1111");
      expect(prefixed).toEqual(["1111111111111"]);
    });

    it("throws when completing outside an authenticated request", async () => {
      const { registerResources } = await import("../../src/tools/resources.js");
      registerResources(makeContext(makeStorage()));
      unauthenticate();

      const complete = getCompleteFn("Product Details", "productId");
      await expect(complete("1")).rejects.toThrow("outside an authenticated MCP request");
    });
  });
});
