import { productClient as createProductClient } from "../kroger-clients.js";
import type {
  PantryItem,
  EquipmentItem,
  PreferredLocation,
  OrderRecord,
} from "../../src/domain/shopping.js";
import { strictFake } from "../strict-fake.js";
import { decode } from "@toon-format/toon";
import {
  McpServer,
  ResourceTemplate,
  type ResourceMetadata,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
} from "@modelcontextprotocol/server";
import { authenticatedRequest } from "../authenticated-request.js";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EquipmentStore,
  OrderHistoryStore,
  PantryStore,
  PreferredLocationStore,
} from "../../src/utils/shopping-store.js";

import { ProductService } from "../../src/services/kroger/product-service.js";
import { registerResources } from "../../src/tools/resources.js";

type AuthContext = {
  props: { id: string; accessToken: string; tokenExpiresAt: number };
};

type ResourceHandler = (uri: URL) => Promise<{
  contents: Array<{
    type: string;
    uri: string;
    mimeType?: string;
    text: string;
  }>;
}>;

type CompleteFn = (value: string) => Promise<string[]>;

type CapturedResource = {
  name: string;
  uriOrTemplate: string | ResourceTemplate;
  handler: ResourceHandler;
};

type TestState = {
  authContext: AuthContext | undefined;
  capturedResources: CapturedResource[];
};

const testState: TestState = { authContext: undefined, capturedResources: [] };

function authenticate(userId = "user-123") {
  testState.authContext = {
    props: {
      id: userId,
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 60_000,
    },
  };
}

function unauthenticate() {
  testState.authContext = undefined;
}

function decodeResource(result: { contents: Array<{ text: string }> }) {
  return z
    .record(z.string(), z.json())
    .parse(decode(result.contents[0]?.text ?? ""));
}

type StaticRegistration = [
  name: string,
  uri: string,
  config: ResourceMetadata,
  read: ReadResourceCallback,
];

type TemplateRegistration = [
  name: string,
  uri: ResourceTemplate,
  config: ResourceMetadata,
  read: ReadResourceTemplateCallback,
];

type ResourceRegistration = StaticRegistration | TemplateRegistration;

function isStaticRegistration(
  registration: ResourceRegistration,
): registration is StaticRegistration {
  return !(registration[1] instanceof ResourceTemplate);
}

const resourceResultSchema = z.object({
  contents: z.array(
    z.object({
      type: z.string(),
      uri: z.string(),
      mimeType: z.string().optional(),
      text: z.string(),
    }),
  ),
});

function makeServer() {
  const server = new McpServer({ name: "resource-test", version: "1.0.0" });
  const register = server.registerResource.bind(server);
  vi.spyOn(server, "registerResource").mockImplementation((...args) => {
    const registered = register(...args);
    // SAFETY: Vitest retains only the SDK's last overload in its spy type. The actual
    // registration arguments are one of the SDK's two overloads, discriminated by URI kind.
    const registration = args as ResourceRegistration;
    const [name, uriOrTemplate] = registration;

    const handler: ResourceHandler = async (uri) => {
      const result = await authenticatedRequest((context) => {
        if (isStaticRegistration(registration))
          return Promise.resolve(registration[3](uri, context));

        return Promise.resolve(registration[3](uri, {}, context));
      }, testState.authContext);

      return resourceResultSchema.parse(result);
    };

    testState.capturedResources.push({ name, uriOrTemplate, handler });

    return registered;
  });

  return server;
}

type StorageSeed = {
  pantry?: PantryItem[];
  pantryThrows?: boolean;
  equipment?: EquipmentItem[];
  equipmentThrows?: boolean;
  location?: PreferredLocation | null;
  locationThrows?: boolean;
  orders?: OrderRecord[];
  ordersThrows?: boolean;
};

function storageFailure(): Promise<never> {
  return Promise.reject(new Error("storage failure"));
}

type ResourceRepositories = {
  equipment: EquipmentStore;
  orderHistory: OrderHistoryStore;
  pantry: PantryStore;
  preferredLocation: PreferredLocationStore;
};

function makeStorage(seed: StorageSeed = {}): ResourceRepositories {
  return strictFake<ResourceRepositories>({
    pantry: strictFake<PantryStore>({
      getAll: seed.pantryThrows
        ? storageFailure
        : async () => seed.pantry ?? [],
    }),
    equipment: strictFake<EquipmentStore>({
      getAll: seed.equipmentThrows
        ? storageFailure
        : async () => seed.equipment ?? [],
    }),
    preferredLocation: strictFake<PreferredLocationStore>({
      get: seed.locationThrows
        ? storageFailure
        : async () => seed.location ?? null,
    }),
    orderHistory: strictFake<OrderHistoryStore>({
      getRecent: seed.ordersThrows
        ? storageFailure
        : async () => seed.orders ?? [],
    }),
  });
}

