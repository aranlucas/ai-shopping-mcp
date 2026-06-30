# MCP API Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current MCP surface with a workflow-first, non-compatible API whose tools, resources, prompts, schemas, app views, and tests match the committed redesign spec.

**Architecture:** Keep the current stateless Cloudflare Worker MCP server architecture and existing module boundaries. Rename/split tool registrations inside the existing `src/tools/*.ts` modules, restore tool-local output schemas for app-backed tools, and update the shared React MCP App router to the new `_view` discriminators. Add a contract test suite that locks down the public MCP surface.

**Tech Stack:** TypeScript, Cloudflare Workers, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, Zod v4, Vitest workers pool, React MCP Apps view, pnpm.

## Global Constraints

- Backward compatibility is not required; do not keep aliases for old tool, resource, prompt, or `_view` names.
- `/mcp` must remain stateless and continue building a fresh `McpServer` per request.
- Auth `Props` must remain lazy inside tool execution through `getMcpAuthContext()` helpers.
- Do not reintroduce per-tool auth gating.
- Do not move Kroger token refresh into `createKrogerAuthMiddleware`.
- Use generated OpenAPI schema types from `src/services/kroger/*.js`; do not infer OpenAPI response types from `openapi-fetch`.
- Do not use `any` in TypeScript.
- Nested Kroger payload output schemas must use `z.looseObject`.
- Every app-backed successful tool result must include routeable `structuredContent._view` and a tool-local `outputSchema`.
- Text-only tools must not include `_meta.ui.resourceUri`.
- `search_products` must accept 1-10 terms and continue searching in parallel with progress notifications.
- `create_shopping_list` must reject empty `items`.
- If a change touches views, run `pnpm build:views` or `pnpm build`.
- Always run `pnpm test` before handing back behavioral changes.

---

## File Structure

- Modify `src/server.ts`: update server instructions and registrar list if tool module exports change.
- Modify `src/tools/location.ts`: rename store tools, add/restore output schemas, add structured preferred-store result.
- Modify `src/tools/product.ts`: restore output schemas, rename product details tool, cap search terms at 10, make empty searches structured.
- Modify `src/tools/shopping-list.ts`: require non-empty items and keep output schema for `create_shopping_list`.
- Modify `src/tools/cart.ts`: rename cart mutation to `add_shopping_list_to_cart`, output schema and `_view`.
- Modify `src/tools/pantry.ts`: split `manage_pantry` into `add_pantry_items`, `remove_pantry_items`, `clear_pantry`.
- Modify `src/tools/equipment.ts`: split `manage_equipment` into `add_kitchen_equipment`, `remove_kitchen_equipment`, `clear_kitchen_equipment` and return structured UI content.
- Modify `src/tools/orders.ts`: rename `mark_order_placed` to `record_order`, output schema and `_view`.
- Modify `src/tools/recipes.ts`: rename `plan_meals` to `get_meal_planning_context`, remove app UI metadata, return text plus structured context.
- Modify `src/tools/weekly-deals.ts`: restore output schema.
- Modify `src/tools/resources.ts`: rename resource titles/URIs and UPC wording.
- Modify `src/prompts.ts`: rename prompts and remove stale recipe-search wording.
- Modify `src/tools/tool-types.ts`: update exported argument types for renamed app-callable tools.
- Modify `views/shared/types.ts`: update tool call names, app data types, and `_view` union.
- Modify `views/App.tsx`: route renamed `_view` values and loading states.
- Modify `views/app/tool-calls.ts`: update app-initiated cart/list calls to `add_shopping_list_to_cart`.
- Modify `views/app/views/*.tsx`: update imports/types/labels only where renamed content requires it.
- Create or modify `views/app/views/KitchenEquipment.tsx`: render structured kitchen equipment results.
- Modify `views/dev/DevHarness.tsx` and `views/dev/mockData.ts`: update mock view names and data.
- Create `tests/evals/mcp-agent-contract.test.ts`: contract tests for public surface.
- Modify existing tests under `tests/tools/`, `tests/prompts.test.ts`, `tests/integration/mcp-client-oauth-integration.test.ts`, and `tests/views/tool-calls.test.ts` for renamed APIs and behavior.

---

### Task 1: Public Contract Tests

**Files:**

- Create: `tests/evals/mcp-agent-contract.test.ts`
- Modify: `package.json` only if the existing `eval:mcp` script needs no change; expected no edit.

