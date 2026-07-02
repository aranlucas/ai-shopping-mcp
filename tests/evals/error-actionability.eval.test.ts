/**
 * Eval: error actionability.
 *
 * A small model cannot debug; it can only follow instructions. Every error a
 * tool returns must therefore name the concrete next tool call that fixes the
 * situation. Each case asserts the recovery tool appears verbatim in the
 * error text — and that following that advice actually works.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type KrogerFetchStub,
  type ToolCallResult,
  contentText,
  createEvalMcpClient,
  installKrogerFetchStub,
} from "./harness.js";

describe("error actionability", () => {
  let stub: KrogerFetchStub;
  let client: Client;

  beforeEach(async () => {
    stub = installKrogerFetchStub();
    client = await createEvalMcpClient();
  });

  afterEach(async () => {
    stub.restore();
    await reset();
  });

  async function call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    try {
      return (await client.callTool({ name, arguments: args })) as ToolCallResult;
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  }

  it("shop_for_items without a preferred store names the two-step fix", async () => {
    const result = await call("shop_for_items", { items: [{ name: "milk" }] });
    expect(result.isError).toBe(true);
    const text = contentText(result);
    expect(text).toContain("search_stores");
    expect(text).toContain("set_preferred_store");
  });

  it("get_weekly_deals without any store names the fix without touching the network", async () => {
    const result = await call("get_weekly_deals", {});
    expect(result.isError).toBe(true);
    const text = contentText(result);
    expect(text).toContain("search_stores");
    expect(text).toContain("set_preferred_store");
  });

  it("add_shopping_list_to_cart with an unknown listId points at create_shopping_list", async () => {
    await call("set_preferred_store", { storeId: "70500847" });
    const result = await call("add_shopping_list_to_cart", { listId: "list_00000000" });
    expect(result.isError).toBe(true);
    expect(contentText(result)).toContain("create_shopping_list");
  });

  it("shop_for_items with only unfindable items points at search_products", async () => {
    await call("set_preferred_store", { storeId: "70500847" });
    const result = await call("shop_for_items", { items: [{ name: "zzz-unfindable" }] });
    expect(result.isError).toBe(true);
    expect(contentText(result)).toContain("search_products");
  });

  it("get_meal_planning_context with an empty pantry names add_to_inventory with an example", async () => {
    const result = await call("get_meal_planning_context", {});
    // Empty pantry is guidance, not a hard error — but it must name the fix.
    expect(contentText(result)).toContain("add_to_inventory");
  });

  it("the advertised recovery path actually recovers", async () => {
    // Fail first…
    const failed = await call("shop_for_items", { items: [{ name: "milk" }] });
    expect(failed.isError).toBe(true);

    // …then follow the error's own instructions to the letter.
    const stores = await call("search_stores", { zipCodeNear: "98105" });
    expect(stores.isError).toBeFalsy();
    const storeId = contentText(stores).match(/storeId=([A-Za-z0-9]{8})/)?.[1];
    expect(storeId).toBeDefined();

    const saved = await call("set_preferred_store", { storeId: storeId as string });
    expect(saved.isError).toBeFalsy();

    const retried = await call("shop_for_items", { items: [{ name: "milk" }] });
    expect(retried.isError, contentText(retried)).toBeFalsy();
  });
});
