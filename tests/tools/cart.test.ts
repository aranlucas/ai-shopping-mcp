import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type {
  CartSnapshotItem,
  PreferredLocation,
  ShoppingList,
} from "../../src/utils/user-storage.js";

import { addShoppingListToCartInputSchema, registerCartTools } from "../../src/tools/cart.js";
import { getSessionScopedUserId } from "../../src/tools/types.js";

function stubProductService(): ToolContext["productService"] {
  return {
    getProduct: () => {
      throw new Error("productService not used in this test");
    },
    enrichProductName: async () => null,
  } as unknown as ToolContext["productService"];
}

type AuthContext = {
  props?: {
    id: string;
    accessToken: string;
    tokenExpiresAt: number;
  };
};

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

type CapturedTool = {
  name: string;
  config: unknown;
  handler: ToolHandler;
};

const testState = vi.hoisted(() => ({
  authContext: undefined as AuthContext | undefined,
  capturedTools: [] as CapturedTool[],
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => testState.authContext,
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: (_server: unknown, name: string, config: unknown, handler: ToolHandler) => {
    testState.capturedTools.push({ name, config, handler });
  },
}));

// --- Helpers ---

const USER_ID = "user-123";
const SESSION_ID = "session-1";
const SCOPED_ID = getSessionScopedUserId(USER_ID, SESSION_ID);
const SHORT_LIST_ID = "list_abc12345";
const SHOPPING_LIST_STORAGE_KEY = `${SCOPED_ID}:list:${SHORT_LIST_ID}`;
const LOCATION_ID = "70500847";