**Interfaces:**

- Consumes: Existing tool registrar functions from `src/tools/*.ts`, `APP_VIEW_URI`.
- Produces: A failing contract suite that describes the redesigned MCP API.

- [ ] **Step 1: Write the failing contract test**

Create `tests/evals/mcp-agent-contract.test.ts` with this structure:

```typescript
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
  _meta?: { ui?: { resourceUri?: string }; [key: string]: unknown };
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

describe("MCP agent contract", () => {
  it("exposes the redesigned workflow-first tool surface", () => {
    const toolNames = registerAllTools()
      .map((tool) => tool.name)
      .sort();

    expect(toolNames).toEqual([
      "add_kitchen_equipment",
      "add_pantry_items",
      "add_shopping_list_to_cart",
      "clear_kitchen_equipment",
      "clear_pantry",
      "create_shopping_list",
      "get_meal_planning_context",
      "get_product",
      "get_store",
      "get_weekly_deals",
      "record_order",
      "remove_kitchen_equipment",
      "remove_pantry_items",
      "search_products",
      "search_stores",
      "set_preferred_store",
    ]);

    expect(toolNames).not.toContain("add_to_cart");
    expect(toolNames).not.toContain("get_location_details");
    expect(toolNames).not.toContain("get_product_details");
    expect(toolNames).not.toContain("manage_equipment");
    expect(toolNames).not.toContain("manage_pantry");
    expect(toolNames).not.toContain("mark_order_placed");
    expect(toolNames).not.toContain("plan_meals");
    expect(toolNames).not.toContain("search_locations");
    expect(toolNames).not.toContain("set_preferred_location");
  });

  it("gives every tool metadata and exact annotations", () => {
    const tools = registerAllTools();
    for (const tool of tools) {
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
      "get_store",
      "get_weekly_deals",
      "search_products",
      "search_stores",
    ]) {
      expect(toolByName(tools, name).config.annotations?.readOnlyHint, name).toBe(true);
    }

    for (const name of [
      "clear_kitchen_equipment",
      "clear_pantry",
      "remove_kitchen_equipment",
      "remove_pantry_items",
    ]) {
      expect(toolByName(tools, name).config.annotations?.destructiveHint, name).toBe(true);
    }
  });

  it("keeps UI metadata paired with output schemas and routeable view payloads", () => {
    const tools = registerAllTools();
    const appBackedExamples: Record<string, Record<string, unknown>> = {
      add_kitchen_equipment: {
        _view: "kitchen_equipment",
        items: [],
        actionDetail: "Added 0 item(s)",
      },
      add_pantry_items: { _view: "pantry", items: [], actionDetail: "Added 0 item(s)" },
      add_shopping_list_to_cart: {
        _view: "add_shopping_list_to_cart",
        shopping_list_id: "user-123:session:eval-session:list:abc12345",
        name: "Dinner",
        items: [],
        needsUpc: [],
      },
      clear_kitchen_equipment: {
        _view: "kitchen_equipment",
        items: [],
        actionDetail: "Kitchen equipment cleared",
      },
      clear_pantry: { _view: "pantry", items: [], actionDetail: "Pantry cleared" },
      create_shopping_list: {
        _view: "create_shopping_list",
        shopping_list_id: "user-123:session:eval-session:list:abc12345",
        name: "Dinner",
        items: [{ productName: "Milk", quantity: 1 }],
      },
      get_product: { _view: "get_product", product: { upc: "0001112223334", description: "Milk" } },
      get_store: { _view: "get_store", store: { locationId: "70500847", name: "QFC" } },
      get_weekly_deals: { _view: "get_weekly_deals", deals: [], cache: { state: "miss" } },
      record_order: {
        _view: "record_order",
        orderId: "ORD-1",
        items: [{ productId: "0001112223334", productName: "Milk", quantity: 1 }],
        totalItems: 1,
        placedAt: "2026-06-30T00:00:00.000Z",
      },
      remove_kitchen_equipment: {
        _view: "kitchen_equipment",
        items: [],
        actionDetail: "Removed 1 item(s)",
      },
      remove_pantry_items: { _view: "pantry", items: [], actionDetail: "Removed 1 item(s)" },
      search_products: { _view: "search_products", results: [], totalProducts: 0 },
      search_stores: { _view: "search_stores", stores: [] },
      set_preferred_store: {
        _view: "set_preferred_store",
        store: { locationId: "70500847", name: "QFC" },
      },
    };

    for (const [name, example] of Object.entries(appBackedExamples)) {
      const tool = toolByName(tools, name);
      expect(tool.config._meta?.ui?.resourceUri, `${name} UI resource`).toBe(APP_VIEW_URI);
      expect(tool.config.outputSchema, `${name} outputSchema`).toBeDefined();
      expect(tool.config.outputSchema?.safeParse(example).success, `${name} output example`).toBe(
        true,
      );
    }

    const mealContext = toolByName(tools, "get_meal_planning_context");
    expect(mealContext.config._meta?.ui?.resourceUri).toBeUndefined();
    expect(mealContext.config.outputSchema).toBeUndefined();
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
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm exec vitest run tests/evals/mcp-agent-contract.test.ts`

