/**
 * Eval: token budgets for the model-facing surface.
 *
 * Small-context models pay for every token twice — once in the tool list on
 * every request, and once per tool result. This suite measures the real wire
 * payloads (serialized tools/list, server instructions, and representative
 * tool responses) and fails when they regress past calibrated budgets.
 *
 * Budgets are calibrated to the estimateTokens() heuristic (~4 chars/token)
 * at roughly 1.25x the measured baseline. When a legitimate change moves a
 * number, re-run with EVAL_LOG=1 (`EVAL_LOG=1 pnpm eval:mcp`) and recalibrate
 * deliberately — do not bump budgets to make CI green without looking.
 */
import type { Client } from "@modelcontextprotocol/client";
import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type KrogerFetchStub,
  type ToolCallResult,
  DEFAULT_STORE_ID,
  contentText,
  createEvalMcpClient,
  estimateJsonTokens,
  estimateTokens,
  installKrogerFetchStub,
} from "./harness.js";

const logEnabled = () =>
  Boolean((env as unknown as Record<string, string | undefined>).EVAL_LOG);

function log(...parts: unknown[]) {
  if (logEnabled()) console.log("[eval]", ...parts);
}

describe("token budget: tool surface", () => {
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

  it("keeps server instructions compact and aligned with the golden path", async () => {
    const instructions = client.getInstructions() ?? "";
    const tokens = estimateTokens(instructions);
    log("instructions tokens:", tokens);

    // Baseline 2026-07: 187 estimated tokens.
    expect(tokens).toBeLessThan(250);
    // The golden path must be spelled out for hosts that surface instructions.
    expect(instructions).toContain("shop_for_items");
    expect(instructions).toContain("add_shopping_list_to_cart");
  });

  it("keeps tool descriptions within a per-description cap", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const tokens = estimateTokens(tool.description ?? "");
      expect(tokens, `description of ${tool.name}`).toBeLessThan(120);
    }
  });
});

function report(name: string, result: ToolCallResult) {
  const text = contentText(result);
  const textTokens = estimateTokens(text);
  const structuredTokens = result.structuredContent
    ? estimateJsonTokens(result.structuredContent)
    : 0;
  log(`${name}: content=${textTokens}t structuredContent=${structuredTokens}t`);
  return { textTokens, structuredTokens };
}

describe("token budget: tool responses", () => {
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

  async function call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    return (await client.callTool({ name, arguments: args })) as ToolCallResult;
  }

  it("search_products (5 terms) stays within content budget", async () => {
    const result = await call("search_products", {
      terms: ["milk", "eggs", "bread", "butter", "cheese"],
      storeId: DEFAULT_STORE_ID,
    });
    expect(result.isError).toBeFalsy();

    // Baseline before compact projection: content=291t, structuredContent=4658t.
    const { textTokens, structuredTokens } = report(
      "search_products x5",
      result,
    );
    expect(textTokens).toBeLessThan(600);

    // Some hosts expose structuredContent to the model, so this is a real
    // small-context budget as well as an MCP Apps payload growth guard.
    expect(structuredTokens).toBeLessThan(2000);
  });

  it("search_stores stays within content budget", async () => {
    const result = await call("search_stores", { zipCode: "98105" });
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07: 74t.
    const { textTokens, structuredTokens } = report("search_stores", result);
    expect(textTokens).toBeLessThan(150);
    expect(structuredTokens).toBeLessThan(500);
  });

  it("search_products UPC lookup stays within content budget", async () => {
    const result = await call("search_products", {
      terms: ["0001111041700"],
      storeId: DEFAULT_STORE_ID,
    });
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07 (as get_product): 40t.
    const { textTokens, structuredTokens } = report("upc lookup", result);
    expect(textTokens).toBeLessThan(100);
    expect(structuredTokens).toBeLessThan(500);
  });

  it("shop_for_items stays within content budget", async () => {
    await call("set_preferred_store", { storeId: DEFAULT_STORE_ID });
    const result = await call("shop_for_items", {
      items: [{ name: "milk" }, { name: "eggs", quantity: 2 }],
    });
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07: 102t.
    const { textTokens } = report("shop_for_items", result);
    expect(textTokens).toBeLessThan(200);
  });

  it("get_shopping_profile stays within content budget with populated data", async () => {
    await call("set_preferred_store", { storeId: DEFAULT_STORE_ID });
    await call("update_inventory", {
      pantry: {
        add: [
          { name: "Rice", quantity: 2 },
          { name: "Black beans", quantity: 4 },
          { name: "Olive oil" },
        ],
      },
      equipment: { add: [{ name: "Dutch oven", category: "Cooking" }] },
    });

    const result = await call("get_shopping_profile", {});
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07 (Phase 1): 61t. Updated 2026-07 (Phase 3, #7): 72t —
    // +11t for the new "Due to restock" section (empty here, since this
    // scenario has no order history); cap unchanged, still comfortably under
    // it. See small-model-efficiency-plan.md Phase 3 item 7. The 2026-09
    // consolidation folded meal-planning context in; text cap unchanged.
    const { textTokens } = report("get_shopping_profile", result);
    expect(textTokens).toBeLessThan(150);
  });
});