function authenticate(userId = USER_ID) {
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

function textFromResult(result: unknown): string {
  const response = result as { content?: Array<{ type: string; text: string }> };
  return response.content?.[0]?.text ?? "";
}

function isErrorResult(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

function structuredContent(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
}

function listFixture(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: SHOPPING_LIST_STORAGE_KEY,
    name: "Tuesday Dinner",
    createdAt: new Date().toISOString(),
    items: [
      {
        productName: "Organic Whole Milk",
        upc: "0001111042578",
        quantity: 2,
      },
      {
        productName: "Sourdough Bread",
        quantity: 1,
      },
    ],
    ...overrides,
  };
}

type PutOptions = { body: unknown; headers: Record<string, string> };
type PutCall = { path: string; options: PutOptions };

function makeStorage(
  storedList: ShoppingList | null = null,
  storedLocation: PreferredLocation | null = null,
  snapshotSetCalls: unknown[][] = [],
  existingSnapshot: CartSnapshotItem[] | null = null,
  mirrorAppendCalls: unknown[][] = [],
  mirrorItems: Array<CartSnapshotItem & { addedAt: string }> = [],
  storedCartId: string | null = null,
  cartIdSetCalls: string[][] = [],
): UserStorage {
  return {
    pantry: {} as UserStorage["pantry"],
    equipment: {} as UserStorage["equipment"],
    orderHistory: {} as UserStorage["orderHistory"],
    preferredLocation: {
      get: async () => storedLocation,
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"],
    shoppingList: {
      get: async (id: string) => (id === storedList?.id ? storedList : null),
      create: async () => storedList ?? listFixture(),
      clear: async () => {},
    } as unknown as UserStorage["shoppingList"],
    cartSnapshot: {
      get: async () => existingSnapshot,
      set: async (_id: string, items: unknown[]) => {
        snapshotSetCalls.push([_id, items]);
      },
      clear: async () => {},
    } as unknown as UserStorage["cartSnapshot"],
    cartMirror: {
      getAll: async () => mirrorItems,
      append: async (userId: string, items: CartSnapshotItem[], addedAt: string) => {
        mirrorAppendCalls.push([userId, items, addedAt]);
        return [...mirrorItems, ...items.map((item) => ({ ...item, addedAt }))];
      },
      clear: async () => {},
    } as unknown as UserStorage["cartMirror"],
    cartId: {
      get: async () => storedCartId,
      set: async (userId: string, cartId: string) => {
        cartIdSetCalls.push([userId, cartId]);
      },
    } as unknown as UserStorage["cartId"],
  } as unknown as UserStorage;
}

type GetCall = { path: string; options: unknown };

const LIVE_CART = {
  id: "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4",
  items: [
    {
      upc: "0001111040110",
      description: "QFC Vitamin D Whole Milk Gallon",
      quantity: 1,
      modality: "PICKUP" as const,
    },
  ],
};

function makeContext(
  storage?: UserStorage,
  putConfig: { status: number; throws?: boolean } = { status: 204 },
  getConfig: { status: number; cart?: typeof LIVE_CART } = { status: 200, cart: LIVE_CART },
): {
  context: ToolContext;
  putCalls: PutCall[];
  snapshotSetCalls: unknown[][];
  getCalls: GetCall[];
} {
  const putCalls: PutCall[] = [];
  const snapshotSetCalls: unknown[][] = [];
  const getCalls: GetCall[] = [];
  const actualStorage = storage ?? makeStorage(listFixture(), null, snapshotSetCalls);

  const context: ToolContext = {
    server: {
      registerTool: (name: string, config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
      server: {
        elicitInput: async () => ({ action: "accept", content: { confirm: true } }),
      },
    } as unknown as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async (path: string, options: PutOptions) => {
          putCalls.push({ path, options });
          if (putConfig.throws === true) throw new Error("Network failure");
          return {
            data: undefined,
            response: new Response(null, { status: putConfig.status }),
          };
        },
        GET: async (path: string, options: unknown) => {
          getCalls.push({ path, options });
          if (getConfig.status !== 200) {
            return {
              data: undefined,
              error: { reason: "cart not found" },
              response: new Response("{}", { status: getConfig.status }),
            };
          }
          return {
            data: { data: getConfig.cart },
            response: new Response(null, { status: 200 }),
          };
        },
      },
    } as unknown as ToolContext["clients"],
    productService: stubProductService(),
    storage: actualStorage,
    getEnv: () => ({}) as Env,
    getSessionId: () => SESSION_ID,
  };

  return { context, putCalls, snapshotSetCalls, getCalls };
}

function getCapturedHandler(name: string): ToolHandler {
  const tool = testState.capturedTools.find((captured) => captured.name === name);
  expect(tool).toBeDefined();
  return (
    tool?.handler ??
    (async () => {
      throw new Error(`Tool ${name} was not captured`);
    })
  );
}

describe("add_shopping_list_to_cart tool", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  describe("listId happy path", () => {
    it("adds items with a UPC from the shopping list and reports the list name", async () => {
      const { context, putCalls, snapshotSetCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
      });

      expect(isErrorResult(result)).toBe(false);
      expect(textFromResult(result)).toContain("1 item(s)");
      expect(textFromResult(result)).toContain("Tuesday Dinner");
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.path).toBe("/v1/cart/add");

      const sc = structuredContent(result);
      expect(sc["_view"]).toBe("add_shopping_list_to_cart");
      expect(sc["listId"]).toBe(SHORT_LIST_ID);
      expect(sc["name"]).toBe("Tuesday Dinner");
      expect(sc["actionDetail"]).toContain("Tuesday Dinner");
      expect(snapshotSetCalls).toHaveLength(1);
      expect(snapshotSetCalls[0]?.[0]).toBe(SHOPPING_LIST_STORAGE_KEY);
    });

    it("uses preferred location from storage when storeId is omitted", async () => {
      const storage = makeStorage(
        listFixture(),
        {
          locationId: LOCATION_ID,
          locationName: "QFC Broadway",
          address: "500 Broadway E",
          chain: "QFC",
          setAt: new Date().toISOString(),
        },
        [],
      );
      const { context } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({ listId: SHORT_LIST_ID });

      expect(isErrorResult(result)).toBe(false);
      expect(textFromResult(result)).toContain("at QFC Broadway");
    });

    it("forwards DELIVERY modality to the cart API body", async () => {
      const { context, putCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      await handler({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
        modality: "DELIVERY",
      });

      expect(putCalls[0]).toMatchObject({
        options: {
          body: {
            items: [{ upc: "0001111042578", quantity: 2, modality: "DELIVERY" }],
          },
        },
      });
    });

    it("accepts lowercase modality via the case-insensitive schema", async () => {
      const { context, putCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const parsed = addShoppingListToCartInputSchema.parse({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
        modality: "delivery",
      });
      await handler(parsed as unknown as Record<string, unknown>);

      expect(putCalls[0]).toMatchObject({
        options: {
          body: {
            items: [{ upc: "0001111042578", quantity: 2, modality: "DELIVERY" }],
          },
        },
      });
    });

    it("defaults to PICKUP modality when modality is omitted", async () => {
      const { context, putCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const parsed = addShoppingListToCartInputSchema.parse({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
      });
      await handler(parsed as unknown as Record<string, unknown>);

      expect(putCalls[0]).toMatchObject({
        options: {
          body: {
            items: [{ upc: "0001111042578", quantity: 2, modality: "PICKUP" }],
          },
        },
      });
    });

    it("lists items without a UPC in needsUpc rather than adding them", async () => {
      const { context, putCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
      });

      const sc = structuredContent(result);
      expect((sc["items"] as Array<{ upc: string }>).length).toBe(1);
      expect((sc["needsUpc"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
        "Sourdough Bread",
      ]);
      expect(putCalls).toHaveLength(1);
    });
  });

  describe("retry short-circuit", () => {
    it("returns a success-style message and skips the PUT when a snapshot already exists for this listId", async () => {
      const existingSnapshot: CartSnapshotItem[] = [
        {
          upc: "0001111042578",
          quantity: 2,
          modality: "PICKUP",
          productName: "Organic Whole Milk",
        },
      ];
      const storage = makeStorage(listFixture(), null, [], existingSnapshot);
      const { context, putCalls } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({ listId: SHORT_LIST_ID, storeId: LOCATION_ID });

      expect(isErrorResult(result)).toBe(false);
      expect(putCalls).toHaveLength(0);
      expect(textFromResult(result)).toContain("already added to your cart from this list");
      expect(structuredContent(result)["items"]).toEqual(existingSnapshot);
    });
  });

  describe("inline items path", () => {
    it("adds inline upc/quantity items directly without a listId", async () => {
      const storage = makeStorage(null, {
        locationId: LOCATION_ID,
        locationName: "QFC Broadway",
        address: "500 Broadway E",
        chain: "QFC",
        setAt: new Date().toISOString(),
      });
      const { context, putCalls } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const parsed = addShoppingListToCartInputSchema.parse({
        items: [{ upc: "0001111042578", quantity: 3 }],
      });
      const result = await handler(parsed as unknown as Record<string, unknown>);

      expect(isErrorResult(result)).toBe(false);
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]).toMatchObject({
        options: {
          body: { items: [{ upc: "0001111042578", quantity: 3, modality: "PICKUP" }] },
        },
      });
      const sc = structuredContent(result);
      expect(sc["_view"]).toBe("add_shopping_list_to_cart");
      expect(sc["listId"]).toBeUndefined();
      expect(textFromResult(result)).toContain("at QFC Broadway");
    });

    it("pads a short UPC to 13 digits via the shared upc schema", () => {
      const parsed = addShoppingListToCartInputSchema.parse({
        items: [{ upc: "1111042578" }],
      });
      expect(parsed.items?.[0]?.upc).toBe("0001111042578");
    });
  });

  describe("cart mirror", () => {
    it("appends the added items to the cart mirror on a successful listId add", async () => {
      const mirrorAppendCalls: unknown[][] = [];
      const storage = makeStorage(listFixture(), null, [], null, mirrorAppendCalls);
      const { context } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      await handler({ listId: SHORT_LIST_ID, storeId: LOCATION_ID, modality: "PICKUP" });

      expect(mirrorAppendCalls).toHaveLength(1);
      expect(mirrorAppendCalls[0]?.[0]).toBe(USER_ID);
      expect(mirrorAppendCalls[0]?.[1]).toEqual([
        {
          upc: "0001111042578",
          quantity: 2,
          modality: "PICKUP",
          productName: "Organic Whole Milk",
        },
      ]);
    });

    it("appends inline items to the cart mirror on a successful inline add", async () => {
      const mirrorAppendCalls: unknown[][] = [];
      const storage = makeStorage(
        null,
        {
          locationId: LOCATION_ID,
          locationName: "QFC Broadway",
          address: "500 Broadway E",
          chain: "QFC",
          setAt: new Date().toISOString(),
        },
        [],
        null,
        mirrorAppendCalls,
      );
      const { context } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const parsed = addShoppingListToCartInputSchema.parse({
        items: [{ upc: "0001111042578", quantity: 3 }],
      });
      await handler(parsed as unknown as Record<string, unknown>);

      expect(mirrorAppendCalls).toHaveLength(1);
      expect(mirrorAppendCalls[0]?.[1]).toEqual([
        { upc: "0001111042578", quantity: 3, modality: "PICKUP", productName: undefined },
      ]);
    });

    it("does not append to the mirror when the retry short-circuit skips the PUT", async () => {
      const mirrorAppendCalls: unknown[][] = [];
      const existingSnapshot: CartSnapshotItem[] = [
        {
          upc: "0001111042578",
          quantity: 2,
          modality: "PICKUP",
          productName: "Organic Whole Milk",
        },
      ];
      const storage = makeStorage(listFixture(), null, [], existingSnapshot, mirrorAppendCalls);
      const { context } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      await handler({ listId: SHORT_LIST_ID, storeId: LOCATION_ID });

      expect(mirrorAppendCalls).toHaveLength(0);
    });
  });

  describe("shopping list resolution errors", () => {
    it("returns an error when the shopping list is not found for the listId", async () => {
      const storage = makeStorage(null);
      const { context } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({ listId: SHORT_LIST_ID });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("No shopping list found");
    });
  });

  describe("location resolution errors", () => {
    it("returns a not-found error when no storeId is provided and no preferred location is set", async () => {
      const storage = makeStorage(listFixture(), null);
      const { context } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({ listId: SHORT_LIST_ID });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("No location specified");
    });
  });

  describe("API errors", () => {
    it("returns an API error when cartClient.PUT returns a 400 response", async () => {
      const { context } = makeContext(undefined, { status: 400 });
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
      });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("Failed to add");
    });

    it("returns a network error when cartClient.PUT throws", async () => {
      const { context } = makeContext(undefined, { status: 204, throws: true });
      registerCartTools(context);
      const handler = getCapturedHandler("add_shopping_list_to_cart");

      const result = await handler({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
      });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("Network failure");
    });
  });

  describe("authentication", () => {
    it("throws when the tool handler is called outside an authenticated MCP request", async () => {
      unauthenticate();
      const { context } = makeContext();
      registerCartTools(context);

      await expect(
        getCapturedHandler("add_shopping_list_to_cart")({
          listId: SHORT_LIST_ID,
          storeId: LOCATION_ID,
        }),
      ).rejects.toThrow("outside an authenticated MCP request");
    });
  });
});

