/** Interactive Codex session, using the same MCP connection and task checks. */
import { createHarness, type TranscriptEvent } from "vitest-evals";
import { z } from "zod/v4";

import { contentText } from "../harness.js";
import {
  type AgentInput,
  type AgentSession,
  MAX_STEPS,
  SYSTEM_PREAMBLE,
  callTool,
  findTask,
  snapshotLists,
  snapshotPantry,
} from "./harness.js";
import type { AgentOutput } from "./tasks.js";

const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("tool"),
    name: z.string().min(1),
    arguments: z.record(z.string(), z.json()),
  }),
  z.strictObject({
    type: z.literal("finish"),
    answer: z.string(),
    feedback: z.string(),
  }),
]);

export function codexAgentHarness(options: {
  driver: Fetcher;
  session: () => AgentSession;
}) {
  return createHarness<AgentInput, AgentOutput>({
    name: "codex/session",
    run: async ({ input, signal }) => {
      const { client, stub } = options.session();
      const task = findTask(input.taskId);
      await task.setup?.(async (name, args) => {
        const result = await callTool(client, name, args);
        if (result.isError) {
          throw new Error(`setup ${name} failed: ${contentText(result)}`);
        }
      });
      stub.cartPuts.length = 0;

      const system = `${SYSTEM_PREAMBLE}\n\n${client.getInstructions() ?? ""}`;
      const { tools } = await client.listTools();
      const events: TranscriptEvent[] = [
        { type: "message", role: "system", content: system },
        { type: "message", role: "user", content: input.prompt },
      ];
      let observation: unknown = { system, prompt: input.prompt, tools };
      let calls = 0;

      // Each turn depends on the previous real MCP result.
      for (;;) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- interactive agent turns are sequential
        const response = await options.driver.fetch("http://codex-eval/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: task.id,
            split: task.split,
            observation,
          }),
          signal,
        });
        if (!response.ok)
          throw new Error(`Codex driver HTTP ${response.status}`);
        // oxlint-disable-next-line eslint/no-await-in-loop -- parse the current turn before choosing the next
        const action = actionSchema.parse(await response.json());
        if (action.type === "finish") {
          events.push({
            type: "message",
            role: "assistant",
            content: action.answer,
          });
          return {
            events,
            output: {
              answer: action.answer,
              feedback: action.feedback,
              cart: stub.allCartItems().map((item) => ({
                upc: item.upc ?? "",
                quantity: item.quantity ?? 0,
                modality: item.modality ?? "",
              })),
              // oxlint-disable-next-line eslint/no-await-in-loop -- snapshot only after the agent finishes
              lists: await snapshotLists(client),
              // oxlint-disable-next-line eslint/no-await-in-loop -- snapshot only after the agent finishes
              pantry: await snapshotPantry(client),
            },
            usage: { toolCalls: calls },
            artifacts: {
              driver: "interactive Codex session",
              toolDefinitions: tools,
            },
          };
        }
        if (calls >= MAX_STEPS)
          throw new Error(`Exceeded ${MAX_STEPS} tool calls`);
        const id = `call_${++calls}`;
        events.push({
          type: "tool_call",
          id,
          name: action.name,
          arguments: action.arguments,
        });
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- return each tool result to the session
          const result = await callTool(client, action.name, action.arguments);
          const text = contentText(result);
          events.push({
            type: "tool_result",
            toolCallId: id,
            name: action.name,
            content: text,
            ...(result.isError ? { error: { message: text } } : {}),
          });
          observation = {
            name: action.name,
            text,
            isError: Boolean(result.isError),
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          events.push({
            type: "tool_result",
            toolCallId: id,
            name: action.name,
            error: { message },
          });
          observation = { name: action.name, text: message, isError: true };
        }
      }
    },
  });
}
