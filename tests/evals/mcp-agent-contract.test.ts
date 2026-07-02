import { describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../../src/tools/types.js";

import { registerCartTools } from "../../src/tools/cart.js";
import { registerInventoryTools } from "../../src/tools/inventory.js";
import { registerLocationTools } from "../../src/tools/location.js";
import { registerOrderTools } from "../../src/tools/orders.js";
import { registerProductTools } from "../../src/tools/product.js";
import { registerRecipeTools } from "../../src/tools/recipes.js";
import { registerShopTools } from "../../src/tools/shop.js";
import { registerShoppingListTools } from "../../src/tools/shopping-list.js";
import { registerWeeklyDealsTools } from "../../src/tools/weekly-deals.js";
import { APP_VIEW_URI } from "../../src/utils/view-resource.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

type ToolConfig = {
  title?: string;
  description?: string;
  _meta?: { ui?: { resourceUri?: string }; [key: string]: unknown };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema?: { safeParse: (input: unknown) => { success: boolean; data?: unknown } };
};

type CapturedTool = {
  name: string;
  config: ToolConfig;
  handler: ToolHandler;
};

const testState = vi.hoisted(() => ({
  capturedTools: [] as CapturedTool[],
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: (_server: unknown, name: string, config: ToolConfig, handler: ToolHandler) => {
    testState.capturedTools.push({ name, config, handler });
  },
}));

function makeContext(): ToolContext {
  return {
    server: {
      registerTool: (name: string, config: ToolConfig, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
      server: {
        elicitInput: async () => ({ action: "accept", content: { confirm: true } }),
      },
    } as unknown as ToolContext["server"],
    clients: {
      productClient: { GET: async () => ({ response: new Response(null, { status: 204 }) }) },
      locationClient: { GET: async () => ({ response: new Response(null, { status: 204 }) }) },
      cartClient: { PUT: async () => ({ response: new Response(null, { status: 204 }) }) },
    } as unknown as ToolContext["clients"],
    storage: {} as ToolContext["storage"],
    getEnv: () => ({}) as Env,
    getSessionId: () => "eval-session",
  };
}

function registerAllTools() {
  testState.capturedTools.length = 0;
  const ctx = makeContext();

  registerCartTools(ctx);
  registerLocationTools(ctx);
  registerProductTools(ctx);
  registerInventoryTools(ctx);
  registerOrderTools(ctx);
  registerRecipeTools(ctx);
  registerShoppingListTools(ctx);
  registerShopTools(ctx);
  registerWeeklyDealsTools(ctx);

  return testState.capturedTools;
}

function toolByName(tools: CapturedTool[], name: string): CapturedTool {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool, `Missing tool ${name}`).toBeDefined();
  return tool as CapturedTool;
}

describe("MCP agent contract", () => {
  it("exposes the redesigned workflow-first tool surface", () => {
    const toolNames = registerAllTools()
      .map((tool) => tool.name)
      .sort();

    expect(toolNames).toEqual([
      "add_shopping_list_to_cart",
      "add_to_inventory",
      "create_shopping_list",
      "get_meal_planning_context",
      "get_product",
      "get_shopping_profile",
      "get_store",
      "get_weekly_deals",
      "record_order",
      "remove_from_inventory",
      "search_products",
      "search_stores",
      "set_preferred_store",
      "shop_for_items",
      "view_cart",
    ]);

    expect(toolNames).not.toContain("add_to_cart");
    expect(toolNames).not.toContain("add_kitchen_equipment");
    expect(toolNames).not.toContain("add_pantry_items");
    expect(toolNames).not.toContain("clear_kitchen_equipment");
    expect(toolNames).not.toContain("clear_pantry");
    expect(toolNames).not.toContain("get_location_details");
    expect(toolNames).not.toContain("get_product_details");
    expect(toolNames).not.toContain("manage_equipment");
    expect(toolNames).not.toContain("manage_pantry");
    expect(toolNames).not.toContain("mark_order_placed");
    expect(toolNames).not.toContain("plan_meals");
    expect(toolNames).not.toContain("remove_kitchen_equipment");
    expect(toolNames).not.toContain("remove_pantry_items");
    expect(toolNames).not.toContain("search_locations");
    expect(toolNames).not.toContain("set_preferred_location");
  });

  it("gives every tool metadata and exact annotations", () => {
    const tools = registerAllTools();
    for (const tool of tools) {
      if (tool.name === "get_shopping_profile") continue; // plain registerTool, no app UI
      expect(tool.config.title, `${tool.name} title`).toEqual(expect.any(String));
      expect(tool.config.description, `${tool.name} description`).toEqual(expect.any(String));
      expect(tool.config.description?.length, `${tool.name} description length`).toBeGreaterThan(
        60,
      );
      expect(tool.config.inputSchema, `${tool.name} inputSchema`).toBeDefined();
      expect(tool.config.annotations, `${tool.name} annotations`).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
    }

    for (const name of [
      "get_meal_planning_context",
      "get_product",
      "get_shopping_profile",
      "get_store",
      "get_weekly_deals",
      "search_products",
      "search_stores",
      "view_cart",
    ]) {
      expect(toolByName(tools, name).config.annotations?.readOnlyHint, name).toBe(true);
    }

    expect(toolByName(tools, "remove_from_inventory").config.annotations?.destructiveHint).toBe(
      true,
    );
  });

  it("keeps UI metadata paired with output schemas and routeable view payloads", () => {
    const tools = registerAllTools();
    const appBackedExamples: Record<string, Record<string, unknown>> = {
      add_to_inventory: { _view: "pantry", items: [], actionDetail: "Added 0 item(s)" },
      add_shopping_list_to_cart: {
        _view: "add_shopping_list_to_cart",
        listId: "list_abc12345",
        name: "Dinner",
        items: [],
        needsUpc: [],
      },
      create_shopping_list: {
        _view: "create_shopping_list",
        listId: "list_abc12345",
        name: "Dinner",
        items: [{ productName: "Milk", quantity: 1 }],
      },
      get_product: { _view: "get_product", product: { upc: "0001112223334" } },
      get_store: { _view: "get_store", store: { locationId: "70500847", name: "QFC" } },
      get_weekly_deals: { _view: "get_weekly_deals", deals: [], cache: { state: "miss" } },
      record_order: {
        _view: "record_order",
        orderId: "ORD-1",
        items: [{ productId: "0001112223334", productName: "Milk", quantity: 1 }],
        totalItems: 1,
        placedAt: "2026-06-30T00:00:00.000Z",
      },
      remove_from_inventory: { _view: "pantry", items: [], actionDetail: "Removed 1 item(s)" },
      search_products: { _view: "search_products", results: [], totalProducts: 0 },
      search_stores: { _view: "search_stores", stores: [] },
      set_preferred_store: {
        _view: "set_preferred_store",
        store: { locationId: "70500847", locationName: "QFC" },
      },
      shop_for_items: {
        _view: "create_shopping_list",
        listId: "list_abc12345",
        name: "Dinner",
        items: [],
      },
    };

    for (const [name, _example] of Object.entries(appBackedExamples)) {
      const tool = toolByName(tools, name);
      expect(tool.config._meta?.ui?.resourceUri, `${name} UI resource`).toBe(APP_VIEW_URI);
    }

    const mealContext = toolByName(tools, "get_meal_planning_context");
    expect(mealContext.config._meta?.ui?.resourceUri).toBeUndefined();

    const shoppingProfile = toolByName(tools, "get_shopping_profile");
    expect(shoppingProfile.config._meta?.ui?.resourceUri).toBeUndefined();

    const viewCart = toolByName(tools, "view_cart");
    expect(viewCart.config._meta?.ui?.resourceUri).toBeUndefined();
  });

  it("models product search and shopping list validation in schemas", () => {
    const tools = registerAllTools();
    const searchProducts = toolByName(tools, "search_products");
    const createShoppingList = toolByName(tools, "create_shopping_list");

    expect(
      searchProducts.config.inputSchema?.safeParse({
        terms: Array.from({ length: 10 }, (_, i) => `term-${i}`),
      }).success,
    ).toBe(true);
    expect(
      searchProducts.config.inputSchema?.safeParse({
        terms: Array.from({ length: 11 }, (_, i) => `term-${i}`),
      }).success,
    ).toBe(false);
    expect(
      createShoppingList.config.inputSchema?.safeParse({ name: "Empty", items: [] }).success,
    ).toBe(false);
    expect(
      createShoppingList.config.inputSchema?.safeParse({
        name: "Dinner",
        items: [{ productName: "Milk", quantity: 1 }],
      }).success,
    ).toBe(true);
  });
});
