import { describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../../src/tools/types.js";

import { registerCartTools } from "../../src/tools/cart.js";
import { registerEquipmentTools } from "../../src/tools/equipment.js";
import { registerLocationTools } from "../../src/tools/location.js";
import { registerOrderTools } from "../../src/tools/orders.js";
import { registerPantryTools } from "../../src/tools/pantry.js";
import { registerProductTools } from "../../src/tools/product.js";
import { registerRecipeTools } from "../../src/tools/recipes.js";
import { registerShoppingListTools } from "../../src/tools/shopping-list.js";
import { registerWeeklyDealsTools } from "../../src/tools/weekly-deals.js";
import { APP_VIEW_URI } from "../../src/utils/view-resource.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

type ToolConfig = {
  title?: string;
  description?: string;
  _meta?: { ui?: { resourceUri?: string } };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema?: { safeParse: (input: unknown) => { success: boolean; data?: unknown } };
  outputSchema?: { safeParse: (input: unknown) => { success: boolean } };
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
  registerPantryTools(ctx);
  registerEquipmentTools(ctx);
  registerOrderTools(ctx);
  registerRecipeTools(ctx);
  registerShoppingListTools(ctx);
  registerWeeklyDealsTools(ctx);

  return testState.capturedTools;
}

function toolByName(tools: CapturedTool[], name: string): CapturedTool {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool, `Missing tool ${name}`).toBeDefined();
  return tool as CapturedTool;
}

describe("MCP agent contract evals", () => {
  it("exposes a compact tool surface without legacy cart/list tools", () => {
    const tools = registerAllTools();
    const toolNames = tools.map((tool) => tool.name).sort();

    expect(toolNames).toEqual([
      "add_to_cart",
      "create_shopping_list",
      "get_location_details",
      "get_product_details",
      "get_weekly_deals",
      "manage_equipment",
      "manage_pantry",
      "mark_order_placed",
      "plan_meals",
      "search_locations",
      "search_products",
      "set_preferred_location",
    ]);
    expect(toolNames).not.toContain("manage_shopping_list");
    expect(toolNames).not.toContain("checkout_shopping_list");
  });

  it("gives every app tool enough metadata for agents to choose safely", () => {
    const tools = registerAllTools();

    for (const tool of tools) {
      expect(tool.config.title, `${tool.name} title`).toEqual(expect.any(String));
      expect(tool.config.description, `${tool.name} description`).toEqual(expect.any(String));
      expect(tool.config.description?.length, `${tool.name} description length`).toBeGreaterThan(
        40,
      );
      expect(tool.config._meta?.ui?.resourceUri, `${tool.name} UI resource`).toBe(APP_VIEW_URI);
      expect(tool.config.inputSchema, `${tool.name} inputSchema`).toBeDefined();
      expect(tool.config.annotations, `${tool.name} annotations`).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
    }
  });

  it("keeps structured app responses paired with output schemas", () => {
    const tools = registerAllTools();
    const structuredTools = [
      "add_to_cart",
      "create_shopping_list",
      "get_location_details",
      "get_product_details",
      "get_weekly_deals",
      "manage_pantry",
      "mark_order_placed",
      "search_locations",
      "search_products",
    ];

    for (const name of structuredTools) {
      expect(toolByName(tools, name).config.outputSchema, `${name} outputSchema`).toBeDefined();
    }
  });

  it("models cart checkout as create_shopping_list -> add_to_cart with a stable id", () => {
    const tools = registerAllTools();
    const createShoppingList = toolByName(tools, "create_shopping_list");
    const addToCart = toolByName(tools, "add_to_cart");

    const createInput = createShoppingList.config.inputSchema?.safeParse({
      name: "Taco night",
      items: [
        { productName: "Tortillas", quantity: 1 },
        { productName: "Whole Milk", upc: "0001111041700", quantity: 2 },
      ],
    });
    expect(createInput?.success).toBe(true);

    const createOutput = createShoppingList.config.outputSchema?.safeParse({
      _view: "create_shopping_list",
      shopping_list_id: "user-123:session:eval-session:list:abc12345",
      name: "Taco night",
      items: [{ productName: "Whole Milk", upc: "0001111041700", quantity: 2 }],
    });
    expect(createOutput?.success).toBe(true);

    const addInput = addToCart.config.inputSchema?.safeParse({
      shopping_list_id: "user-123:session:eval-session:list:abc12345",
    });
    expect(addInput?.success).toBe(true);

    const legacyCartInput = addToCart.config.inputSchema?.safeParse({
      items: [{ upc: "0001111041700", quantity: 2 }],
    });
    expect(legacyCartInput?.success).toBe(false);
  });

  it("marks read-only and mutating tools consistently for planning agents", () => {
    const tools = registerAllTools();

    for (const name of [
      "get_location_details",
      "get_product_details",
      "get_weekly_deals",
      "search_locations",
      "search_products",
    ]) {
      expect(toolByName(tools, name).config.annotations?.readOnlyHint, name).toBe(true);
    }

    for (const name of [
      "add_to_cart",
      "create_shopping_list",
      "manage_equipment",
      "manage_pantry",
      "mark_order_placed",
      "set_preferred_location",
    ]) {
      expect(toolByName(tools, name).config.annotations?.readOnlyHint, name).toBe(false);
    }
  });
});
