/**
 * Eval: live small-model agent runs (opt-in).
 *
 * Runs the scenarios in scenarios.ts with a real small model
 * (claude-haiku-4-5 by default — the class of model this server is tuned
 * for) driving the real MCP server over the wire. Kroger stays fixture-backed;
 * only api.anthropic.com is reached.
 *
 * Skipped unless ANTHROPIC_API_KEY is set:
 *   ANTHROPIC_API_KEY=sk-... pnpm eval:mcp
 * Override the model under test with EVAL_MODEL (e.g. EVAL_MODEL=claude-sonnet-5).
 *
 * Metrics per scenario: task success (fixture cart contents), tool-call count
 * vs budget, schema-rejection count (isError results), and token usage.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type KrogerFetchStub,
  type ToolCallResult,
  contentText,
  createEvalMcpClient,
  installKrogerFetchStub,
} from "./harness.js";
import { SCENARIOS } from "./scenarios.js";

const evalEnv = env as unknown as Record<string, string | undefined>;
const apiKey = evalEnv.ANTHROPIC_API_KEY;
const model = evalEnv.EVAL_MODEL ?? "claude-haiku-4-5";

const MAX_AGENT_TURNS = 12;

type RunStats = {
  toolCalls: number;
  schemaRejections: number;
  inputTokens: number;
  outputTokens: number;
};

describe.skipIf(!apiKey)(`live small-model eval (${model})`, () => {
  let stub: KrogerFetchStub;
  let client: Client;

  beforeEach(async () => {
    stub = installKrogerFetchStub(["api.anthropic.com"]);
    client = await createEvalMcpClient();
  });

  afterEach(async () => {
    stub.restore();
    await reset();
  });

  /** Minimal manual agentic loop: model ↔ real MCP tools until end_turn. */
  async function runAgent(userTask: string): Promise<RunStats> {
    const anthropic = new Anthropic({ apiKey, fetch: stub.realFetch });

    const { tools: mcpTools } = await client.listTools();
    const tools: Anthropic.Tool[] = mcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const stats: RunStats = {
      toolCalls: 0,
      schemaRejections: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userTask }];

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        system: client.getInstructions() ?? "",
        tools,
        messages,
      });
      stats.inputTokens += response.usage.input_tokens;
      stats.outputTokens += response.usage.output_tokens;

      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        stats.toolCalls++;

        let result: ToolCallResult;
        try {
          result = (await client.callTool({
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          })) as ToolCallResult;
        } catch (error) {
          result = {
            isError: true,
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
        if (result.isError) stats.schemaRejections++;

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: contentText(result),
          is_error: result.isError ? true : undefined,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return stats;
  }

  for (const scenario of SCENARIOS) {
    it(
      scenario.name,
      async () => {
        if (scenario.seedPreferredStoreId) {
          const seeded = (await client.callTool({
            name: "set_preferred_store",
            arguments: { storeId: scenario.seedPreferredStoreId },
          })) as ToolCallResult;
          expect(seeded.isError).toBeFalsy();
          stub.cartPuts.length = 0;
        }

        const stats = await runAgent(scenario.userTask);
        const cartUpcs = stub.allCartItems().map((item) => item.upc);

        console.log(
          `[live-eval] ${scenario.name}: toolCalls=${stats.toolCalls} ` +
            `schemaRejections=${stats.schemaRejections} ` +
            `tokens=${stats.inputTokens}in/${stats.outputTokens}out cart=[${cartUpcs.join(", ")}]`,
        );

        for (const expected of scenario.expectCart) {
          expect(
            cartUpcs.some((upc) => upc && expected.anyOf.includes(upc)),
            `cart is missing "${expected.label}" (got: ${cartUpcs.join(", ") || "empty cart"})`,
          ).toBe(true);
        }
        expect(stats.toolCalls, "tool-call budget exceeded").toBeLessThanOrEqual(
          scenario.maxToolCalls,
        );
      },
      120_000,
    );
  }
});