Expected: FAIL. The first test should show old tool names such as `add_to_cart`, `manage_pantry`, and `search_locations`, proving the test describes the new API.

- [ ] **Step 3: Do not change production code in this task**

This task only establishes the failing contract.

---

### Task 2: Store And Product Tools

**Files:**

- Modify: `src/tools/location.ts`
- Modify: `src/tools/product.ts`
- Modify: `tests/tools/product.test.ts`
- Modify: `tests/tools/storage-backed-tools.test.ts`

**Interfaces:**

- Consumes: Existing Kroger location/product OpenAPI component types.
- Produces: `search_stores`, `get_store`, `set_preferred_store`, `search_products`, `get_product`, and output schemas `searchStoresOutputSchema`, `getStoreOutputSchema`, `setPreferredStoreOutputSchema`, `searchProductsOutputSchema`, `getProductOutputSchema`.

- [ ] **Step 1: Add/update failing targeted tests**

Update tests so they request new tool names and behavior:

```typescript
expect(getCapturedHandler("search_stores")).toBeDefined();
expect(getCapturedHandler("get_store")).toBeDefined();
expect(getCapturedHandler("set_preferred_store")).toBeDefined();
expect(getCapturedHandler("get_product")).toBeDefined();
```

Add a `search_products` schema test in `tests/tools/product.test.ts`:

```typescript
it("rejects more than 10 search terms", () => {
  registerProductTools(makeContext(async () => makeSearchResponse([])));
  const tool = getCapturedTool("search_products");
  expect(
    tool.config.inputSchema.safeParse({ terms: Array.from({ length: 10 }, (_, i) => `term-${i}`) })
      .success,
  ).toBe(true);
  expect(
    tool.config.inputSchema.safeParse({ terms: Array.from({ length: 11 }, (_, i) => `term-${i}`) })
      .success,
  ).toBe(false);
});
```

Add an empty search result test:

```typescript
it("returns routeable structured content when no products match", async () => {
  registerProductTools(makeContext(async () => makeSearchResponse([])));
  const result = await getCapturedHandler("search_products")({ terms: ["dragonfruit"] });
  expect(result).toMatchObject({
    structuredContent: {
      _view: "search_products",
      results: [{ term: "dragonfruit", products: [], count: 0, failed: false }],
      totalProducts: 0,
    },
  });
});
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `pnpm exec vitest run tests/tools/product.test.ts tests/tools/storage-backed-tools.test.ts -t "rejects more than 10|routeable structured|searches stores|returns structured store|saves preferred"`

Expected: FAIL because old names and old empty-search behavior are still present.

- [ ] **Step 3: Implement store tool renames and schemas**

In `src/tools/location.ts`:

- Rename registered tools:
  - `"search_locations"` to `"search_stores"`.
  - `"get_location_details"` to `"get_store"`.
  - `"set_preferred_location"` to `"set_preferred_store"`.
- Rename structured fields:
  - search result `locations` to `stores`.
  - detail result `location` to `store`.
- Add loose store schemas and `outputSchema` values.
- Return structured content from `set_preferred_store`:

```typescript
structuredContent: {
  _view: "set_preferred_store" as const,
  store: preferredLocation,
  actionDetail: `Preferred store set to ${preferredLocation.locationName}`,
}
```

- [ ] **Step 4: Implement product tool contract**

In `src/tools/product.ts`:

- Rename `"get_product_details"` to `"get_product"`.
- Rename detail `_view` to `"get_product"`.
- Change `terms.max(25)` to `terms.max(10)` and update message to `"Maximum 10 search terms allowed"`.
- Restore loose product output schemas.
- Add `outputSchema` to `search_products` and `get_product`.
- For no matches, return:

```typescript
{
  ...toonResult({ termCount: terms.length, totalProducts: 0, results: resultsForContent }),
  structuredContent: { _view: "search_products", results, totalProducts: 0 },
}
```

- [ ] **Step 5: Run targeted tests**

Run: `pnpm exec vitest run tests/tools/product.test.ts tests/tools/storage-backed-tools.test.ts`

Expected: PASS for updated store/product tests, with remaining failures in unrelated renamed modules acceptable until later tasks.

---

### Task 3: Shopping List And Cart Tools

**Files:**

- Modify: `src/tools/shopping-list.ts`
- Modify: `src/tools/cart.ts`
- Modify: `tests/tools/cart.test.ts`
- Modify: `tests/tools/storage-backed-tools.test.ts`
- Modify: `tests/tools/shopping-list-confirmation.test.ts` only if wording changes affect assertions.

**Interfaces:**

- Consumes: `requestCheckoutConfirmation`, `getSessionScopedUserId`, shopping list storage.
- Produces: `createShoppingListOutputSchema`, `addShoppingListToCartInputSchema`, `addShoppingListToCartOutputSchema`, tool `add_shopping_list_to_cart`.

- [ ] **Step 1: Write failing tests**

Update the empty list test to assert an error:

```typescript
it("rejects shopping list creation with empty items before touching storage", async () => {
  const storage = makeStorage();
  registerShoppingListTools(makeContext(storage));
  const handler = getCapturedHandler("create_shopping_list");

  const result = await handler({ name: "Empty", items: [] });

  expect(isErrorResult(result)).toBe(true);
  expect(textFromResult(result)).toContain("at least one item");
});
```

Update cart tests to use `add_shopping_list_to_cart` and expect `_view: "add_shopping_list_to_cart"`.

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `pnpm exec vitest run tests/tools/cart.test.ts tests/tools/storage-backed-tools.test.ts -t "empty items|shopping list|cart"`

Expected: FAIL because `items` currently accepts empty arrays and the old cart tool name is registered.

- [ ] **Step 3: Implement shopping list validation and output schema**

In `createShoppingListInputSchema`, change:

```typescript
items: z.array(...).min(1, { message: "Shopping list must include at least one item" })
```

Restore `createShoppingListOutputSchema` and add it to `registerAppTool`.

- [ ] **Step 4: Rename and schema cart tool**

In `src/tools/cart.ts`:

- Rename `addToCartInputSchema` to `addShoppingListToCartInputSchema`.
- Rename registered tool to `"add_shopping_list_to_cart"`.
- Change title to `"Add Shopping List to Cart"`.
- Update description to mention Kroger/QFC cart and `shopping_list_id`.
- Restore output schema with `_view: z.literal("add_shopping_list_to_cart")`.
- Update all returned structured content `_view` values.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm exec vitest run tests/tools/cart.test.ts tests/tools/storage-backed-tools.test.ts tests/tools/shopping-list-confirmation.test.ts`

Expected: PASS for shopping list/cart tests after updates.

---

### Task 4: Pantry, Kitchen Equipment, Order, And Meal Context Tools

**Files:**

- Modify: `src/tools/pantry.ts`
- Modify: `src/tools/equipment.ts`
- Modify: `src/tools/orders.ts`
- Modify: `src/tools/recipes.ts`
- Modify: `tests/tools/storage-backed-tools.test.ts`
- Modify: `tests/tools/recipes.test.ts`

**Interfaces:**

- Produces split pantry/equipment tools, `record_order`, `get_meal_planning_context`.
- Produces output schemas: `pantryOutputSchema`, `kitchenEquipmentOutputSchema`, `recordOrderOutputSchema`.

- [ ] **Step 1: Write failing tests for split tools**

In `tests/tools/storage-backed-tools.test.ts`, replace action-based pantry/equipment calls with direct tool handlers:

```typescript
const addPantry = getCapturedHandler("add_pantry_items");
const removePantry = getCapturedHandler("remove_pantry_items");
const clearPantry = getCapturedHandler("clear_pantry");
```

