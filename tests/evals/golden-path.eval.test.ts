import type { ToolArguments } from "../v2-tool-handler.js";
/**
 * Eval: golden-path machine-extractability ("scripted small model").
 *
 * A deterministic agent that can only read `content[0].text` (never
 * structuredContent) walks the documented golden paths, extracting every
 * hand-off id (storeId, UPC, listId) with trivial regexes a small model
 * effectively relies on. If a format change breaks extraction, or a path
 * needs more calls than budgeted, the eval fails — before a real small model
 * ever does.
 */
import type { Client } from "@modelcontextprotocol/client";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type KrogerFetchStub,
  type ToolCallResult,
  contentText,
  createEvalMcpClient,
  extractListIds,
  extractStoreIds,
  extractUpcs,
  installKrogerFetchStub,
  upcsForTerm,
} from "./harness.js";

describe("golden path (scripted agent, text-only)", () => {
  let stub: KrogerFetchStub;
  let client: Client;
  let toolCalls: number;

  beforeEach(async () => {
    stub = installKrogerFetchStub();
    client = await createEvalMcpClient();
    toolCalls = 0;
  });

  afterEach(async () => {
    stub.restore();
    await reset();
  });

  async function call(
    name: string,
    args: ToolArguments,
  ): Promise<ToolCallResult> {
    toolCalls++;

    const result = await client.callTool({
      name,
      arguments: args,
    });

    expect(
      result.isError,
      `${name} failed: ${contentText(result)}`,
    ).toBeFalsy();

    return result;
  }

  async function chooseAndCreate(
    items: Array<{ name: string; quantity?: number }>,
  ) {
    const shop = await call("shop_for_items", { items });
    const text = contentText(shop);
    expect(text).toContain("create_shopping_list");
    expect(extractListIds(text)).toHaveLength(0);
    expect(stub.cartPuts).toHaveLength(0);
    const groups = text.split(/item_\d+: requested qty=/).slice(1);

    const chosen = items.map((item, index) => {
      const [upc] = extractUpcs(groups[index]);
      expect(upc).toBeDefined();

      return { upc, quantity: item.quantity ?? 1 };
    });

    return call("create_shopping_list", {
      name: "Chosen groceries",
      items: chosen,
    });
  }

  it("cold start: find store → save it → options → choose/list → cart, in 5 calls", async () => {
    const stores = await call("search_stores", { zipCode: "98105" });
    const storeIds = extractStoreIds(contentText(stores));
    expect(storeIds.length).toBeGreaterThan(0);
    await call("set_preferred_store", { storeId: storeIds[0] });

    const created = await chooseAndCreate([
      { name: "milk" },
      { name: "eggs", quantity: 2 },
    ]);

    const listIds = extractListIds(contentText(created));
    expect(listIds).toHaveLength(1);

    const added = await call("add_shopping_list_to_cart", {
      listId: listIds[0],
    });

    expect(contentText(added)).toContain("Added");
    const items = stub.allCartItems();
    expect(items).toHaveLength(2);
    expect(upcsForTerm("milk")).toContain(items[0].upc);
    expect(upcsForTerm("eggs")).toContain(items[1].upc);
    expect(items[1].quantity).toBe(2);
    expect(toolCalls).toBe(5);
  });

  it("manual path: search_products → create_shopping_list → add to cart, with exact UPC handoff", async () => {
    await call("set_preferred_store", { storeId: "70500847" });

    const search = await call("search_products", {
      terms: ["bread"],
    });

    const searchText = contentText(search);
    const upcs = extractUpcs(searchText);
    expect(upcs.length).toBeGreaterThan(0);
    // Text must point the model at the next tool.
    expect(searchText).toContain("create_shopping_list");

    const created = await call("create_shopping_list", {
      name: "Bread run",
      items: [{ upc: upcs[0], quantity: 1 }],
    });

    const listIds = extractListIds(contentText(created));
    expect(listIds).toHaveLength(1);

    await call("add_shopping_list_to_cart", { listId: listIds[0] });

    const items = stub.allCartItems();
    expect(items).toHaveLength(1);
    expect(items[0].upc).toBe(upcs[0]);
  });

  it("retrying add_shopping_list_to_cart with the same listId does not double-add", async () => {
    await call("set_preferred_store", { storeId: "70500847" });
    const shop = await chooseAndCreate([{ name: "butter" }]);
    const [listId] = extractListIds(contentText(shop));

    await call("add_shopping_list_to_cart", { listId });
    expect(stub.cartPuts).toHaveLength(1);

    // A small model retrying the same call must not duplicate the cart items,
    // and the response must explain what happened.
    const retry = await call("add_shopping_list_to_cart", { listId });
    expect(stub.cartPuts).toHaveLength(1);
    expect(contentText(retry)).toContain("already added");
  });

  it("returning user chooses options, saves a list, then adds to cart in 3 calls", async () => {
    await call("set_preferred_store", { storeId: "70500847" });
    toolCalls = 0;
    const created = await chooseAndCreate([{ name: "milk" }]);
    const [listId] = extractListIds(contentText(created));
    expect(listId).toBeDefined();
    await call("add_shopping_list_to_cart", { listId });
    expect(toolCalls).toBe(3);
    const items = stub.allCartItems();
    expect(items).toHaveLength(1);
    expect(upcsForTerm("milk")).toContain(items[0].upc);
    const retry = await call("add_shopping_list_to_cart", { listId });
    expect(stub.cartPuts).toHaveLength(1);
    expect(contentText(retry)).toContain("already added");
  });

  it("view_cart shows items added through this assistant, with name and upc", async () => {
    await call("set_preferred_store", { storeId: "70500847" });
    const created = await chooseAndCreate([{ name: "eggs" }]);
    const [listId] = extractListIds(contentText(created));
    await call("add_shopping_list_to_cart", { listId });

    const viewed = await call("view_cart", {});
    const text = contentText(viewed);
    const upcs = extractUpcs(text);

    expect(upcs.length).toBeGreaterThan(0);
    expect(upcsForTerm("eggs")).toContain(upcs[0]);
    expect(text).toContain("in-store/app changes are not shown");
  });

  it("no-results terms are reported per term without failing the whole search", async () => {
    await call("set_preferred_store", { storeId: "70500847" });

    const result = await call("search_products", {
      terms: ["milk", "zzz-unfindable"],
    });

    const text = contentText(result);

    expect(extractUpcs(text).length).toBeGreaterThan(0);
    expect(text).toContain("No Kroger results");
  });
});
