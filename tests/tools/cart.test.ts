import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type { PreferredLocation } from "../../src/utils/user-storage.js";

import { addToCartInputSchema, registerCartTools } from "../../src/tools/cart.js";

// --- Shared test state (hoisted so vi.mock closures can reference it) ---

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

function textFromResult(result: unknown): string {
  const response = result as { content?: Array<{ type: string; text: string }> };
  return response.content?.[0]?.text ?? "";
}

function isErrorResult(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

type PutOptions = {
  body: unknown;
  headers: Record<string, string>;
};

type PutCall = {
  path: string;
  options: PutOptions;
};

function makeStorage(
  storedLocation: PreferredLocation | null = null,
  throwOnGet = false,
): UserStorage {
  return {
    pantry: {} as UserStorage["pantry"],
    equipment: {} as UserStorage["equipment"],
    orderHistory: {} as UserStorage["orderHistory"],
    shoppingList: {} as UserStorage["shoppingList"],
    preferredLocation: {
      get: async (_userId: string) => {
        if (throwOnGet) throw new Error("KV read failure");
        return storedLocation;
      },
      set: async () => {},
    } as unknown as UserStorage["preferredLocation"],
  } as unknown as UserStorage;
}

function makeContext(
  storage?: UserStorage,
  putConfig: { status: number; throws?: boolean } = { status: 204 },
): { context: ToolContext; putCalls: PutCall[] } {
  const actualStorage = storage ?? makeStorage();
  const putCalls: PutCall[] = [];

  const context: ToolContext = {
    server: {} as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async (path: string, options: PutOptions) => {
          putCalls.push({ path, options });
          if (putConfig.throws === true) {
            throw new Error("Network failure");
          }
          return {
            data: undefined,
            response: new Response(null, { status: putConfig.status }),
          };
        },
      },
    } as unknown as ToolContext["clients"],
    storage: actualStorage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };

  return { context, putCalls };
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

// ============================================================
// Tests
// ============================================================

describe("add_to_cart tool", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  describe("happy path", () => {
    it("adds items with explicit locationId and shows location ID in parentheses when no location name is available", async () => {
      const { context, putCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_to_cart");

      const result = await handler({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "70500847",
      });

      expect(isErrorResult(result)).toBe(false);
      expect(textFromResult(result)).toContain("(Location: 70500847)");
      expect(textFromResult(result)).toContain("1 item(s)");
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.path).toBe("/v1/cart/add");
    });

    it("adds items using preferred location from storage and shows location name", async () => {
      const storage = makeStorage({
        locationId: "70500847",
        locationName: "QFC Broadway",
        address: "500 Broadway E",
        chain: "QFC",
        setAt: new Date().toISOString(),
      });
      const { context, putCalls } = makeContext(storage);
      registerCartTools(context);
      const handler = getCapturedHandler("add_to_cart");

      const result = await handler({
        items: [{ upc: "0001234567890", quantity: 2 }],
      });

      expect(isErrorResult(result)).toBe(false);
      expect(textFromResult(result)).toContain("at QFC Broadway");
      expect(putCalls).toHaveLength(1);
    });

    it("reports the correct count when multiple items are added at once", async () => {
      const { context } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_to_cart");

      const result = await handler({
        items: [
          { upc: "0001234567890", quantity: 1 },
          { upc: "0009876543210", quantity: 2 },
          { upc: "0001111111110", quantity: 3 },
        ],
        locationId: "70500847",
      });

      expect(isErrorResult(result)).toBe(false);
      expect(textFromResult(result)).toContain("3 item(s)");
    });

    it("forwards DELIVERY modality to the cart API body correctly", async () => {
      const { context, putCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_to_cart");

      await handler({
        items: [{ upc: "0001234567890", quantity: 1, modality: "DELIVERY" }],
        locationId: "70500847",
      });

      expect(putCalls[0]).toMatchObject({
        options: {
          body: {
            items: [{ upc: "0001234567890", quantity: 1, modality: "DELIVERY" }],
          },
        },
      });
    });

    it("defaults to PICKUP modality when modality is not specified in the input", async () => {
      const { context, putCalls } = makeContext();
      registerCartTools(context);
      const handler = getCapturedHandler("add_to_cart");

      // Parse through the schema so Zod applies the default — mirrors what
      // the real MCP framework does before invoking the handler.
      const parsed = addToCartInputSchema.parse({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "70500847",
      });
      await handler(parsed as unknown as Record<string, unknown>);

      expect(putCalls[0]).toMatchObject({
        options: {
          body: {
            items: [{ upc: "0001234567890", quantity: 1, modality: "PICKUP" }],
          },
        },
      });
    });
  });

  describe("location resolution errors", () => {
    it("returns a not-found error when no locationId is provided and no preferred location is set", async () => {
      const storage = makeStorage(null);
      const { context } = makeContext(storage);
      registerCartTools(context);

      const result = await getCapturedHandler("add_to_cart")({
        items: [{ upc: "0001234567890", quantity: 1 }],
      });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("No location specified");
    });

    it("returns a storage error when storage throws while fetching the preferred location", async () => {
      const storage = makeStorage(null, true);
      const { context } = makeContext(storage);
      registerCartTools(context);

      const result = await getCapturedHandler("add_to_cart")({
        items: [{ upc: "0001234567890", quantity: 1 }],
      });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("Failed to fetch preferred location");
    });
  });

  describe("API errors", () => {
    it("returns an API error when cartClient.PUT returns a 400 response", async () => {
      const { context } = makeContext(undefined, { status: 400 });
      registerCartTools(context);

      const result = await getCapturedHandler("add_to_cart")({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "70500847",
      });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("Failed to add items to cart");
    });

    it("returns an API error when cartClient.PUT returns a 500 response", async () => {
      const { context } = makeContext(undefined, { status: 500 });
      registerCartTools(context);

      const result = await getCapturedHandler("add_to_cart")({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "70500847",
      });

      expect(isErrorResult(result)).toBe(true);
      expect(textFromResult(result)).toContain("Failed to add items to cart");
    });

    it("returns a network error when cartClient.PUT throws a network-level exception", async () => {
      const { context } = makeContext(undefined, { status: 204, throws: true });
      registerCartTools(context);

      const result = await getCapturedHandler("add_to_cart")({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "70500847",
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
        getCapturedHandler("add_to_cart")({
          items: [{ upc: "0001234567890", quantity: 1 }],
          locationId: "70500847",
        }),
      ).rejects.toThrow("outside an authenticated MCP request");
    });
  });
});

describe("addToCartInputSchema", () => {
  describe("UPC validation", () => {
    it("rejects UPCs shorter than 13 characters", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "123456789012", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects UPCs longer than 13 characters", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "12345678901234", quantity: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts UPCs that are exactly 13 characters", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 1 }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("quantity validation", () => {
    it("rejects quantity below 1", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 0 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects quantity above 99", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts the minimum valid quantity of 1", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 1 }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts the maximum valid quantity of 99", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 99 }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("locationId validation", () => {
    it("rejects a locationId shorter than 8 characters", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "7050084",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a locationId longer than 8 characters", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "705008470",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a locationId that is exactly 8 characters", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 1 }],
        locationId: "70500847",
      });
      expect(result.success).toBe(true);
    });

    it("accepts input when locationId is omitted", () => {
      const result = addToCartInputSchema.safeParse({
        items: [{ upc: "0001234567890", quantity: 1 }],
      });
      expect(result.success).toBe(true);
    });
  });
});