Assert `_view: "pantry"` for all pantry structured outputs.

For equipment, add structured assertions:

```typescript
expect(addResult).toMatchObject({
  structuredContent: {
    _view: "kitchen_equipment",
    items: [{ equipmentName: "Dutch oven", category: "Cooking" }],
    actionDetail: "Added 1 item(s)",
  },
});
```

Update order tests to call `record_order` and expect `_view: "record_order"`.

Update recipe tests to call `get_meal_planning_context` and assert no UI metadata in captured config.

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `pnpm exec vitest run tests/tools/storage-backed-tools.test.ts tests/tools/recipes.test.ts`

Expected: FAIL because the split tools and renamed order/meal tools do not exist yet.

- [ ] **Step 3: Split pantry tools**

In `src/tools/pantry.ts`:

- Keep a reusable item schema.
- Register `add_pantry_items` with input `{ items: [...] }`.
- Register `remove_pantry_items` with input `{ items: [{ productName }] }`.
- Register `clear_pantry` with empty input schema `z.object({})`.
- Return structured content `{ _view: "pantry", items, actionDetail }`.
- Use accurate annotations per spec.

- [ ] **Step 4: Split kitchen equipment tools**

In `src/tools/equipment.ts`:

- Register `add_kitchen_equipment` with input `{ items: [...] }`.
- Register `remove_kitchen_equipment` with input `{ equipmentName: string }`.
- Register `clear_kitchen_equipment` with empty input schema.
- Return structured content `{ _view: "kitchen_equipment", items, actionDetail }`.
- Add output schema to each app-backed registration.

- [ ] **Step 5: Rename order tool**

In `src/tools/orders.ts`:

- Rename registered tool to `record_order`.
- Rename output schema to `recordOrderOutputSchema`.
- Change structured `_view` to `"record_order"`.
- Tighten description: the tool records an already completed order; it does not place or pay for an order.

- [ ] **Step 6: Rename meal planning context tool**

In `src/tools/recipes.ts`:

- Rename `plan_meals` registration to `get_meal_planning_context`.
- Remove `_meta: { ui: { resourceUri: APP_VIEW_URI } }`.
- Remove `APP_VIEW_URI` import.
- Description must say it returns context for the host model.
- Keep text response and add structured context if useful:

```typescript
structuredContent: {
  pantry: categorizedPantry,
  equipment,
  recentOrders,
  request: { numberOfMeals, mealType, dietaryPreferences, prioritizeExpiring },
}
```

- [ ] **Step 7: Run targeted tests**

Run: `pnpm exec vitest run tests/tools/storage-backed-tools.test.ts tests/tools/recipes.test.ts`

Expected: PASS for storage-backed and meal context tests after updates.

---

### Task 5: Weekly Deals, Resources, Prompts, And Server Instructions

**Files:**

- Modify: `src/tools/weekly-deals.ts`
- Modify: `src/tools/resources.ts`
- Modify: `src/prompts.ts`
- Modify: `src/server.ts`
- Modify: `tests/tools/weekly-deals.test.ts`
- Modify: `tests/tools/resources-registration.test.ts`
- Modify: `tests/prompts.test.ts`
- Modify: `tests/integration/mcp-client-oauth-integration.test.ts`

**Interfaces:**

- Produces `getWeeklyDealsOutputSchema`.
- Produces renamed resource URIs and prompt names.
- Produces updated server instructions.

- [ ] **Step 1: Write failing tests**

Update resource registration expectations:

```typescript
expect(resourceNames).toEqual([
  "Pantry",
  "Kitchen Equipment",
  "Preferred Store",
  "Order History",
  "Product Details",
]);
```

Update resource read calls to:

```typescript
await callResource("Kitchen Equipment", "shopping://user/kitchen-equipment");
await callResource("Preferred Store", "shopping://user/preferred-store");
await callResource("Order History", "shopping://user/order-history");
```

Update prompt tests to expect:

```typescript
expect(names).toEqual([
  "plan_shopping_route",
  "set_preferred_store",
  "shop_recipe_ingredients",
  "plan_meals_from_pantry",
]);
```

Add assertions that prompt text contains new tool names and does not contain old names.

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `pnpm exec vitest run tests/prompts.test.ts tests/tools/resources-registration.test.ts tests/tools/weekly-deals.test.ts tests/integration/mcp-client-oauth-integration.test.ts`