function makeContext(
  repositories: ResourceRepositories,
  productClient = createProductClient(async () => {
    throw new Error("Unexpected product request");
  }),
) {
  return {
    server: makeServer(),
    productService: new ProductService(productClient),
    ...repositories,
  };
}

function registerTestResources(fixture: ReturnType<typeof makeContext>) {
  registerResources(fixture.server, {
    equipment: fixture.equipment,
    orderHistory: fixture.orderHistory,
    pantry: fixture.pantry,
    preferredLocation: fixture.preferredLocation,
    productService: fixture.productService,
  });
}

function getResource(name: string): CapturedResource {
  const resource = testState.capturedResources.find((r) => r.name === name);

  if (!resource) throw new Error(`Missing resource ${name}`);

  return resource;
}

async function callResource(name: string, uri = "shopping://x") {
  return await getResource(name).handler(new URL(uri));
}

function getCompleteFn(name: string, field: string): CompleteFn {
  const template = getResource(name).uriOrTemplate;

  if (!(template instanceof ResourceTemplate))
    throw new Error("Resource has no template");
  const complete = template.completeCallback(field);

  if (!complete) throw new Error(`No completion for ${field}`);

  return (value) =>
    authenticatedRequest(
      () => Promise.resolve(complete(value)),
      testState.authContext,
    );
}

