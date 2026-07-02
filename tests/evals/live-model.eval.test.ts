/**
 * Eval: live small-model agent runs (opt-in, Workers AI).
 *
 * Runs the scenarios in scenarios.ts with a real small model driving the real
 * MCP server over the wire, using the Worker's own Cloudflare AI binding
 * (`env.AI`) — no external API key. Kroger stays fixture-backed.
 *
 * The miniflare AI binding proxies to **remote** Workers AI (it can incur
 * usage charges and needs Cloudflare credentials — `wrangler login` or
 * CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID), so the suite is explicitly
 * opt-in:
 *
 *   EVAL_LIVE=1 pnpm eval:mcp
 *   EVAL_LIVE=1 EVAL_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast pnpm eval:mcp
 *
 * The default model is deliberately small (llama-3.1-8b) — that is the class
 * of model this server is tuned for. Metrics per scenario: task success
 * (fixture cart contents), tool-call count vs budget, and schema-rejection
 * count (isError results).
 */
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
const liveEnabled = Boolean(evalEnv.EVAL_LIVE);
const model = evalEnv.EVAL_MODEL ?? "@cf/meta/llama-3.1-8b-instruct";

const MAX_AGENT_TURNS = 12;

// The generated Ai binding types are keyed by model id and don't cover the
// tool-calling request/response shape generically, so the runner uses a
// narrow structural view of the binding instead.
type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: WorkersAiToolCall[];
};

type WorkersAiTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type WorkersAiToolCall = { name: string; arguments: unknown };

type WorkersAiChatResult = {
  response?: string;
  tool_calls?: WorkersAiToolCall[];
};

type ChatCapableAi = {
  run(
    model: string,
    options: { messages: ChatMessage[]; tools: WorkersAiTool[] },
  ): Promise<unknown>;
};

function parseChatResult(raw: unknown): WorkersAiChatResult {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const toolCallsRaw = record.tool_calls;
  const toolCalls = Array.isArray(toolCallsRaw)
    ? toolCallsRaw.flatMap((entry): WorkersAiToolCall[] => {
        if (!entry || typeof entry !== "object") return [];
        const call = entry as Record<string, unknown>;
        if (typeof call.name !== "string") return [];
        return [{ name: call.name, arguments: call.arguments }];
      })
    : undefined;
  return {
    response: typeof record.response === "string" ? record.response : undefined,
    tool_calls: toolCalls,
  };
}

/** Workers AI models return tool arguments as an object or a JSON string. */
function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

type RunStats = { toolCalls: number; schemaRejections: number };

describe.skipIf(!liveEnabled)(`live small-model eval (${model})`, () => {
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

  /** Minimal manual agentic loop: Workers AI model ↔ real MCP tools. */
  async function runAgent(userTask: string): Promise<RunStats> {
    const ai = (env as { AI?: unknown }).AI as ChatCapableAi | undefined;
    if (!ai) throw new Error("AI binding is not available in the test environment");

    const { tools: mcpTools } = await client.listTools();
    const tools: WorkersAiTool[] = mcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema as Record<string, unknown>,
    }));

    const stats: RunStats = { toolCalls: 0, schemaRejections: 0 };
    const messages: ChatMessage[] = [
      { role: "system", content: client.getInstructions() ?? "" },
      { role: "user", content: userTask },
    ];

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const result = parseChatResult(await ai.run(model, { messages, tools }));

      if (!result.tool_calls || result.tool_calls.length === 0) break;

      messages.push({ role: "assistant", content: "", tool_calls: result.tool_calls });

      for (const toolCall of result.tool_calls) {
        stats.toolCalls++;

        let toolResult: ToolCallResult;
        try {
          toolResult = (await client.callTool({
            name: toolCall.name,
            arguments: parseToolArguments(toolCall.arguments),
          })) as ToolCallResult;
        } catch (error) {
          toolResult = {
            isError: true,
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
        if (toolResult.isError) stats.schemaRejections++;

        messages.push({ role: "tool", name: toolCall.name, content: contentText(toolResult) });
      }
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
            `schemaRejections=${stats.schemaRejections} cart=[${cartUpcs.join(", ")}]`,
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
