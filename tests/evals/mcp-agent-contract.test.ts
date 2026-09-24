import { describe, expect, it } from "vitest";

import type { McpServer } from "@modelcontextprotocol/server";
import type { KrogerClients } from "../../src/services/kroger/client.js";
import type { ProductService } from "../../src/services/kroger/product-service.js";
import type { WeeklyDealsCache } from "../../src/services/weekly-deals/cache.js";
import type {
  EquipmentStore,
  OrderHistoryStore,
  PantryStore,
  PreferredLocationStore,
  ShoppingListStore,
} from "../../src/utils/shopping-store.js";
import type { CartStore } from "../../src/utils/user-storage.js";

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
  inputSchema?: {
    safeParse: (input: unknown) => { success: boolean; data?: unknown };
  };
};

type CapturedTool = {
  name: string;
  config: ToolConfig;
  handler: ToolHandler;
};

const testState: { capturedTools: CapturedTool[] } = {
  capturedTools: [],
};

function makeDependencies() {
  const preferredLocation: PreferredLocationStore = {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  };
  const pantry = {} as PantryStore;
  const equipment = {} as EquipmentStore;
  const orderHistory = {} as OrderHistoryStore;
  const shoppingList = {} as ShoppingListStore;
  return {
    server: {
      registerTool: (
        name: string,
        config: ToolConfig,
        handler: ToolHandler,
      ) => {
        testState.capturedTools.push({ name, config, handler });
      },
      server: {
        elicitInput: async () => ({
          action: "accept",
          content: { confirm: true },
        }),
      },
    } as unknown as McpServer,
    productClient: {
      GET: async () => ({ response: new Response(null, { status: 204 }) }),
    } as unknown as KrogerClients["productClient"],
    locationClient: {
      GET: async () => ({ response: new Response(null, { status: 204 }) }),
    } as unknown as KrogerClients["locationClient"],
    cartClient: {
      PUT: async () => ({ response: new Response(null, { status: 204 }) }),
    } as unknown as KrogerClients["cartClient"],
    productService: {
      getProduct: () => {
        throw new Error("productService not used in this test");
      },
      enrichProductName: async () => null,
    } satisfies Pick<ProductService, "getProduct" | "enrichProductName">,
    preferredLocation,
    pantry,
    equipment,
    orderHistory,
    shoppingList,
    carts: {} as CartStore,
    ai: {} as Env["AI"],
    weeklyDealsCache: {} as WeeklyDealsCache,
    loadWeeklyDeals: async () => {
      throw new Error("Weekly deals not used in registration tests");
    },
  };
}

function registerAllTools() {
  testState.capturedTools.length = 0;
  const deps = makeDependencies();

  registerCartTools(deps.server, deps);
  registerLocationTools(deps.server, deps);
  registerProductTools(deps.server, deps);
  registerInventoryTools(deps.server, deps);
  registerOrderTools(deps.server, deps);
  registerRecipeTools(deps.server, deps);
  registerShoppingListTools(deps.server, deps);
  registerShopTools(deps.server, deps);
  registerWeeklyDealsTools(deps.server, deps);

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
      .toSorted();

    expect(toolNames).toEqual([
      "add_shopping_list_items",
      "add_shopping_list_to_cart",
      "add_to_inventory",
      "create_shopping_list",
      "edit_shopping_list_item",
      "get_meal_planning_context",
      "get_product",
      "get_shopping_list",
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

  it("publishes compatible MCP App resource metadata", () => {
    const appTools = registerAllTools().filter(
      (tool) => tool.config._meta?.ui?.resourceUri,
    );
    expect(appTools.length).toBeGreaterThan(0);
    expect(
      appTools.map((tool) => tool.config._meta?.["ui/resourceUri"]),
    ).toEqual(appTools.map((tool) => tool.config._meta?.ui?.resourceUri));
  });

  it("gives every tool metadata and exact annotations", () => {
    const tools = registerAllTools();
    for (const tool of tools) {
      if (tool.name === "get_shopping_profile") continue; // plain registerTool, no app UI
      expect(tool.config.title, `${tool.name} title`).toEqual(
        expect.any(String),
      );
      expect(tool.config.description, `${tool.name} description`).toEqual(
        expect.any(String),
      );
      expect(
        tool.config.description?.length,
        `${tool.name} description length`,
      ).toBeGreaterThan(60);
      expect(tool.config.inputSchema, `${tool.name} inputSchema`).toBeDefined();
      expect(tool.config.annotations, `${tool.name} annotations`).toMatchObject(
        {
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          idempotentHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
        },
      );
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
      expect(
        toolByName(tools, name).config.annotations?.readOnlyHint,
        `${name}`,
      ).toBe(true);
    }

    expect(
      toolByName(tools, "remove_from_inventory").config.annotations
        ?.destructiveHint,
    ).toBe(true);
  });

  it("keeps UI resources paired with every app-backed tool", () => {
    const tools = registerAllTools();
    const appBackedTools = [
      "add_to_inventory",
      "add_shopping_list_items",
      "add_shopping_list_to_cart",
      "create_shopping_list",
      "edit_shopping_list_item",
      "get_product",
      "get_shopping_list",
      "get_store",
      "get_weekly_deals",
      "record_order",
      "remove_from_inventory",
      "search_products",
      "search_stores",
      "set_preferred_store",
      "shop_for_items",
      "view_cart",
    ];

    for (const name of appBackedTools) {
      const tool = toolByName(tools, name);
      expect(tool.config._meta?.ui?.resourceUri, `${name} UI resource`).toBe(
        APP_VIEW_URI,
      );
    }

    const mealContext = toolByName(tools, "get_meal_planning_context");
    expect(mealContext.config._meta?.ui?.resourceUri).toBeUndefined();

    const shoppingProfile = toolByName(tools, "get_shopping_profile");
    expect(shoppingProfile.config._meta?.ui?.resourceUri).toBeUndefined();
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
      searchProducts.config.inputSchema?.safeParse({
        terms: ["milk"],
        providers: ["kroger"],
      }).success,
    ).toBe(false);
    expect(
      searchProducts.config.inputSchema?.safeParse({
        terms: ["milk"],
        stores: { kroger: "70500847" },
      }).success,
    ).toBe(false);
    expect(
      createShoppingList.config.inputSchema?.safeParse({
        name: "Empty",
        items: [],
      }).success,
    ).toBe(false);
    expect(
      createShoppingList.config.inputSchema?.safeParse({
        name: "Dinner",
        items: [{ upc: "0001112223334", quantity: 1 }],
      }).success,
    ).toBe(true);
    // Plain ingredients can reach a list without a Kroger UPC.
    expect(
      createShoppingList.config.inputSchema?.safeParse({
        name: "Dinner",
        items: [{ productName: "Milk", quantity: 1 }],
      }).success,
    ).toBe(true);
    // But an item with neither identifier is not.
    expect(
      createShoppingList.config.inputSchema?.safeParse({
        name: "Dinner",
        items: [{ quantity: 1 }],
      }).success,
    ).toBe(false);
  });
});
