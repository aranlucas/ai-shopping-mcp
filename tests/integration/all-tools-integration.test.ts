import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => ({
    props: {
      id: "test-user-123",
      accessToken: "test-access-token",
      tokenExpiresAt: Date.now() + 3600000,
    },
  }),
}));

import { createKrogerClients } from "../../src/services/kroger/client.js";
import { registerCartTools } from "../../src/tools/cart.js";
import { registerEquipmentTools } from "../../src/tools/equipment.js";
import { registerLocationTools } from "../../src/tools/location.js";
import { registerOrderTools } from "../../src/tools/orders.js";
import {
  getProductDetailsOutputSchema,
  getLocationDetailsOutputSchema,
  getWeeklyDealsOutputSchema,
  managePantryOutputSchema,
  manageShoppingListOutputSchema,
  searchLocationsOutputSchema,
  searchProductsOutputSchema,
  searchRecipesOutputSchema,
} from "../../src/tools/output-schemas.js";
import { registerPantryTools } from "../../src/tools/pantry.js";
import { registerProductTools } from "../../src/tools/product.js";
import { registerRecipeTools } from "../../src/tools/recipes.js";
import { registerShoppingListTools } from "../../src/tools/shopping-list.js";
import { registerWeeklyDealsTools } from "../../src/tools/weekly-deals.js";
import { createUserStorage } from "../../src/utils/user-storage.js";
import { APP_VIEW_URI, registerViewResource } from "../../src/utils/view-resource.js";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [...store.keys()].map((name) => ({ name })) })),
  };
}

const mockEnv = {
  USER_DATA_KV: null as any,
  ASSETS: {
    fetch: vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("<html>test</html>"),
    }),
  },
  KROGER_CLIENT_ID: "test-client-id",
  KROGER_CLIENT_SECRET: "test-client-secret",
  COOKIE_ENCRYPTION_KEY: "test-key",
};

const mockProps = {
  id: "test-user-123",
  accessToken: "test-access-token",
  tokenExpiresAt: Date.now() + 3600000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createToolContext(server: McpServer, kv: ReturnType<typeof createMockKV>) {
  const clients = createKrogerClients(() => mockProps);
  const storage = createUserStorage(kv as any);
  return {
    server,
    clients,
    storage,
    getUser: () => mockProps,
    getEnv: () => ({ ...mockEnv, USER_DATA_KV: kv }),
    getSessionId: () => "test-session",
  };
}

function registerAllTools(server: McpServer, kv: ReturnType<typeof createMockKV>) {
  const ctx = createToolContext(server, kv);
  registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");
  registerCartTools(ctx);
  registerLocationTools(ctx);
  registerProductTools(ctx);
  registerPantryTools(ctx);
  registerEquipmentTools(ctx);
  registerOrderTools(ctx);
  registerRecipeTools(ctx);
  registerShoppingListTools(ctx);
  registerWeeklyDealsTools(ctx);
  return ctx;
}

function mockKrogerResponse(data: unknown, status = 200) {
  const body = JSON.stringify(data);
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function callTool(server: McpServer, name: string, args: unknown, extra?: unknown) {
  const tool = server._registeredTools[name] as { handler: Function } | undefined;
  if (!tool?.handler) throw new Error(`Tool "${name}" not found or has no handler`);
  return tool.handler(args, extra ?? { _meta: {} });
}

function expectValidOutputSchema(schema: any, data: unknown) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((i: any) => `  [${i.path.join(".")}] ${i.message} (code: ${i.code})`)
      .join("\n");
    expect.fail(
      `Output schema validation failed:\n${details}\n\nReceived: ${JSON.stringify(data, null, 2)}`,
    );
  }
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// add_to_cart
// ===========================================================================

describe("add_to_cart", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    const kv = createMockKV();
    const ctx = createToolContext(server, kv);
    registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");
    registerCartTools(ctx);
  });

  it("returns success text when cart API responds ok", async () => {
    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ data: {} }));
    const result = await callTool(server, "add_to_cart", {
      items: [{ upc: "0000000000001", quantity: 2, modality: "PICKUP" }],
      locationId: "70500847",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Successfully added");
  });

  it("returns error when cart API fails", async () => {
    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ error: "Bad request" }, 400));
    const result = await callTool(server, "add_to_cart", {
      items: [{ upc: "0000000000001", quantity: 1 }],
      locationId: "70500847",
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// search_locations
// ===========================================================================

describe("search_locations", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("returns structuredContent matching outputSchema", async () => {
    mockFetch.mockResolvedValueOnce(
      mockKrogerResponse({
        data: [
          {
            locationId: "70500847",
            name: "QFC Seattle",
            chain: "QFC",
            address: {
              addressLine1: "123 Main St",
              city: "Seattle",
              state: "WA",
              zipCode: "98101",
            },
            phone: "206-555-0100",
            departments: [{ name: "Bakery", phone: "206-555-0101" }],
          },
        ],
      }),
    );
    const result = await callTool(server, "search_locations", {
      zipCodeNear: "98122",
      limit: 1,
      chain: "QFC",
    });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(searchLocationsOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("search_locations");
    expect(result.structuredContent.locations).toHaveLength(1);
  });

  it("handles empty results", async () => {
    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ data: [] }));
    const result = await callTool(server, "search_locations", { zipCodeNear: "00000" });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(searchLocationsOutputSchema, result.structuredContent);
    expect(result.structuredContent.locations).toHaveLength(0);
  });

  it("handles API errors", async () => {
    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ error: "Server error" }, 500));
    const result = await callTool(server, "search_locations", { zipCodeNear: "98122" });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// get_location_details
