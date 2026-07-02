/**
 * Eval: golden-path machine-extractability ("scripted small model").
 *
 * A deterministic agent that can only read `content[0].text` (never
 * structuredContent) walks the documented golden paths, extracting every
 * hand-off id (storeId, upc, listId) with the trivial regexes a small model
 * effectively relies on. If a format change breaks extraction, or a path
 * needs more calls than budgeted, the eval fails — before a real small model
 * ever does.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
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

  async function call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    toolCalls++;
    const result = (await client.callTool({ name, arguments: args })) as ToolCallResult;
    expect(result.isError, `${name} failed: ${contentText(result)}`).toBeFalsy();
    return result;
  }

  it("cold start: find store → save it → shop_for_items → add to cart, in 4 calls", async () => {
    // 1. The agent only knows the user's zip code.
    const stores = await call("search_stores", { zipCodeNear: "98105" });
    const storeIds = extractStoreIds(contentText(stores));
    expect(storeIds.length).toBeGreaterThan(0);

    // 2. Save the first store as preferred.
    await call("set_preferred_store", { storeId: storeIds[0] });

    // 3. One-shot shop. The listId must be extractable from text alone.
    const shop = await call("shop_for_items", {
      items: [{ name: "milk" }, { name: "eggs", quantity: 2 }],
    });
    const shopText = contentText(shop);
    const listIds = extractListIds(shopText);
    expect(listIds, `no extractable listId in:\n${shopText}`).toHaveLength(1);
    // The text must name the follow-up tool so the model knows the next step.
    expect(shopText).toContain("add_shopping_list_to_cart");

    // 4. Hand the listId straight back.
    const added = await call("add_shopping_list_to_cart", { listId: listIds[0] });
    expect(contentText(added)).toContain("Added");

    // The Kroger cart received one item per requested product, quantities intact.
    const items = stub.allCartItems();
    expect(items).toHaveLength(2);
    expect(upcsForTerm("milk")).toContain(items[0].upc);
    expect(upcsForTerm("eggs")).toContain(items[1].upc);
    expect(items[1].quantity).toBe(2);

    // Whole flow fits the documented 4-call budget.
    expect(toolCalls).toBe(4);
  });

  it("manual path: search_products → create_shopping_list → add to cart, with exact upc handoff", async () => {
    await call("set_preferred_store", { storeId: "70500847" });

    const search = await call("search_products", { terms: ["bread"] });
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
    const shop = await call("shop_for_items", { items: [{ name: "butter" }] });
    const [listId] = extractListIds(contentText(shop));

    await call("add_shopping_list_to_cart", { listId });
    expect(stub.cartPuts).toHaveLength(1);

    // A small model retrying the same call must not duplicate the cart items,
    // and the response must explain what happened.
    const retry = await call("add_shopping_list_to_cart", { listId });
    expect(stub.cartPuts).toHaveLength(1);
    expect(contentText(retry)).toContain("already added");
  });

  it("returning user one-shot: shop_for_items with addToCart lands the cart in 1 call", async () => {
    // Seeding the preferred store models a returning user's earlier session
    // and doesn't count against the 1-call budget of the shopping action
    // itself, so it's reset here before the timed call.
    await call("set_preferred_store", { storeId: "70500847" });
    toolCalls = 0;

    const shop = await call("shop_for_items", { items: [{ name: "milk" }], addToCart: true });
    const shopText = contentText(shop);
    const listIds = extractListIds(shopText);
    expect(listIds, `no extractable listId in:\n${shopText}`).toHaveLength(1);
    expect(shopText).toContain("Added");
    expect(shopText).not.toContain("Review these matches");

    // A single shop_for_items call landed the cart for a returning user.
    expect(toolCalls).toBe(1);

    const items = stub.allCartItems();
    expect(items).toHaveLength(1);
    expect(upcsForTerm("milk")).toContain(items[0].upc);

    // The addToCart path persists a cart snapshot under the same storage key
    // add_shopping_list_to_cart checks, so a follow-up call with this listId
    // must not double-add.
    const retry = await call("add_shopping_list_to_cart", { listId: listIds[0] });
    expect(stub.cartPuts).toHaveLength(1);
    expect(contentText(retry)).toContain("already added");
  });

  it("view_cart shows items added through this assistant, with name and upc", async () => {
    await call("set_preferred_store", { storeId: "70500847" });
    const shop = await call("shop_for_items", { items: [{ name: "eggs" }], addToCart: true });
    expect(extractListIds(contentText(shop))).toHaveLength(1);

    const viewed = await call("view_cart", {});
    const text = contentText(viewed);
    const upcs = extractUpcs(text);

    expect(upcs.length).toBeGreaterThan(0);
    expect(upcsForTerm("eggs")).toContain(upcs[0]);
    expect(text).toContain("in-store/app changes are not shown");
  });

  it("no-results terms are reported per term without failing the whole search", async () => {
    await call("set_preferred_store", { storeId: "70500847" });
    const result = await call("search_products", { terms: ["milk", "zzz-unfindable"] });
    const text = contentText(result);

    expect(extractUpcs(text).length).toBeGreaterThan(0);
    expect(text).toContain("No results");
  });
});
