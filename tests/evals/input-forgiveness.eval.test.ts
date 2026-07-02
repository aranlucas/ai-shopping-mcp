/**
 * Eval: input forgiveness (the small-model mistake matrix).
 *
 * Small models produce sloppy-but-recoverable inputs: unpadded UPCs, string
 * numbers, lowercase enums, stray whitespace, extra keys. The schemas promise
 * to normalize these rather than reject them (src/tools/schemas.ts). Each case
 * here is a mistake observed from small models; the eval asserts either
 * acceptance-after-normalization or an error message that names the fix.
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

describe("input forgiveness", () => {
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

  /** callTool never throws here — schema failures come back as isError results. */
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

  describe("normalized (must succeed)", () => {
    it("accepts an unpadded UPC and pads it to 13 digits", async () => {
      const result = await call("get_product", { upc: "1111041700" });
      expect(result.isError, contentText(result)).toBeFalsy();
      expect(contentText(result)).toContain("0001111041700");
    });

    it("accepts a UPC with surrounding whitespace", async () => {
      const result = await call("get_product", { upc: " 0001111041700 " });
      expect(result.isError, contentText(result)).toBeFalsy();
    });

    it("accepts record_order items keyed by upc", async () => {
      const result = await call("record_order", {
        items: [{ upc: "0001111041700", productName: "Milk", quantity: 1 }],
      });
      expect(result.isError, contentText(result)).toBeFalsy();
    });

    it("rejects record_order items keyed by productId instead of upc", async () => {
      const result = await call("record_order", {
        items: [{ productId: "0001111041700", productName: "Milk", quantity: 1 }],
      });
      expect(result.isError, contentText(result)).toBeTruthy();
    });

    it("accepts a storeId with surrounding whitespace", async () => {
      const result = await call("set_preferred_store", { storeId: " 70500847 " });
      expect(result.isError, contentText(result)).toBeFalsy();
    });

    it("accepts lowercase modality and quantities as strings, padding inline UPCs", async () => {
      await call("set_preferred_store", { storeId: "70500847" });
      const result = await call("add_shopping_list_to_cart", {
        items: [{ upc: "1111041700", quantity: "2" }],
        modality: "pickup",
      });
      expect(result.isError, contentText(result)).toBeFalsy();

      const items = stub.allCartItems();
      expect(items).toHaveLength(1);
      expect(items[0].upc).toBe("0001111041700");
      expect(items[0].quantity).toBe(2);
      expect(items[0].modality).toBe("PICKUP");
    });

    it("accepts limitPerTerm as a string", async () => {
      const result = await call("search_products", { terms: ["milk"], limitPerTerm: "3" });
      expect(result.isError, contentText(result)).toBeFalsy();
    });

    it("ignores unknown extra keys instead of rejecting the call", async () => {
      const result = await call("search_products", {
        terms: ["milk"],
        reasoning: "the user asked for milk",
      });
      expect(result.isError, contentText(result)).toBeFalsy();
    });
  });

  describe("rejected (error must name the fix)", () => {
    it("rejects a non-numeric UPC with instructions to copy it from search_products", async () => {
      const result = await call("get_product", { upc: "not-a-upc" });
      expect(result.isError).toBe(true);
      expect(contentText(result)).toContain("search_products");
    });

    it("rejects get_product with productId instead of upc", async () => {
      const result = await call("get_product", { productId: "1111041700" });
      expect(result.isError).toBe(true);
    });

    it("rejects get_product without upc", async () => {
      const result = await call("get_product", { storeId: "70500847" });
      expect(result.isError).toBe(true);
    });

    it("rejects a wrong-length storeId pointing at search_stores", async () => {
      const result = await call("get_store", { storeId: "123" });
      expect(result.isError).toBe(true);
      expect(contentText(result)).toContain("search_stores");
    });

    it("rejects listId+items together with a message naming both options", async () => {
      const result = await call("add_shopping_list_to_cart", {
        listId: "list_a1b2c3d8",
        items: [{ upc: "0001111041700" }],
      });
      expect(result.isError).toBe(true);
      const text = contentText(result);
      expect(text).toContain("listId");
      expect(text).toContain("items");
    });

    it("rejects an empty shopping list with an actionable message", async () => {
      const result = await call("create_shopping_list", { name: "Empty", items: [] });
      expect(result.isError).toBe(true);
      expect(contentText(result)).toContain("at least one item");
    });

    it("rejects more than 10 search terms with the limit in the message", async () => {
      const result = await call("search_products", {
        terms: Array.from({ length: 11 }, (_, index) => `term-${index}`),
      });
      expect(result.isError).toBe(true);
      expect(contentText(result)).toContain("10");
    });
  });
});
