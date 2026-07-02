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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
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

const logEnabled = () => Boolean((env as unknown as Record<string, string | undefined>).EVAL_LOG);

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

  it("keeps the serialized tool list within the small-model budget", async () => {
    const { tools } = await client.listTools();

    const perTool = tools
      .map((tool) => ({ name: tool.name, tokens: estimateJsonTokens(tool) }))
      .sort((a, b) => b.tokens - a.tokens);
    const total = perTool.reduce((sum, entry) => sum + entry.tokens, 0);

    log("tool surface tokens:", total);
    for (const entry of perTool) log(`  ${entry.name}: ${entry.tokens}`);

    // Whole tool list: what every request to the host model carries.
    // Baseline 2026-07 (Phase 1, #1-2): 3455 estimated tokens across 14 tools.
    // Updated 2026-07 (Phase 2, #3-4): 3637 estimated tokens across 15 tools —
    // +134t for the new read-only view_cart tool and +~12t for shop_for_items'
    // addToCart field. Still comfortably under the cap, so the budget itself
    // is unchanged; see small-model-efficiency-plan.md Phase 2 items 3-4.
    expect(total).toBeLessThan(4200);

    // No single tool may dominate the surface. Baseline max: 311
    // (add_shopping_list_to_cart).
    for (const entry of perTool) {
      expect(entry.tokens, `tool ${entry.name} definition too large`).toBeLessThan(400);
    }
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

  async function call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    return (await client.callTool({ name, arguments: args })) as ToolCallResult;
  }

  function report(name: string, result: ToolCallResult) {
    const text = contentText(result);
    const textTokens = estimateTokens(text);
    const structuredTokens = result.structuredContent
      ? estimateJsonTokens(result.structuredContent)
      : 0;
    log(`${name}: content=${textTokens}t structuredContent=${structuredTokens}t`);
    return { textTokens, structuredTokens };
  }

  it("search_products (5 terms) stays within content budget", async () => {
    const result = await call("search_products", {
      terms: ["milk", "eggs", "bread", "butter", "cheese"],
      storeId: DEFAULT_STORE_ID,
    });
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07: content=291t, structuredContent=4658t.
    const { textTokens, structuredTokens } = report("search_products x5", result);
    expect(textTokens).toBeLessThan(600);

    // structuredContent is the MCP Apps view payload, not model-facing: the
    // consuming hosts strip it from model context (see
    // docs/small-model-efficiency-plan.md). This cap is only a growth guard
    // so the view payload doesn't balloon unnoticed.
    expect(structuredTokens).toBeLessThan(8000);
  });

  it("search_stores stays within content budget", async () => {
    const result = await call("search_stores", { zipCodeNear: "98105" });
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07: 74t.
    const { textTokens } = report("search_stores", result);
    expect(textTokens).toBeLessThan(150);
  });

  it("get_product stays within content budget", async () => {
    const result = await call("get_product", {
      upc: "0001111041700",
      storeId: DEFAULT_STORE_ID,
    });
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07: 40t.
    const { textTokens } = report("get_product", result);
    expect(textTokens).toBeLessThan(100);
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
    await call("add_to_inventory", {
      inventory: "pantry",
      items: [
        { name: "Rice", quantity: 2 },
        { name: "Black beans", quantity: 4 },
        { name: "Olive oil" },
      ],
    });
    await call("add_to_inventory", {
      inventory: "equipment",
      items: [{ name: "Dutch oven", category: "Cooking" }],
    });

    const result = await call("get_shopping_profile", {});
    expect(result.isError).toBeFalsy();

    // Baseline 2026-07: 61t.
    const { textTokens } = report("get_shopping_profile", result);
    expect(textTokens).toBeLessThan(150);
  });
});