Expected: FAIL because old resource/prompt names and old server instructions are still present.

- [ ] **Step 3: Restore weekly deals output schema**

In `src/tools/weekly-deals.ts`, restore loose `dealSchema`, export `getWeeklyDealsOutputSchema`, and add `outputSchema` to `get_weekly_deals`.

- [ ] **Step 4: Rename resources**

In `src/tools/resources.ts`:

- Change titles and URIs:
  - `"Equipment Inventory"` to `"Kitchen Equipment"` and `shopping://user/equipment` to `shopping://user/kitchen-equipment`.
  - `"Preferred Store Location"` to `"Preferred Store"` and `shopping://user/location` to `shopping://user/preferred-store`.
  - `"Order History"` URI to `shopping://user/order-history`.
- Update descriptions to say store and UPC, not location/product ID where clearer.

- [ ] **Step 5: Rename prompts and update wording**

In `src/prompts.ts`:

- Rename `grocery-list-store_path` to `plan_shopping_route`.
- Keep `set_preferred_store` but update prompt text to call `search_stores`.
- Rename `add_recipe_to_cart` to `shop_recipe_ingredients`.
- Add `plan_meals_from_pantry`.
- Remove stale web recipe wording.

- [ ] **Step 6: Rewrite server instructions**

In `src/server.ts`, replace `SERVER_OPTIONS.instructions` with the compact workflow guide from the spec and new tool/resource names.

- [ ] **Step 7: Run targeted tests**

Run: `pnpm exec vitest run tests/prompts.test.ts tests/tools/resources-registration.test.ts tests/tools/weekly-deals.test.ts tests/integration/mcp-client-oauth-integration.test.ts`

Expected: PASS for prompt/resource/weekly-deals/integration assertions after updates.

---

### Task 6: Views And App-Initiated Tool Calls

**Files:**

- Modify: `views/shared/types.ts`
- Modify: `views/App.tsx`
- Modify: `views/app/tool-calls.ts`
- Modify: `views/app/views/AddToCart.tsx`
- Modify: `views/app/views/LocationDetail.tsx`
- Modify: `views/app/views/LocationResults.tsx`
- Modify: `views/app/views/OrderHistory.tsx`
- Modify: `views/app/views/Pantry.tsx`
- Modify: `views/app/views/ProductDetail.tsx`
- Modify: `views/app/views/ProductSearch.tsx`
- Modify: `views/app/views/ShoppingList.tsx`
- Create: `views/app/views/KitchenEquipment.tsx`
- Modify: `views/dev/DevHarness.tsx`
- Modify: `views/dev/mockData.ts`
- Modify: `tests/views/tool-calls.test.ts`

**Interfaces:**

- Consumes server `structuredContent` shapes.
- Produces routeable React views for all app-backed `_view` discriminators.

- [ ] **Step 1: Write failing view tests**

In `tests/views/tool-calls.test.ts`, update calls to expect `add_shopping_list_to_cart`:

```typescript
expect(app.calls[1]).toMatchObject({
  name: "add_shopping_list_to_cart",
  arguments: { shopping_list_id: "user-123:session:s1:list:def67890", modality: "PICKUP" },
});
```

If there is no parser test, add:

```typescript
expect(
  parseStructuredContent({
    _view: "add_shopping_list_to_cart",
    shopping_list_id: "id",
    name: "Dinner",
    items: [],
    needsUpc: [],
  })?._view,
).toBe("add_shopping_list_to_cart");
expect(parseStructuredContent({ _view: "add_to_cart" })).toBeNull();
```

- [ ] **Step 2: Run view tests to verify failure**

Run: `pnpm exec vitest run tests/views/tool-calls.test.ts`

Expected: FAIL because the view types and app calls still use old names.

- [ ] **Step 3: Update shared types**

In `views/shared/types.ts`:

- Update `ToolCall` to use `add_shopping_list_to_cart`.
- Replace `get_product_details` with `get_product`.
- Replace `search_locations`/`get_location_details` with `search_stores`/`get_store`.
- Replace `add_to_cart` content `_view` with `add_shopping_list_to_cart`.
- Replace `manage_pantry` content `_view` with `pantry`.
- Add `KitchenEquipmentContent` with `_view: "kitchen_equipment"`.
- Replace `mark_order_placed` with `record_order`.
- Add `set_preferred_store` content if it has a routeable view.