describe("view_cart tool", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  it("lists mirrored items with productName, quantity, upc, and modality", async () => {
    const storage = makeStorage(
      listFixture(),
      null,
      [],
      null,
      [],
      [
        {
          upc: "0001111042578",
          quantity: 2,
          modality: "PICKUP",
          productName: "Organic Whole Milk",
          addedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    );
    const { context } = makeContext(storage);
    registerCartTools(context);
    const handler = getCapturedHandler("view_cart");

    const result = await handler({});

    expect(isErrorResult(result)).toBe(false);
    const text = textFromResult(result);
    expect(text).toContain("Organic Whole Milk x2");
    expect(text).toContain("upc=0001111042578");
    expect(text).toContain("PICKUP");
    expect(text).toContain("in-store/app changes are not shown");
  });

  it("falls back to the upc when productName is missing", async () => {
    const storage = makeStorage(
      listFixture(),
      null,
      [],
      null,
      [],
      [
        {
          upc: "0001111042578",
          quantity: 1,
          modality: "DELIVERY",
          addedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    );
    const { context } = makeContext(storage);
    registerCartTools(context);
    const handler = getCapturedHandler("view_cart");

    const result = await handler({});

    expect(textFromResult(result)).toContain("0001111042578 x1");
  });

  it("names shop_for_items as the next step when the mirror is empty", async () => {
    const { context } = makeContext(makeStorage());
    registerCartTools(context);
    const handler = getCapturedHandler("view_cart");

    const result = await handler({});

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("shop_for_items");
  });

  it("throws when called outside an authenticated MCP request", async () => {
    unauthenticate();
    const { context } = makeContext();
    registerCartTools(context);

    await expect(getCapturedHandler("view_cart")({})).rejects.toThrow(
      "outside an authenticated MCP request",
    );
  });

  it("reads the live cart when an explicit cartId is passed and prints cartId= and upc=", async () => {
    const cartIdSetCalls: string[][] = [];
    const storage = makeStorage(null, null, [], null, [], [], null, cartIdSetCalls);
    const { context, getCalls } = makeContext(storage);
    registerCartTools(context);

    const result = await getCapturedHandler("view_cart")({
      cartId: "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4",
    });

    expect(isErrorResult(result)).toBe(false);
    const text = textFromResult(result);
    expect(text).toContain("cartId=2b9b3963-5cac-42f8-9d28-7bebdec0b9e4");
    expect(text).toContain("QFC Vitamin D Whole Milk Gallon x1");
    expect(text).toContain("upc=0001111040110");
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].path).toBe("/v1/carts/{id}");
  });

  it("persists the cartId after a successful live read", async () => {
    const cartIdSetCalls: string[][] = [];
    const storage = makeStorage(null, null, [], null, [], [], null, cartIdSetCalls);
    const { context } = makeContext(storage);
    registerCartTools(context);

    await getCapturedHandler("view_cart")({ cartId: "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4" });

    expect(cartIdSetCalls).toEqual([[USER_ID, "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4"]]);
  });

  it("uses the stored cartId for a live read when no cartId is passed", async () => {
    const storage = makeStorage(null, null, [], null, [], [], "stored-cart-id");
    const { context, getCalls } = makeContext(storage);
    registerCartTools(context);

    const result = await getCapturedHandler("view_cart")({});

    expect(textFromResult(result)).toContain("cartId=stored-cart-id");
    expect(getCalls).toHaveLength(1);
  });

  it("falls back to the mirror with a cartId hint when no id is known", async () => {
    const storage = makeStorage(
      null,
      null,
      [],
      null,
      [],
      [
        {
          upc: "0001111042578",
          quantity: 2,
          modality: "PICKUP",
          productName: "Organic Whole Milk",
          addedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    );
    const { context, getCalls } = makeContext(storage);
    registerCartTools(context);

    const result = await getCapturedHandler("view_cart")({});

    const text = textFromResult(result);
    expect(getCalls).toHaveLength(0);
    expect(text).toContain("in-store/app changes are not shown");
    expect(text).toContain("cartId");
  });

  it("falls back to the mirror and names the failed cartId when the live read errors", async () => {
    const storage = makeStorage(
      null,
      null,
      [],
      null,
      [],
      [
        {
          upc: "0001111042578",
          quantity: 2,
          modality: "PICKUP",
          productName: "Organic Whole Milk",
          addedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
    );
    const { context } = makeContext(storage, { status: 204 }, { status: 404 });
    registerCartTools(context);

    const result = await getCapturedHandler("view_cart")({ cartId: "stale-cart-id" });

    expect(isErrorResult(result)).toBe(false);
    const text = textFromResult(result);
    expect(text).toContain("cartId=stale-cart-id");
    expect(text).toContain("in-store/app changes are not shown");
    expect(text).toContain("Organic Whole Milk x2");
  });

  it("falls back to the mirror and names the failed cartId when the stored cartId's live read errors", async () => {
    const storage = makeStorage(
      null,
      null,
      [],
      null,
      [],
      [
        {
          upc: "0001111042578",
          quantity: 2,
          modality: "PICKUP",
          productName: "Organic Whole Milk",
          addedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      "stored-cart-id",
    );
    const { context } = makeContext(storage, { status: 204 }, { status: 404 });
    registerCartTools(context);

    const result = await getCapturedHandler("view_cart")({});

    expect(isErrorResult(result)).toBe(false);
    const text = textFromResult(result);
    expect(text).not.toContain("cartId=stored-cart-id");
    expect(text).toContain("Live cart read failed");
    expect(text).toContain("in-store/app changes are not shown");
    expect(text).toContain("Organic Whole Milk x2");
  });

  it("declares openWorldHint true now that it can call the Kroger API", () => {
    const { context } = makeContext(makeStorage());
    registerCartTools(context);
    const tool = testState.capturedTools.find((t) => t.name === "view_cart");
    const config = tool?.config as { annotations?: { openWorldHint?: boolean } };
    expect(config.annotations?.openWorldHint).toBe(true);
  });
});

describe("addShoppingListToCartInputSchema", () => {
  describe("listId / items mutual exclusivity", () => {
    it("rejects when neither listId nor items is provided", () => {
      const result = addShoppingListToCartInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects when both listId and items are provided", () => {
      const result = addShoppingListToCartInputSchema.safeParse({
        listId: SHORT_LIST_ID,
        items: [{ upc: "0001111042578" }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts listId alone", () => {
      const result = addShoppingListToCartInputSchema.safeParse({ listId: SHORT_LIST_ID });
      expect(result.success).toBe(true);
    });

    it("accepts items alone", () => {
      const result = addShoppingListToCartInputSchema.safeParse({
        items: [{ upc: "0001111042578", quantity: 2 }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("storeId validation", () => {
    it("rejects a storeId shorter than 8 characters", () => {
      const result = addShoppingListToCartInputSchema.safeParse({
        listId: SHORT_LIST_ID,
        storeId: "7050084",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a storeId longer than 8 characters", () => {
      const result = addShoppingListToCartInputSchema.safeParse({
        listId: SHORT_LIST_ID,
        storeId: "705008470",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a storeId that is exactly 8 characters", () => {
      const result = addShoppingListToCartInputSchema.safeParse({
        listId: SHORT_LIST_ID,
        storeId: LOCATION_ID,
      });
      expect(result.success).toBe(true);
    });

    it("trims whitespace from storeId", () => {
      const result = addShoppingListToCartInputSchema.parse({
        listId: SHORT_LIST_ID,
        storeId: `  ${LOCATION_ID}  `,
      });
      expect(result.storeId).toBe(LOCATION_ID);
    });

    it("accepts input when storeId is omitted", () => {
      const result = addShoppingListToCartInputSchema.safeParse({
        listId: SHORT_LIST_ID,
      });
      expect(result.success).toBe(true);
    });
  });
});
