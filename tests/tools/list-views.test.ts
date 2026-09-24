/**
 * Covers the app-backed list surface: list tools return the editable list
 * view, lists can be found by name, prices produce an estimated total, and
 * pantry items can be partly used up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseAppResult as parseAppPayload } from "../../src/app-results.js";

/** Test results carry an untyped `_meta`; parse it as the host would. */
function parseAppResult(result: unknown) {
  return parseAppPayload(result as Parameters<typeof parseAppPayload>[0]);
}
import { registerInventoryTools } from "../../src/tools/inventory.js";
import {
  matchListsByName,
  registerShoppingListTools,
} from "../../src/tools/shopping-list.js";
import { estimateListTotal } from "../../src/domain/list-total.js";
import { formatListSize } from "../../src/utils/format-response.js";
import {
  getCapturedHandler,
  makeContext,
  makeStorage,
  resetToolTestHarness,
} from "./tool-test-harness.js";

vi.mock("agents/mcp/server", () => ({
  getMcpAuthContext: () => ({
    props: {
      id: "user-123",
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 60_000,
    },
  }),
}));

function setup() {
  const fixture = makeContext(makeStorage());
  registerShoppingListTools(fixture.server, fixture);
  registerInventoryTools(fixture.server, fixture);
  return fixture;
}

async function createList(name: string, items: Record<string, unknown>[]) {
  const result = await getCapturedHandler("create_shopping_list")({
    name,
    items,
  });
  const data = parseAppResult(result);
  if (data?.view !== "create_shopping_list") throw new Error("no list view");
  return data;
}

describe("list totals", () => {
  it("multiplies unit price by quantity and skips unpriced items", () => {
    const items = [
      { productName: "Milk", quantity: 2, price: 3.49 },
      { productName: "Herbs", quantity: 1 },
    ];
    expect(estimateListTotal(items)).toEqual({ total: 6.98, pricedCount: 1 });
    expect(formatListSize(items)).toBe("2 item(s), ~$6.98 est., 1 priced");
    expect(formatListSize([{ productName: "Herbs", quantity: 1 }])).toBe(
      "1 item(s)",
    );
  });
});

describe("list name matching", () => {
  const lists = [
    { id: "a", name: "Tuesday dinner", itemCount: 1, updatedAt: "2" },
    { id: "b", name: "tuesday", itemCount: 1, updatedAt: "1" },
    { id: "c", name: "Weekend brunch", itemCount: 1, updatedAt: "0" },
  ];

  it("prefers an exact case-insensitive name over partial matches", () => {
    expect(matchListsByName(lists, "Tuesday").map((list) => list.id)).toEqual([
      "b",
    ]);
  });

  it("falls back to names that contain the query", () => {
    expect(matchListsByName(lists, "brunch").map((list) => list.id)).toEqual([
      "c",
    ]);
  });
});

describe("app-backed shopping list tools", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("stores prices and reports an estimated total on create", async () => {
    setup();
    const result = await getCapturedHandler("create_shopping_list")({
      name: "Dinner",
      items: [
        { upc: "0001111041700", productName: "Milk", quantity: 2, price: 3.5 },
      ],
    });

    expect(result.text).toContain("1 item(s), ~$7.00 est.");
    expect(parseAppResult(result)).toMatchObject({
      view: "create_shopping_list",
      items: [{ productName: "Milk", price: 3.5 }],
    });
  });

  it("returns the lists index view when called with no arguments", async () => {
    setup();
    await createList("Dinner", [{ productName: "Rice" }]);

    const result = await getCapturedHandler("get_shopping_list")({});

    expect(parseAppResult(result)).toMatchObject({
      view: "shopping_lists",
      lists: [{ name: "Dinner", itemCount: 1 }],
    });
  });

  it("opens a list by name", async () => {
    setup();
    const created = await createList("Tuesday dinner", [
      { productName: "Rice" },
    ]);

    const result = await getCapturedHandler("get_shopping_list")({
      name: "tuesday DINNER",
    });

    expect(result.isError).toBe(false);
    expect(parseAppResult(result)).toMatchObject({
      view: "create_shopping_list",
      listId: created.listId,
    });
  });

  it("asks which list when a partial name matches several", async () => {
    setup();
    await createList("Tuesday dinner", [{ productName: "Rice" }]);
    await createList("Tuesday lunch", [{ productName: "Bread" }]);

    const result = await getCapturedHandler("get_shopping_list")({
      name: "tuesday",
    });

    expect(result.text).toContain("2 lists match");
    expect(parseAppResult(result)).toMatchObject({ view: "shopping_lists" });
  });

  it("reports a missing name as not found", async () => {
    setup();
    const result = await getCapturedHandler("get_shopping_list")({
      name: "nothing",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('No list named "nothing"');
  });

  it("returns the whole updated list after adding items", async () => {
    setup();
    const created = await createList("Dinner", [{ productName: "Rice" }]);

    const result = await getCapturedHandler("add_shopping_list_items")({
      listId: created.listId,
      items: [{ productName: "Beans", quantity: 2 }],
    });

    expect(result.text).toContain("List now has 2 item(s)");
    const data = parseAppResult(result);
    expect(data).toMatchObject({ view: "create_shopping_list" });
    expect(
      data?.view === "create_shopping_list" &&
        data.items.map((item) => item.productName),
    ).toEqual(["Rice", "Beans"]);
  });

  it("returns the updated list after checking off and removing items", async () => {
    setup();
    const created = await createList("Dinner", [
      { productName: "Rice" },
      { productName: "Beans" },
    ]);
    const [rice, beans] = created.items;

    const checked = await getCapturedHandler("edit_shopping_list_item")({
      listId: created.listId,
      itemId: rice.id,
      checked: true,
    });
    expect(parseAppResult(checked)).toMatchObject({
      items: [{ productName: "Rice", checked: true }, { checked: false }],
    });

    const removed = await getCapturedHandler("edit_shopping_list_item")({
      listId: created.listId,
      itemId: beans.id,
      remove: true,
    });
    expect(removed.text).toContain(`Removed itemId=${beans.id}`);
    expect(parseAppResult(removed)).toMatchObject({
      items: [{ productName: "Rice" }],
    });
  });
});

describe("pantry quantity use", () => {
  beforeEach(() => {
    resetToolTestHarness();
  });

  it("subtracts a used quantity and removes the item once it runs out", async () => {
    const fixture = setup();
    await fixture.storage.pantry.add([
      { productName: "Eggs", quantity: 3, addedAt: "2026-09-01" },
      { productName: "Milk", quantity: 1, addedAt: "2026-09-01" },
    ]);

    const result = await getCapturedHandler("remove_from_inventory")({
      inventory: "pantry",
      items: [
        { name: "Eggs", quantity: 1 },
        { name: "Milk", quantity: 1 },
      ],
    });

    expect(result.isError).toBe(false);
    expect(parseAppResult(result)).toMatchObject({
      view: "pantry",
      items: [{ productName: "Eggs", quantity: 2 }],
    });
  });
});
