// oxlint-disable perfectionist/sort-imports
// tool-test-harness installs module mocks before the tool modules are imported.
import { beforeEach, describe, expect, it } from "vitest";

import type { ShoppingStore } from "../../src/utils/shopping-store.js";

import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  makeStorage,
  resetToolTestHarness,
  unauthenticate,
} from "./tool-test-harness.js";
import { registerInventoryTools as registerInventoryToolsImpl } from "../../src/tools/inventory.js";

function registerInventoryTools(fixture: ReturnType<typeof makeContext>) {
  registerInventoryToolsImpl(fixture.server, fixture);
}

describe("inventory and profile tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("adds pantry items and returns structured view content", async () => {
    registerInventoryTools(makeContext());

    const result = await getCapturedHandler("update_inventory")({
      pantry: { add: [{ name: "Milk" }] },
    });

    expect(result.text).toContain("Added 1 pantry item(s)");
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "pantry" },
      structuredContent: {
        actionDetail: "Added 1 pantry item(s).",
        items: [{ productName: "Milk", quantity: 1 }],
      },
    });
  });

  it("rejects update_inventory without any add or remove", () => {
    registerInventoryTools(makeContext());
    const { inputSchema } = getCapturedTool("update_inventory").config as {
      inputSchema: { safeParse: (value: unknown) => { success: boolean } };
    };

    expect(inputSchema.safeParse({}).success).toBe(false);
    expect(inputSchema.safeParse({ pantry: {} }).success).toBe(false);
    expect(inputSchema.safeParse({ pantry: { add: [] } }).success).toBe(false);
  });

  it("uses up and removes pantry items, with no clear-all path", async () => {
    const storage = makeStorage();
    registerInventoryTools(makeContext(storage));
    const update = getCapturedHandler("update_inventory");

    await update({
      pantry: {
        add: [
          { name: "Eggs", quantity: 12 },
          { name: "Bread", quantity: 2 },
          { name: "Milk" },
        ],
      },
    });

    const result = await update({
      pantry: { remove: [{ name: "Eggs", quantity: 6 }, { name: "Milk" }] },
    });
    expect(result.text).toContain("Used or removed 2 pantry item(s)");
    expect(result).toMatchObject({
      structuredContent: {
        items: [
          { productName: "Eggs", quantity: 6 },
          { productName: "Bread", quantity: 2 },
        ],
      },
    });

    const { inputSchema } = getCapturedTool("update_inventory").config as {
      inputSchema: { safeParse: (value: unknown) => { success: boolean } };
    };
    expect(
      inputSchema.safeParse({ pantry: { all: true } } as unknown).success,
    ).toBe(false);
  });

  it("throws when inventory tools are used outside an authenticated request", async () => {
    unauthenticate();
    registerInventoryTools(makeContext());

    await expect(
      getCapturedHandler("update_inventory")({
        pantry: { remove: [{ name: "Eggs" }] },
      }),
    ).rejects.toThrow("outside an authenticated MCP request");
  });

  it("adds and removes kitchen equipment", async () => {
    registerInventoryTools(makeContext());
    const update = getCapturedHandler("update_inventory");

    const addResult = await update({
      equipment: { add: [{ name: "Dutch oven", category: "Cooking" }] },
    });
    expect(addResult.text).toContain("Added 1 equipment item(s)");
    expect(addResult).toMatchObject({
      _meta: { "dev.aranlucas/view": "kitchen_equipment" },
      structuredContent: {
        items: [{ equipmentName: "Dutch oven", category: "Cooking" }],
      },
    });

    const removeResult = await update({
      equipment: { remove: ["Dutch oven"] },
    });
    expect(removeResult.text).toContain("Removed 1 equipment item(s)");
    expect(removeResult).toMatchObject({
      _meta: { "dev.aranlucas/view": "kitchen_equipment" },
      structuredContent: { items: [] },
    });
  });

  it("updates pantry and equipment together, showing the pantry view", async () => {
    registerInventoryTools(makeContext());

    const result = await getCapturedHandler("update_inventory")({
      pantry: { add: [{ name: "Flour" }] },
      equipment: { add: [{ name: "Stand mixer" }] },
    });

    expect(result.text).toContain("Pantry now:");
    expect(result.text).toContain("Equipment now:");
    expect(result).toMatchObject({ _meta: { "dev.aranlucas/view": "pantry" } });
  });

  describe("get_shopping_profile", () => {
    it("reports 'none set' guidance when no preferred store is set", async () => {
      registerInventoryTools(makeContext());

      const result = await getCapturedHandler("get_shopping_profile")({});

      expect(result.isError).toBe(false);
      const text = result.text;
      expect(text).toContain(
        "Preferred store: none set; use search_stores + set_preferred_store",
      );
      expect(text).toContain("Pantry:\n- empty");
      expect(text).toContain("Kitchen equipment:\n- none");
      expect(text).toContain("Frequently purchased:\n- no order history yet");
      expect(text).toContain("Due to restock:\n- nothing due");
      expect(text).not.toContain("## ");
      expect(result).toMatchObject({
        structuredContent: { preferredStore: null, pantry: [], equipment: [] },
      });
    });

    it("lists items due to restock based on order history cadence", async () => {
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const daysAgoIso = (days: number) =>
        new Date(now - days * DAY).toISOString();

      // Milk bought every ~10 days, but the most recent purchase was 30 days
      // ago — well past due.
      const storage = makeStorage({
        orderHistory: {
          getRecent: async () => [
            {
              orderId: "o3",
              items: [
                { upc: "0000000000001", productName: "Milk", quantity: 1 },
              ],
              totalItems: 1,
              placedAt: daysAgoIso(30),
            },
            {
              orderId: "o2",
              items: [
                { upc: "0000000000001", productName: "Milk", quantity: 1 },
              ],
              totalItems: 1,
              placedAt: daysAgoIso(40),
            },
            {
              orderId: "o1",
              items: [
                { upc: "0000000000001", productName: "Milk", quantity: 1 },
              ],
              totalItems: 1,
              placedAt: daysAgoIso(50),
            },
          ],
        } as unknown as ShoppingStore["orderHistory"],
      });
      registerInventoryTools(makeContext(storage));

      const result = await getCapturedHandler("get_shopping_profile")({});

      const text = result.text;
      expect(text).toContain("Due to restock:");
      expect(text).toContain("Milk (last bought 30d ago, usually every ~10d)");
    });

    it("summarizes preferred store, pantry with expiring flags, equipment, and frequently purchased items", async () => {
      const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const storage = makeStorage({
        preferredLocation: {
          get: async () => ({
            locationId: "70500034",
            locationName: "QFC Broadway",
            address: "417 Broadway E",
            chain: "QFC",
            setAt: new Date().toISOString(),
          }),
          set: async () => {},
        } as unknown as ShoppingStore["preferredLocation"],
        pantry: {
          getAll: async () => [
            {
              productName: "Milk",
              quantity: 1,
              addedAt: new Date().toISOString(),
              expiresAt: soon,
            },
            {
              productName: "Rice",
              quantity: 2,
              addedAt: new Date().toISOString(),
            },
            {
              productName: "Yogurt",
              quantity: 1,
              addedAt: new Date().toISOString(),
              expiresAt: new Date(
                Date.now() - 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          ],
        } as unknown as ShoppingStore["pantry"],
        equipment: {
          getAll: async () => [
            { equipmentName: "Dutch oven", category: "Cooking", addedAt: "" },
          ],
        } as unknown as ShoppingStore["equipment"],
        orderHistory: {
          getRecent: async () => [
            {
              orderId: "o1",
              items: [
                { upc: "0000000000001", productName: "Milk", quantity: 1 },
              ],
              totalItems: 1,
              placedAt: new Date().toISOString(),
            },
          ],
        } as unknown as ShoppingStore["orderHistory"],
      });
      registerInventoryTools(makeContext(storage));

      const result = await getCapturedHandler("get_shopping_profile")({});

      const text = result.text;
      expect(text).toContain("QFC Broadway");
      expect(text).toMatch(/Milk x1 \(expires .+, use soon\)/);
      expect(text).toContain("Rice x2");
      expect(text).toMatch(/Yogurt x1 \(expired .+\)/);
      // Soonest expiry first; undated items last.
      expect(text.indexOf("Yogurt")).toBeLessThan(text.indexOf("Milk x1"));
      expect(text.indexOf("Milk x1")).toBeLessThan(text.indexOf("Rice"));
      expect(result).toMatchObject({
        structuredContent: {
          pantry: [
            { name: "Yogurt", expiry: "expired" },
            { name: "Milk", expiry: "soon" },
            { name: "Rice", quantity: 2, expiry: "none" },
          ],
        },
      });
      expect(text).toContain("Dutch oven (Cooking)");
      expect(text).toContain("milk (ordered 1x)");
    });

    it("is a read-only, idempotent tool with no app view", () => {
      registerInventoryTools(makeContext());

      const tool = getCapturedTool("get_shopping_profile");
      expect(
        (tool.config as { annotations?: { readOnlyHint?: boolean } })
          .annotations?.readOnlyHint,
      ).toBe(true);
      expect(
        (tool.config as { annotations?: { idempotentHint?: boolean } })
          .annotations?.idempotentHint,
      ).toBe(true);
      expect(
        (tool.config as { _meta?: { ui?: unknown } })._meta?.ui,
      ).toBeUndefined();
    });
  });
});
