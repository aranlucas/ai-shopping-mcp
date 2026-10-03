/**
 * Eval: agent tasks over OpenRouter (`pnpm eval:agent`) or the current
 * interactive Codex session (`pnpm eval:agent:codex`). Both are opt-in.
 *
 * Built on vitest-evals: one `describeEval` suite per model, each task a
 * harness run (AI SDK tool loop ↔ real MCP server, Kroger fixtures) graded by
 * TaskChecksJudge against end state. Scores, tool calls, usage, and the
 * model's TOOL FEEDBACK land in task meta for the vitest-evals reporter and
 * the JSON report (`vitest-evals serve eval-results/agent.json`).
 *
 * The default models are free on OpenRouter, so a $0-limit key works.
 * EVAL_MODELS picks models (comma-separated), EVAL_TASKS picks tasks.
 */
import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach } from "vitest";
import { describeEval } from "vitest-evals";

import {
  type AgentSession,
  shoppingAgentHarness,
  taskInput,
} from "./agent/harness.js";
import { TaskChecksJudge } from "./agent/judges.js";
import { codexAgentHarness } from "./agent/codex-harness.js";
import { AGENT_TASKS } from "./agent/tasks.js";
import { createEvalMcpClient, installKrogerFetchStub } from "./harness.js";

const evalEnv = env;

const apiKey = evalEnv.OPENROUTER_API_KEY ?? "";

const codexDriver = env.EVAL_CODEX_DRIVER;

const enabled =
  Boolean(codexDriver) || (evalEnv.EVAL_AGENT === "1" && apiKey !== "");

const DEFAULT_MODELS = [
  "stealth/space-bunny-alpha",
  "qwen/qwen3.8-27b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-2.6b:free",
];

const models = codexDriver
  ? ["codex/session"]
  : (evalEnv.EVAL_MODELS?.split(",").filter(Boolean) ?? DEFAULT_MODELS);

const taskFilter = evalEnv.EVAL_TASKS?.split(",").filter(Boolean);

const tasks = taskFilter
  ? AGENT_TASKS.filter((task) => taskFilter.includes(task.id))
  : AGENT_TASKS;

let session: AgentSession | undefined;

function getSession(): AgentSession {
  if (!session) throw new Error("MCP session not initialized");

  return session;
}

beforeEach(async () => {
  if (!enabled) return;
  const stub = installKrogerFetchStub();
  session = { stub, client: await createEvalMcpClient() };
});

afterEach(async () => {
  if (!session) return;
  await session.client.close();
  session.stub.restore();
  session = undefined;
  await reset();
});

for (const model of models) {
  describeEval(
    model,
    {
      harness: codexDriver
        ? codexAgentHarness({ driver: codexDriver, session: getSession })
        : shoppingAgentHarness({ model, apiKey, session: getSession }),
      judges: [TaskChecksJudge],
      judgeThreshold: 1,
      skipIf: () => !enabled,
    },
    (it) => {
      for (const task of tasks) {
        it(
          `[${task.split}] ${task.id}`,
          { timeout: codexDriver ? 1_800_000 : 600_000 },
          async ({ run }) => {
            await run(taskInput(task));
          },
        );
      }
    },
  );
}