- [ ] **Step 4: Update router and components**

In `views/App.tsx`:

- Update loading messages for renamed tools.
- Route `search_stores` to `LocationResultsView`.
- Route `get_store` and `set_preferred_store` to store detail views.
- Route `get_product` to `ProductDetailView`.
- Route `add_shopping_list_to_cart` to `AddToCartView`.
- Route `pantry` to `PantryView`.
- Route `kitchen_equipment` to `KitchenEquipmentView`.
- Route `record_order` to `OrderHistoryView`.

Update components only where field names changed:

- `LocationResultsView` should read `data.stores`.
- `LocationDetailView` should read `data.store`.
- `ProductDetailView` should accept `_view: "get_product"`.
- `AddToCartView` should accept `_view: "add_shopping_list_to_cart"`.

- [ ] **Step 5: Add kitchen equipment view**

Create `views/app/views/KitchenEquipment.tsx`:

```typescript
import type { KitchenEquipmentContent } from "../../shared/types.js";

import { EmptyState, ListShell } from "../../shared/components.js";

type Props = {
  data: KitchenEquipmentContent;
};

export function KitchenEquipmentView({ data }: Props) {
  return (
    <ListShell title="Kitchen Equipment" subtitle={data.actionDetail}>
      {data.items.length === 0 ? (
        <EmptyState title="No equipment saved" message="Kitchen equipment will appear here after it is added." />
      ) : (
        <ul className="divide-y divide-border">
          {data.items.map((item) => (
            <li key={item.equipmentName} className="py-3">
              <div className="font-medium">{item.equipmentName}</div>
              {item.category ? <div className="text-sm text-muted-foreground">{item.category}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </ListShell>
  );
}
```

If `ListShell`/`EmptyState` do not exist with those signatures, reuse the nearest existing shared components from `views/shared/components.tsx` and keep the view minimal.

- [ ] **Step 6: Update dev harness and mocks**

Update `views/dev/mockData.ts` and `views/dev/DevHarness.tsx` so every redesigned `_view` has mock data and no legacy view names remain.

- [ ] **Step 7: Run view tests and view build**

Run: `pnpm exec vitest run tests/views/tool-calls.test.ts`

Expected: PASS.

Run: `pnpm build:views`

Expected: PASS.

---

### Task 7: Full Contract, Build, And Test Verification

**Files:**

- Modify whichever tests still reference old tool names.
- No production file should be edited in this task unless a failing test exposes an implementation gap.

**Interfaces:**

- Consumes: all previous tasks.
- Produces: verified API redesign.

- [ ] **Step 1: Run the full MCP contract test**

Run: `pnpm exec vitest run tests/evals/mcp-agent-contract.test.ts`

Expected: PASS.

- [ ] **Step 2: Search for forbidden legacy public names**

Run:

```bash
rg -n "add_to_cart|get_location_details|get_product_details|manage_equipment|manage_pantry|mark_order_placed|plan_meals|search_locations|set_preferred_location|grocery-list-store_path|add_recipe_to_cart|shopping://user/equipment|shopping://user/location|shopping://user/orders" src tests views docs/ROADMAP.md
```

Expected: only historical docs/spec references where explicitly describing replaced names. No live `src`, `tests`, or `views` references should remain.

- [ ] **Step 3: Run build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 4: Run full tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 5: Final completion audit**

Verify against the design spec:

- Tool names match exactly.
- Resource URIs match exactly.
- Prompt names match exactly.
- App-backed tools have UI metadata, output schemas, and routeable `_view`.
- Text-only `get_meal_planning_context` has no UI metadata.
- `search_products` 10-term cap is enforced.
- `create_shopping_list.items` non-empty is enforced.
- Views route all structured outputs.
- Build and full test suite pass.

If all checks pass, mark the goal complete.

---

## Self-Review

- Spec coverage: every design section maps to at least one task.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation steps remain.
- Type consistency: new public names are consistently spelled as `search_stores`, `get_store`, `set_preferred_store`, `get_product`, `add_shopping_list_to_cart`, `pantry`, `kitchen_equipment`, `record_order`, and `get_meal_planning_context`.
- Verification scope: targeted tests, `pnpm build`, and `pnpm test` are explicitly required before completion.