// ===========================================================================

describe("get_location_details", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("returns structuredContent matching outputSchema", async () => {
    mockFetch.mockResolvedValueOnce(
      mockKrogerResponse({
        data: {
          locationId: "70500847",
          name: "QFC Capitol Hill",
          chain: "QFC",
          address: {
            addressLine1: "1701 Broadway",
            city: "Seattle",
            state: "WA",
            zipCode: "98122",
          },
          phone: "206-555-0200",
          departments: [{ name: "Deli", phone: "206-555-0201" }],
        },
      }),
    );
    const result = await callTool(server, "get_location_details", { locationId: "70500847" });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(getLocationDetailsOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("get_location_details");
    expect(result.structuredContent.location.locationId).toBe("70500847");
  });

  it("handles not-found gracefully", async () => {
    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ data: null }, 404));
    const result = await callTool(server, "get_location_details", { locationId: "00000000" });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// set_preferred_location
// ===========================================================================

describe("set_preferred_location", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("persists location and returns confirmation text", async () => {
    mockFetch.mockResolvedValueOnce(
      mockKrogerResponse({
        data: {
          locationId: "70500847",
          name: "QFC Seattle",
          chain: "QFC",
          address: { addressLine1: "123 Main St", city: "Seattle", state: "WA", zipCode: "98101" },
        },
      }),
    );
    const result = await callTool(server, "set_preferred_location", { locationId: "70500847" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Preferred location set");
    expect(result.content[0].text).toContain("QFC Seattle");
  });

  it("returns error when location not found", async () => {
    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ data: null }, 404));
    const result = await callTool(server, "set_preferred_location", { locationId: "00000000" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to get location details");
  });
});

// ===========================================================================
// search_products
// ===========================================================================

describe("search_products", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("returns structuredContent matching outputSchema", async () => {
    mockFetch.mockResolvedValue(
      mockKrogerResponse({
        data: [
          {
            upc: "0000000000001",
            description: "Whole Milk",
            brand: "Kroger",
            categories: ["Dairy"],
            aisleLocations: [{ description: "Dairy", number: "12" }],
            items: [
              {
                itemId: "0000000000001",
                size: "1 gal",
                price: { regular: 3.99, promo: 2.99 },
                fulfillment: { curbside: true, delivery: true, instore: true, shiptohome: false },
                inventory: { stockLevel: "IN_STOCK" },
              },
            ],
          },
        ],
      }),
    );
    const result = await callTool(server, "search_products", {
      terms: ["milk"],
      locationId: "70500847",
    });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(searchProductsOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("search_products");
    expect(result.structuredContent.results).toHaveLength(1);
    expect(result.structuredContent.totalProducts).toBeGreaterThanOrEqual(0);
  });

  it("handles multiple search terms in parallel", async () => {
    mockFetch.mockResolvedValue(
      mockKrogerResponse({
        data: [
          {
            upc: "0000000000001",
            description: "Milk",
            brand: "Kroger",
            items: [
              {
                itemId: "0000000000001",
                price: { regular: 3.99 },
                inventory: { stockLevel: "IN_STOCK" },
              },
            ],
          },
        ],
      }),
    );
    const result = await callTool(server, "search_products", {
      terms: ["milk", "bread", "eggs"],
      locationId: "70500847",
    });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(searchProductsOutputSchema, result.structuredContent);
    expect(result.structuredContent.results).toHaveLength(3);
  });

  it("handles null fulfillment fields", async () => {
    mockFetch.mockResolvedValue(
      mockKrogerResponse({
        data: [
          {
            upc: "0000000000002",
            description: "Organic Milk",
            brand: "Simple Truth",
            items: [
              {
                itemId: "0000000000002",
                size: "0.5 gal",
                price: { regular: 4.49 },
                fulfillment: { curbside: null, delivery: null, instore: null, shiptohome: null },
                inventory: { stockLevel: "IN_STOCK" },
              },
            ],
          },
        ],
      }),
    );
    const result = await callTool(server, "search_products", {
      terms: ["organic milk"],
      locationId: "70500847",
    });
    expectValidOutputSchema(searchProductsOutputSchema, result.structuredContent);
  });

  it("handles empty results", async () => {
    mockFetch.mockResolvedValue(mockKrogerResponse({ data: [] }));
    const result = await callTool(server, "search_products", { terms: ["nonexistentproductxyz"] });
    expect(result.content[0].text).toContain("No products found");
  });

  it("handles API errors gracefully", async () => {
    mockFetch.mockResolvedValue(mockKrogerResponse({ error: "Internal error" }, 500));
    const result = await callTool(server, "search_products", { terms: ["milk"] });
    // On API error the tool falls back to text response indicating the failure
    expect(result.content[0].text).toContain("Search failed");
  });
});

// ===========================================================================
// get_product_details
// ===========================================================================

describe("get_product_details", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("returns structuredContent matching outputSchema", async () => {
    mockFetch.mockResolvedValueOnce(
      mockKrogerResponse({
        data: {
          upc: "0000000000001",
          description: "Whole Milk",
          brand: "Kroger",
          categories: ["Dairy"],
          items: [
            {
              itemId: "0000000000001",
              price: { regular: 3.99 },
              inventory: { stockLevel: "IN_STOCK" },
            },
          ],
        },
      }),
    );
    const result = await callTool(server, "get_product_details", {
      productId: "0000000000001",
      locationId: "70500847",
    });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(getProductDetailsOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("get_product_details");
    expect(result.structuredContent.product.description).toBe("Whole Milk");
  });

  it("handles product not found", async () => {
    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ data: null }, 404));
    const result = await callTool(server, "get_product_details", { productId: "0000000000000" });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// manage_pantry
// ===========================================================================

describe("manage_pantry", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("adds items and returns structuredContent matching outputSchema", async () => {
    const result = await callTool(server, "manage_pantry", {
      action: "add",
      items: [{ productName: "Eggs", quantity: 12, expiresAt: "2026-06-20" }],
    });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(managePantryOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("manage_pantry");
    expect(result.structuredContent.items).toHaveLength(1);
    expect(result.structuredContent.items[0].productName).toBe("Eggs");
  });

  it("adds multiple items", async () => {
    const result = await callTool(server, "manage_pantry", {
      action: "add",
      items: [
        { productName: "Eggs", quantity: 12 },
        { productName: "Milk", quantity: 1 },
        { productName: "Bread", quantity: 2 },
      ],
    });
    expectValidOutputSchema(managePantryOutputSchema, result.structuredContent);
    expect(result.structuredContent.items).toHaveLength(3);
  });

  it("removes items", async () => {
    await callTool(server, "manage_pantry", {
      action: "add",
      items: [{ productName: "Eggs", quantity: 12 }],
    });
    const result = await callTool(server, "manage_pantry", {
      action: "remove",
      items: [{ productName: "Eggs", quantity: 1 }],
    });
    expectValidOutputSchema(managePantryOutputSchema, result.structuredContent);
    expect(result.structuredContent.items).toHaveLength(0);
  });

  it("clears pantry", async () => {
    await callTool(server, "manage_pantry", {
      action: "add",
      items: [{ productName: "Eggs", quantity: 12 }],
    });
    const result = await callTool(server, "manage_pantry", { action: "clear" });
    expectValidOutputSchema(managePantryOutputSchema, result.structuredContent);
    expect(result.structuredContent.items).toHaveLength(0);
    expect(result.structuredContent.actionDetail).toBe("Pantry cleared");
  });

  it("returns validation error when 'add' has no items", async () => {
    const result = await callTool(server, "manage_pantry", { action: "add" });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// manage_equipment
// ===========================================================================

describe("manage_equipment", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("adds equipment and returns text response", async () => {
    const result = await callTool(server, "manage_equipment", {
      action: "add",
      items: [{ equipmentName: "Chef Knife", category: "Cutting" }],
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Added");
    expect(result.content[0].text).toContain("Chef Knife");
  });

  it("adds multiple items", async () => {
    const result = await callTool(server, "manage_equipment", {
      action: "add",
      items: [
        { equipmentName: "Chef Knife", category: "Cutting" },
        { equipmentName: "Cutting Board", category: "Prep" },
        { equipmentName: "Mixing Bowls", category: "Baking" },
      ],
    });
    expect(result.content[0].text).toContain("Added 3 item(s)");
  });

  it("removes equipment by name", async () => {
    await callTool(server, "manage_equipment", {
      action: "add",
      items: [{ equipmentName: "Chef Knife", category: "Cutting" }],
    });
    const result = await callTool(server, "manage_equipment", {
      action: "remove",
      equipmentName: "Chef Knife",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("removed");
  });

  it("clears equipment", async () => {
    await callTool(server, "manage_equipment", {
      action: "add",
      items: [{ equipmentName: "Chef Knife", category: "Cutting" }],
    });
    const result = await callTool(server, "manage_equipment", { action: "clear" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("cleared");
  });

  it("returns validation error when 'remove' has no equipmentName", async () => {
    const result = await callTool(server, "manage_equipment", { action: "remove" });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// mark_order_placed
// ===========================================================================

describe("mark_order_placed", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("records an order and returns text response", async () => {
    const result = await callTool(server, "mark_order_placed", {
      items: [
        { productId: "0000000000001", productName: "Milk", quantity: 1, price: 3.99 },
        { productId: "0000000000002", productName: "Bread", quantity: 2, price: 4.5 },
      ],
      locationId: "70500847",
      notes: "Weekend shopping",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Order recorded");
    expect(result.content[0].text).toContain("3 items");
  });

  it("records order without optional fields", async () => {
    const result = await callTool(server, "mark_order_placed", {
      items: [{ productId: "0000000000001", productName: "Milk", quantity: 1 }],
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Order recorded");
  });

  it("handles empty items (recorded with 0 items)", async () => {
    const result = await callTool(server, "mark_order_placed", { items: [] });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Order recorded");
    expect(result.content[0].text).toContain("0 items");
  });
});

// ===========================================================================
// search_recipes_from_web
// ===========================================================================

describe("search_recipes_from_web", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("returns structuredContent matching outputSchema", async () => {
    mockFetch.mockResolvedValueOnce(
      mockKrogerResponse({
        success: true,
        data: {
          results: [
            {
              recipe: {
                title: "Chocolate Chip Cookies",
                description: "Classic cookies",
                cuisine: "American",
                difficulty: "Easy",
                prepTime: 15,
                cookTime: 12,
                totalTime: 27,
                servings: "24 cookies",
                slug: "chocolate-chip-cookies",
                ingredients: [
                  { quantity: "2", unit: "cups", name: "Flour", notes: "all-purpose" },
                  { quantity: "1", unit: "tsp", name: "Baking soda" },
                  { quantity: null, unit: null, name: "Salt", notes: null },
                ],
                instructions: [
                  { stepNumber: 1, instruction: "Preheat oven to 375°F" },
                  { stepNumber: 2, instruction: "Mix dry ingredients" },
                ],
              },
            },
          ],
        },
      }),
    );
    const result = await callTool(server, "search_recipes_from_web", {
      searchQuery: "chocolate chip cookies",
    });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(searchRecipesOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("search_recipes_from_web");
    expect(result.structuredContent.recipes).toHaveLength(1);
    expect(result.structuredContent.searchQuery).toBe("chocolate chip cookies");
  });

  it("handles null/undefined fields in recipe data", async () => {
    mockFetch.mockResolvedValueOnce(
      mockKrogerResponse({
        success: true,
        data: {
          results: [
            {
              recipe: {
                title: "Simple Salad",
                slug: "simple-salad",
                ingredients: [
                  { quantity: undefined, unit: undefined, name: "Lettuce", notes: undefined },
                ],
                instructions: [{ stepNumber: undefined, instruction: undefined }],
              },
            },
          ],
        },
      }),
    );
    const result = await callTool(server, "search_recipes_from_web", {
      searchQuery: "salad",
    });
    expectValidOutputSchema(searchRecipesOutputSchema, result.structuredContent);
  });

  it("handles API failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      mockKrogerResponse({ success: false, error: { message: "API error" } }),
    );
    const result = await callTool(server, "search_recipes_from_web", {
      searchQuery: "nonexistent",
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// plan_meals
// ===========================================================================

describe("plan_meals", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("returns meal plan text when pantry has items", async () => {
    await callTool(server, "manage_pantry", {
      action: "add",
      items: [
        { productName: "Chicken Breast", quantity: 2, expiresAt: "2026-06-08" },
        { productName: "Rice", quantity: 1 },
        { productName: "Broccoli", quantity: 3, expiresAt: "2026-06-07" },
      ],
    });
    const result = await callTool(server, "plan_meals", {
      numberOfMeals: 3,
      dietaryPreferences: "low-carb",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Meal Plan");
    expect(result.content[0].text).toContain("Chicken Breast");
    expect(result.content[0].text).toContain("Broccoli");
  });

  it("returns message when pantry is empty", async () => {
    const result = await callTool(server, "plan_meals", {});
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("pantry is empty");
  });

  it("respects mealType and numberOfMeals params", async () => {
    await callTool(server, "manage_pantry", {
      action: "add",
      items: [{ productName: "Eggs", quantity: 6 }],
    });
    const result = await callTool(server, "plan_meals", {
      numberOfMeals: 2,
      mealType: "breakfast",
    });
    expect(result.content[0].text).toContain("2 meal");
    expect(result.content[0].text).toContain("breakfast");
  });
});

// ===========================================================================
// manage_shopping_list
// ===========================================================================

describe("manage_shopping_list", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("adds items and returns structuredContent matching outputSchema", async () => {
    const result = await callTool(server, "manage_shopping_list", {
      action: "add",
      items: [
        { productName: "Whole Milk", upc: "0000000000001", quantity: 1, notes: "organic" },
        { productName: "Sourdough Bread", quantity: 2 },
      ],
    });
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(manageShoppingListOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("manage_shopping_list");
    expect(result.structuredContent.items).toHaveLength(2);
    expect(result.structuredContent.actionDetail).toBe("Added 2 item(s)");
  });

  it("adds single item", async () => {
    const result = await callTool(server, "manage_shopping_list", {
      action: "add",
      items: [{ productName: "Milk", quantity: 1 }],
    });
    expectValidOutputSchema(manageShoppingListOutputSchema, result.structuredContent);
    expect(result.structuredContent.items).toHaveLength(1);
  });

  it("removes an item by name", async () => {
    await callTool(server, "manage_shopping_list", {
      action: "add",
      items: [{ productName: "Milk", quantity: 1 }],
    });
    const result = await callTool(server, "manage_shopping_list", {
      action: "remove",
      productName: "Milk",
    });
    expectValidOutputSchema(manageShoppingListOutputSchema, result.structuredContent);
    expect(result.structuredContent.items).toHaveLength(0);
  });

  it("updates an item", async () => {
    await callTool(server, "manage_shopping_list", {
      action: "add",
      items: [{ productName: "Milk", quantity: 1 }],
    });
    const result = await callTool(server, "manage_shopping_list", {
      action: "update",
      productName: "Milk",
      quantity: 2,
      upc: "0000000000001",
      notes: "organic",
    });
    expectValidOutputSchema(manageShoppingListOutputSchema, result.structuredContent);
    expect(result.structuredContent.items[0].quantity).toBe(2);
  });

  it("clears shopping list", async () => {
    await callTool(server, "manage_shopping_list", {
      action: "add",
      items: [{ productName: "Milk", quantity: 1 }],
    });
    const result = await callTool(server, "manage_shopping_list", { action: "clear" });
    expectValidOutputSchema(manageShoppingListOutputSchema, result.structuredContent);
    expect(result.structuredContent.items).toHaveLength(0);
    expect(result.structuredContent.actionDetail).toBe("List cleared");
  });

  it("validates add action requires items", async () => {
    const result = await callTool(server, "manage_shopping_list", { action: "add" });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// checkout_shopping_list
// ===========================================================================

describe("checkout_shopping_list", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("adds items with UPCs to cart and returns updated list", async () => {
    await callTool(server, "manage_shopping_list", {
      action: "add",
      items: [
        { productName: "Milk", upc: "0000000000001", quantity: 1 },
        { productName: "Bread", upc: "0000000000002", quantity: 2 },
        { productName: "Unknown Item", quantity: 1 },
      ],
    });

    mockFetch.mockResolvedValueOnce(mockKrogerResponse({ data: {} }));

    const result = await callTool(server, "checkout_shopping_list", {
      locationId: "70500847",
      modality: "PICKUP",
    });

    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(manageShoppingListOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("manage_shopping_list");
    const milk = result.structuredContent.items.find((i: any) => i.productName === "Milk");
    expect(milk).toBeDefined();
    expect(milk.checked).toBe(true);
  });

  it("returns message when no unchecked items", async () => {
    const result = await callTool(server, "checkout_shopping_list", {});
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("No unchecked items");
  });
});

// ===========================================================================
// get_weekly_deals
// ===========================================================================

describe("get_weekly_deals", () => {
  let server: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("returns structuredContent matching outputSchema", async () => {
    mockFetch
      // Circulars API
      .mockResolvedValueOnce(
        mockKrogerResponse({
          data: [
            {
              eventId: "test-event",
              eventType: "weeklyAd",
              eventStartDate: "2026-06-01",
              eventEndDate: "2026-06-14",
              circularType: "print",
              tags: ["CLASSIC_VIEW"],
            },
          ],
        }),
      )
      // DACS listing API
      .mockResolvedValueOnce(
        mockKrogerResponse({
          pages: [{ eventPageId: "page-1", page: "1" }],
          adId: "ad-1",
          adTitle: "Weekly Ad",
          startDate: "2026-06-01",
          endDate: "2026-06-14",
        }),
      )
      // DACS page API (used for both pages in the for loop)
      .mockResolvedValue(
        mockKrogerResponse({
          eventPageId: "page-1",
          contents: [
            {
              contentType: "Offer",
              mapConfig: JSON.stringify({
                content: { id: 1, headline: "Milk 2%", bodyCopy: "Great deal" },
              }),
            },
            {
              contentType: "Offer",
              mapConfig: JSON.stringify({
                content: { id: 2, headline: "Bread", bodyCopy: "Fresh baked" },
              }),
            },
          ],
        }),
      );

    const result = await callTool(server, "get_weekly_deals", {
      locationId: "70500847",
      limit: 10,
      pageLimit: 1,
    });

    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(getWeeklyDealsOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("get_weekly_deals");
    expect(result.structuredContent.deals.length).toBeGreaterThanOrEqual(0);
    expect(result.structuredContent.cache).toBeDefined();
  });

  it("handles network errors with fallback to empty results", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));
    const result = await callTool(server, "get_weekly_deals", {
      locationId: "70500847",
    });
    // Error recovery: returns structuredContent (empty deals) + text warnings
    expect(result.structuredContent).toBeDefined();
    expectValidOutputSchema(getWeeklyDealsOutputSchema, result.structuredContent);
    expect(result.structuredContent._view).toBe("get_weekly_deals");
    expect(result.structuredContent.deals).toEqual([]);
    expect(result.content[0].text).toContain("Warnings");
  });
});

// ===========================================================================
// Input validation handles invalid args gracefully
// ===========================================================================

describe("input validation handles invalid args gracefully", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerAllTools(server, createMockKV());
  });

  it("search_products handles empty terms array without crashing", async () => {
    // Pass empty terms — terms filter inside the handler handles this
    const result = await callTool(server, "search_products", { terms: [] });
    // Handler should still produce a response (empty result is fine)
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("search_products handles long term strings", async () => {
    // Very long individual term string; handler checks `filter.term` length
    const result = await callTool(server, "search_products", {
      terms: ["x".repeat(200)],
    });
    expect(result).toBeDefined();
  });

  it("get_weekly_deals handles excessive limit", async () => {
    // Rejects invalid args; falls back somewhere without throwing
    const result = await callTool(server, "get_weekly_deals", { limit: 999 });
    expect(result).toBeDefined();
  });
});
