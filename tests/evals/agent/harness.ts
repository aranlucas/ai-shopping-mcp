/**
 * vitest-evals harness for the agent eval: an AI SDK `generateText` tool loop
 * on an OpenRouter model, whose tools are the real MCP tools from the Worker
 * (Kroger served from fixtures by ../harness.ts). After the loop it snapshots
 * cart, lists, and pantry so judges can grade end state without side effects.
 */
import type { Client } from "@modelcontextprotocol/client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { aiSdkHarness } from "@vitest-evals/harness-ai-sdk";
import {
  type GenerateTextResult,
  type Tool,
  type ToolSet,
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
} from "ai";

import {
  type KrogerFetchStub,
  type ToolCallResult,
  contentText,
} from "../harness.js";
import {
  type AgentOutput,
  type AgentTask,
  type ListItem,
  AGENT_TASKS,
} from "./tasks.js";

export type AgentInput = { taskId: string; prompt: string };

/** Per-test MCP connection; the eval file swaps it in `beforeEach`. */
export type AgentSession = { client: Client; stub: KrogerFetchStub };

const SYSTEM_PREAMBLE = `You are a grocery shopping assistant with tools connected to the user's Kroger account.
Complete the user's request end to end with the tools. Do not ask follow-up questions unless the request is impossible without the answer; otherwise make reasonable assumptions and say what you assumed.
When finished, give the user a concise final answer. Then add a line "TOOL FEEDBACK:" followed by 1-3 sentences on any tool that was confusing, missing, or returned unhelpful output (write "none" if nothing).`;

const MAX_STEPS = 16;

// Captured at import, before the Kroger stub replaces global fetch per test.
const realFetch = globalThis.fetch.bind(globalThis);

export function taskInput(task: AgentTask): AgentInput {
  return { taskId: task.id, prompt: task.prompt };
}

function findTask(taskId: string): AgentTask {
  const task = AGENT_TASKS.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown agent task ${taskId}`);
  return task;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  return (await client.callTool({ name, arguments: args })) as ToolCallResult;
}

/** Exposes every MCP tool to the AI SDK exactly as a host would see it. */
async function mcpToolSet(client: Client): Promise<ToolSet> {
  const { tools } = await client.listTools();
  const entries = tools.map((mcpTool): [string, Tool] => {
    const { $schema: _dialect, ...schema } = mcpTool.inputSchema as Record<
      string,
      unknown
    >;
    return [
      mcpTool.name,
      tool({
        description: mcpTool.description ?? "",
        inputSchema: jsonSchema<Record<string, unknown>>(schema),
        execute: async (args) => {
          const result = await callTool(client, mcpTool.name, args);
          const text = contentText(result);
          // Thrown errors reach the model as tool errors and are recorded
          // with status "error" on the harness run.
          if (result.isError) throw new Error(text);
          return text;
        },
      }),
    ];
  });
  return Object.fromEntries(entries);
}

async function snapshotLists(client: Client): Promise<AgentOutput["lists"]> {
  const summary = await callTool(client, "get_shopping_list", {});
  const lists =
    (summary.structuredContent as { lists?: Array<{ id: string }> } | undefined)
      ?.lists ?? [];
  return Promise.all(
    lists.map(async ({ id }) => {
      const detail = await callTool(client, "get_shopping_list", {
        listId: id,
      });
      const structured = detail.structuredContent as {
        name: string;
        items: Array<Omit<ListItem, "upc"> & { upc?: string }>;
      };
      return {
        name: structured.name,
        items: structured.items.map((item) => ({
          productName: item.productName,
          upc: item.upc ?? null,
          quantity: item.quantity,
          checked: item.checked,
        })),
      };
    }),
  );
}

/** get_shopping_profile has no structuredContent, so read its Pantry section. */
async function snapshotPantry(client: Client): Promise<AgentOutput["pantry"]> {
  const profile = await callTool(client, "get_shopping_profile", {});
  const section =
    contentText(profile).split("## Pantry")[1]?.split("##")[0] ?? "";
  return [...section.matchAll(/^- (.+?) x(\d+)/gm)].map((match) => ({
    name: match[1],
    quantity: Number(match[2]),
  }));
}

function splitFeedback(text: string): { answer: string; feedback: string } {
  const index = text.search(/TOOL FEEDBACK:/i);
  if (index === -1) return { answer: text.trim(), feedback: "" };
  return {
    answer: text.slice(0, index).trim(),
    feedback: text
      .slice(index)
      .replace(/TOOL FEEDBACK:/i, "")
      .trim(),
  };
}

export function shoppingAgentHarness(options: {
  model: string;
  apiKey: string;
  session: () => AgentSession;
}) {
  const openrouter = createOpenRouter({
    apiKey: options.apiKey,
    fetch: realFetch,
    headers: { "X-Title": "ai-shopping-mcp evals" },
  });
  let observed: Omit<AgentOutput, "answer" | "feedback"> | undefined;

  return aiSdkHarness<
    unknown,
    AgentInput,
    GenerateTextResult<ToolSet, never>,
    ToolSet,
    AgentOutput
  >({
    name: options.model,
    run: async ({ input }) => {
      const { client, stub } = options.session();
      const task = findTask(input.taskId);
      await task.setup?.(async (name, args) => {
        const result = await callTool(client, name, args);
        if (result.isError) {
          throw new Error(`setup ${name} failed: ${contentText(result)}`);
        }
      });
      stub.cartPuts.length = 0;

      const result = await generateText({
        model: openrouter(options.model),
        system: `${SYSTEM_PREAMBLE}\n\n${client.getInstructions() ?? ""}`,
        prompt: input.prompt,
        tools: await mcpToolSet(client),
        stopWhen: stepCountIs(MAX_STEPS),
        maxRetries: 5,
      });

      observed = {
        cart: stub.allCartItems().map((item) => ({
          upc: item.upc ?? "",
          quantity: item.quantity ?? 0,
          modality: item.modality ?? "",
        })),
        lists: await snapshotLists(client),
        pantry: await snapshotPantry(client),
      };
      return result;
    },
    output: ({ result }): AgentOutput => {
      if (!observed) throw new Error("harness output read before run");
      return { ...splitFeedback(result.text), ...observed };
    },
  });
}
