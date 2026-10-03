import { capturingServer, type CapturedTool } from "../capturing-server.js";
import { makeContext } from "../tools/tool-test-harness.js";
import { z } from "zod";

import { describe, expect, it } from "vitest";

import { registerCartTools } from "../../src/tools/cart.js";
import { registerInventoryTools } from "../../src/tools/inventory.js";
import { registerLocationTools } from "../../src/tools/location.js";
import { registerOrderTools } from "../../src/tools/orders.js";
import { registerProductTools } from "../../src/tools/product.js";
import { registerShopTools } from "../../src/tools/shop.js";
import { registerShoppingListTools } from "../../src/tools/shopping-list.js";
import { registerWeeklyDealsTools } from "../../src/tools/weekly-deals.js";
import { APP_VIEW_URI } from "../../src/utils/view-resource.js";

type TestState = { capturedTools: CapturedTool[] };

const testState: TestState = { capturedTools: [] };

function makeDependencies() {
  const context = makeContext();
  context.server = capturingServer(testState.capturedTools, () => undefined);

  return context;
}

function resourceUri(tool: CapturedTool): string | undefined {
  const parsed = z
    .object({ ui: z.object({ resourceUri: z.string().optional() }).optional() })
    .safeParse(tool.config._meta);

  return parsed.success ? parsed.data.ui?.resourceUri : undefined;
}

function registerAllTools() {
  testState.capturedTools.length = 0;
  const deps = makeDependencies();

  registerCartTools(deps.server, deps);
  registerLocationTools(deps.server, deps);
  registerProductTools(deps.server, deps);
  registerInventoryTools(deps.server, deps);
  registerOrderTools(deps.server, deps);
  registerShoppingListTools(deps.server, deps);
  registerShopTools(deps.server, deps);
  registerWeeklyDealsTools(deps.server, deps);

  return testState.capturedTools;
}

function toolByName(tools: CapturedTool[], name: string): CapturedTool {
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) throw new Error(`Missing tool ${name}`);

  return tool;
}

describe("MCP agent contract", () => {
  it("exposes the redesigned workflow-first tool surface", () => {
    const toolNames = registerAllTools()
      .map((tool) => tool.name)
      .toSorted();

    expect(toolNames).toEqual([
      "add_shopping_list_to_cart",
      "create_shopping_list",
      "get_shopping_list",
      "get_shopping_profile",
      "get_weekly_deals",
      "record_order",
      "search_products",
      "search_stores",
      "set_preferred_store",
      "shop_for_items",
      "update_inventory",
      "update_shopping_list",
      "view_cart",
    ]);

    // Folded into the tools above; one home per question.
    for (const removed of [
      "add_shopping_list_items",
      "add_to_inventory",
      "edit_shopping_list_item",
      "get_meal_planning_context",
      "get_product",
      "get_store",
      "remove_from_inventory",
    ]) {
      expect(toolNames).not.toContain(removed);
    }

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
    const appTools = registerAllTools().filter((tool) => resourceUri(tool));

    expect(appTools.length).toBeGreaterThan(0);
    expect(
      appTools.map((tool) => tool.config._meta?.["ui/resourceUri"]),
    ).toEqual(appTools.map((tool) => resourceUri(tool)));
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
      "get_shopping_list",
      "get_shopping_profile",
      "get_weekly_deals",
      "search_products",
      "search_stores",
      "view_cart",
      "shop_for_items",
    ]) {
      expect(
        toolByName(tools, name).config.annotations?.readOnlyHint,
        `${name}`,
      ).toBe(true);
    }

    for (const name of ["update_inventory", "update_shopping_list"]) {
      expect(
        toolByName(tools, name).config.annotations?.destructiveHint,
        `${name} can remove items`,
      ).toBe(true);
    }

    for (const name of [
      "get_shopping_list",
      "get_shopping_profile",
      "search_products",
      "search_stores",
      "shop_for_items",
    ]) {
      expect(
        toolByName(tools, name).config.annotations?.idempotentHint,
        `${name} is a pure read`,
      ).toBe(true);
    }
  });

  it("keeps UI resources paired with every app-backed tool", () => {
    const tools = registerAllTools();

    const appBackedTools = [
      "add_shopping_list_to_cart",
      "create_shopping_list",
      "get_shopping_list",
      "get_weekly_deals",
      "record_order",
      "search_products",
      "search_stores",
      "set_preferred_store",
      "shop_for_items",
      "update_inventory",
      "update_shopping_list",
      "view_cart",
    ];

    for (const name of appBackedTools) {
      const tool = toolByName(tools, name);
      expect(resourceUri(tool), `${name} UI resource`).toBe(APP_VIEW_URI);
    }

    const shoppingProfile = toolByName(tools, "get_shopping_profile");
    expect(resourceUri(shoppingProfile)).toBeUndefined();
  });

  it("models product search and shopping list validation in schemas", () => {
    const tools = registerAllTools();
    const searchProducts = toolByName(tools, "search_products");
    const createShoppingList = toolByName(tools, "create_shopping_list");

    expect(searchProducts.config.inputSchema?.safeParse({}).success).toBe(
      false,
    );
    expect(
      searchProducts.config.inputSchema?.safeParse({
        terms: ["0001111041700"],
      }).success,
    ).toBe(true);

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
