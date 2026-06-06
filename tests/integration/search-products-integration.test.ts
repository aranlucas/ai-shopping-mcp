import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { createKrogerClients } from "../../src/services/kroger/client.js";
import { registerProductTools } from "../../src/tools/product.js";
import { createUserStorage } from "../../src/utils/user-storage.js";
import { registerViewResource } from "../../src/utils/view-resource.js";
import { APP_VIEW_URI } from "../../src/utils/view-resource.js";

// Mock the fetch globally for Kroger API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock KV namespace
const mockKV = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ keys: [] }),
};

const mockEnv = {
  USER_DATA_KV: mockKV,
  ASSETS: {
    fetch: vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("<html>test</html>"),
    }),
  },
  KROGER_CLIENT_ID: "test-client-id",
  KROGER_CLIENT_SECRET: "test-client-secret",
  COOKIE_ENCRYPTION_KEY: "test-key",
} as any;

describe("search_products integration test", () => {
  let server: McpServer;

  beforeEach(() => {
    vi.resetAllMocks();
    server = new McpServer({
      name: "test-kroger",
      version: "1.0.0",
    });

    // Create a mock user with valid tokens
    const mockProps = {
      id: "test-user-123",
      accessToken: "test-access-token",
      tokenExpiresAt: Date.now() + 3600000, // 1 hour from now
    };

    const clients = createKrogerClients(() => mockProps);
    const storage = createUserStorage(mockKV);

    const ctx = {
      server,
      clients,
      storage,
      getUser: () => mockProps,
      getEnv: () => mockEnv,
      getSessionId: () => "test-session",
    };

    registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");
    registerProductTools(ctx);
  });

  it("should return structuredContent that validates against outputSchema", async () => {
    // Mock the Kroger API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
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
      headers: new Headers(),
    });

    // Call the tool through the server
    const result = await server.callTool("search_products", {
      terms: ["milk"],
      locationId: "70500847",
    });

    // Verify the response structure
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.structuredContent).toBeDefined();

    // Verify structuredContent matches the output schema
    const structured = result.structuredContent as any;
    expect(structured._view).toBe("search_products");
    expect(Array.isArray(structured.results)).toBe(true);
    expect(structured.results.length).toBe(1);
    expect(structured.results[0].term).toBe("milk");
    expect(Array.isArray(structured.results[0].products)).toBe(true);
    expect(typeof structured.totalProducts).toBe("number");
  });

  it("should handle products with null fulfillment fields from API", async () => {
    // Mock API returning null fulfillment fields (the real bug case)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
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
      headers: new Headers(),
    });

    const result = await server.callTool("search_products", {
      terms: ["organic milk"],
      locationId: "70500847",
    });

    // Should not throw validation error
    expect(result).toBeDefined();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as any;
    expect(structured._view).toBe("search_products");
    expect(structured.results[0].products[0].items[0].fulfillment.curbside).toBeNull();
  });

  it("should handle empty results gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
      headers: new Headers(),
    });

    const result = await server.callTool("search_products", {
      terms: ["nonexistentproductxyz"],
    });

    expect(result).toBeDefined();
    expect(result.content[0].text).toContain("No products found");
  });

  it("should handle API errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: "Internal server error" }),
      headers: new Headers(),
    });

    const result = await server.callTool("search_products", {
      terms: ["milk"],
    });

    // Should return an error result, not throw
    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
  });
});

describe("search_recipes_from_web integration test", () => {
  let server: McpServer;
  let registerRecipeTools: any;

  beforeAll(async () => {
    const module = await import("../../src/tools/recipes.js");
    registerRecipeTools = module.registerRecipeTools;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    server = new McpServer({
      name: "test-kroger",
      version: "1.0.0",
    });

    const mockProps = {
      id: "test-user-123",
      accessToken: "test-access-token",
      tokenExpiresAt: Date.now() + 3600000,
    };

    const clients = createKrogerClients(() => mockProps);
    const storage = createUserStorage(mockKV);

    const ctx = {
      server,
      clients,
      storage,
      getUser: () => mockProps,
      getEnv: () => mockEnv,
      getSessionId: () => "test-session",
    };

    registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");
    registerRecipeTools(ctx);
  });

  it("should return structuredContent that validates against recipe outputSchema", async () => {
    // Mock the Janella's Cookbook API response with null/undefined fields
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
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
                  { quantity: "1", unit: "tsp", name: "Baking soda", notes: null },
                  { quantity: null, unit: null, name: "Salt", notes: null },
                  { quantity: "1", unit: "cup", name: "Butter", notes: "softened" },
                  { quantity: undefined, unit: undefined, name: "Eggs", notes: undefined },
                ],
                instructions: [
                  { stepNumber: 1, instruction: "Preheat oven to 375°F" },
                  { stepNumber: 2, instruction: "Mix dry ingredients" },
                  { stepNumber: undefined, instruction: undefined },
                ],
              },
            },
          ],
        },
      }),
      headers: new Headers(),
    });

    const result = await server.callTool("search_recipes_from_web", {
      searchQuery: "chocolate chip cookies",
    });

    expect(result).toBeDefined();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as any;
    expect(structured._view).toBe("search_recipes_from_web");
    expect(structured.recipes.length).toBe(1);

    const recipe = structured.recipes[0];
    expect(recipe.title).toBe("Chocolate Chip Cookies");
    expect(recipe.ingredients.length).toBe(5);
    // Verify null/undefined fields are handled
    expect(recipe.ingredients[1].notes).toBeNull();
    expect(recipe.ingredients[2].quantity).toBeNull();
    expect(recipe.ingredients[4].quantity).toBeUndefined();
    expect(recipe.instructions[2].stepNumber).toBeUndefined();
    expect(recipe.instructions[2].instruction).toBeUndefined();
  });
});