function makeProductClient(
  overrides: { product?: unknown; error?: boolean } = {},
) {
  return createProductClient(async () => {
    if (overrides.error)
      return new Response(null, { status: 500, statusText: "Server Error" });

    const product =
      "product" in overrides
        ? overrides.product
        : { upc: "0001112223334", description: "Milk" };

    return Response.json({ data: product });
  });
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
    registerTestResources(
      makeContext(
        makeStorage({
          pantry: [
            {
              productName: "Milk",
              quantity: 1,
              addedAt: "2026-06-01T00:00:00.000Z",
            },
          ],
        }),
      ),
    );

    const decoded = decodeResource(await callResource("Pantry Inventory"));
    expect(decoded.itemCount).toBe(1);
  });

  it("throws when reading pantry outside an authenticated request", async () => {
    unauthenticate();
    registerTestResources(makeContext(makeStorage()));

    await expect(callResource("Pantry Inventory")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns a fetch error when pantry storage throws", async () => {
    registerTestResources(makeContext(makeStorage({ pantryThrows: true })));

    const decoded = decodeResource(await callResource("Pantry Inventory"));
    expect(decoded.error).toContain("Failed to fetch pantry data");
  });

  it("returns kitchen equipment and handles storage failures", async () => {
    registerTestResources(
      makeContext(
        makeStorage({ equipment: [{ equipmentName: "Oven", addedAt: "x" }] }),
      ),
    );
    expect(
      decodeResource(await callResource("Kitchen Equipment")).itemCount,
    ).toBe(1);

    testState.capturedResources.length = 0;
    registerTestResources(makeContext(makeStorage({ equipmentThrows: true })));
    expect(
      decodeResource(await callResource("Kitchen Equipment")).error,
    ).toContain("Failed to fetch equipment data");

    testState.capturedResources.length = 0;
    unauthenticate();
    registerTestResources(makeContext(makeStorage()));
    await expect(callResource("Kitchen Equipment")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns the preferred store, a prompt when unset, and errors", async () => {
    registerTestResources(
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
    expect(
      decodeResource(await callResource("Preferred Store")).locationName,
    ).toBe("QFC");

    testState.capturedResources.length = 0;
    registerTestResources(makeContext(makeStorage({ location: null })));
    const unset = decodeResource(await callResource("Preferred Store"));
    expect(unset.message).toContain("No preferred store set");
    expect(unset.instruction).toContain("search_stores");
    expect(unset.instruction).toContain("set_preferred_store");
    expect(unset.instruction).not.toContain("search_locations");
    expect(unset.instruction).not.toContain("set_preferred_location");

    testState.capturedResources.length = 0;
    registerTestResources(makeContext(makeStorage({ locationThrows: true })));
    expect(
      decodeResource(await callResource("Preferred Store")).error,
    ).toContain("Failed to fetch preferred store data");

    testState.capturedResources.length = 0;
    unauthenticate();
    registerTestResources(makeContext(makeStorage()));
    await expect(callResource("Preferred Store")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("returns order history and handles failures", async () => {
    registerTestResources(
      makeContext(
        makeStorage({
          orders: [{ orderId: "o1", items: [], totalItems: 0, placedAt: "x" }],
        }),
      ),
    );
    expect(decodeResource(await callResource("Order History")).orderCount).toBe(
      1,
    );

    testState.capturedResources.length = 0;
    registerTestResources(makeContext(makeStorage({ ordersThrows: true })));
    expect(decodeResource(await callResource("Order History")).error).toContain(
      "Failed to fetch order data",
    );

    testState.capturedResources.length = 0;
    unauthenticate();
    registerTestResources(makeContext(makeStorage()));
    await expect(callResource("Order History")).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("does not register a session shopping list resource", () => {
    registerTestResources(makeContext(makeStorage()));

    expect(
      testState.capturedResources.map((resource) => resource.name),
    ).toEqual([
      "Pantry Inventory",
      "Kitchen Equipment",
      "Preferred Store",
      "Order History",
      "Product Details",
    ]);
    expect(
      testState.capturedResources.map((resource) => resource.name),
    ).not.toContain("Shopping List");
  });

  it("registers workflow-first resource URIs", () => {
    registerTestResources(makeContext(makeStorage()));

    expect(
      testState.capturedResources.map((resource) => resource.uriOrTemplate),
    ).toEqual(
      expect.arrayContaining([
        "shopping://user/pantry",
        "shopping://user/kitchen-equipment",
        "shopping://user/preferred-store",
        "shopping://user/order-history",
      ]),
    );
    expect(
      testState.capturedResources.map((resource) => resource.uriOrTemplate),
    ).not.toEqual(
      expect.arrayContaining([
        "shopping://user/equipment",
        "shopping://user/location",
        "shopping://user/orders",
        "shopping://user/shopping-list",
      ]),
    );
  });

  describe("Product Details template", () => {
    it("rejects an invalid product URI", async () => {
      registerTestResources(makeContext(makeStorage(), makeProductClient()));

      const decoded = decodeResource(
        await callResource("Product Details", "shopping://product/abc"),
      );

      expect(decoded.error).toContain("Invalid product URI format");
    });

    it("fetches product details using the preferred location filter", async () => {
      registerTestResources(
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
          makeProductClient({
            product: { upc: "0001112223334", description: "Whole Milk" },
          }),
        ),
      );

      const decoded = decodeResource(
        await callResource(
          "Product Details",
          "shopping://product/0001112223334",
        ),
      );

      expect(decoded.description).toBe("Whole Milk");
    });

    it("returns product data when no preferred location is configured", async () => {
      // When location is null the API call should still succeed without filter.locationId.
      registerTestResources(
        makeContext(
          makeStorage({ location: null }),
          makeProductClient({
            product: { upc: "0001112223334", description: "Organic Milk" },
          }),
        ),
      );

      const decoded = decodeResource(
        await callResource(
          "Product Details",
          "shopping://product/0001112223334",
        ),
      );

      expect(decoded.description).toBe("Organic Milk");
      expect(decoded.error).toBeUndefined();
    });

    it("returns a not-found message when the product is missing", async () => {
      registerTestResources(
        makeContext(makeStorage(), makeProductClient({ product: null })),
      );

      const decoded = decodeResource(
        await callResource(
          "Product Details",
          "shopping://product/0001112223334",
        ),
      );

      expect(decoded.error).toContain("No product found");
    });

    it("returns an error when the product API fails", async () => {
      registerTestResources(
        makeContext(makeStorage(), makeProductClient({ error: true })),
      );

      const decoded = decodeResource(
        await callResource(
          "Product Details",
          "shopping://product/0001112223334",
        ),
      );

      expect(decoded.error).toContain("Failed to fetch product");
    });

    it("suggests UPC completions from recent orders", async () => {
      registerTestResources(
        makeContext(
          makeStorage({
            orders: [
              {
                orderId: "o1",
                items: [
                  {
                    upc: "2222222222222",
                    productName: "Eggs",
                    quantity: 1,
                  },
                  {
                    upc: "short",
                    productName: "Bad",
                    quantity: 1,
                  },
                  {
                    productName: "Other store",
                    quantity: 1,
                  },
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
      expect(all).not.toContain("1111111111111");

      const prefixed = await complete("2222");
      expect(prefixed).toEqual(["2222222222222"]);
    });

    it("deduplicates UPCs that appear more than once in order history", async () => {
      registerTestResources(
        makeContext(
          makeStorage({
            orders: [
              {
                orderId: "o1",
                items: [
                  {
                    upc: "3333333333333",
                    productName: "Milk",
                    quantity: 1,
                  },
                ],
                totalItems: 1,
                placedAt: "x",
              },
              {
                orderId: "o2",
                items: [
                  {
                    upc: "3333333333333",
                    productName: "Milk",
                    quantity: 1,
                  },
                ],
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
      registerTestResources(
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
      registerTestResources(makeContext(makeStorage()));
      unauthenticate();

      const complete = getCompleteFn("Product Details", "upc");
      await expect(complete("1")).rejects.toThrow(
        "outside an authenticated MCP request",
      );
    });
  });
});
