import { createJudge } from "vitest-evals";

import type { AgentInput } from "./harness.js";

import { type AgentOutput, AGENT_TASKS } from "./tasks.js";

/**
 * Scores a run by its task's end-state checks: score is the fraction passed,
 * and the rationale lists what failed. Deterministic — no model grader.
 */
export const TaskChecksJudge = createJudge<AgentInput, AgentOutput>(
  "TaskChecksJudge",
  ({ input, output, toolCalls }) => {
    const task = AGENT_TASKS.find((candidate) => candidate.id === input.taskId);

    if (!task) return { score: 0, metadata: { rationale: "unknown task" } };
    const checks = task.checks(output, toolCalls);
    const failed = checks.filter((entry) => !entry.pass);

    return {
      score: checks.length
        ? (checks.length - failed.length) / checks.length
        : 0,
      metadata: {
        rationale: failed.length
          ? failed
              .map(
                (entry) =>
                  `✗ ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`,
              )
              .join("\n")
          : `all ${checks.length} checks passed`,
        split: task.split,
        toolErrors: toolCalls.filter((call) => call.status === "error").length,
        feedback: output.feedback,
      },
    };
  },
);
