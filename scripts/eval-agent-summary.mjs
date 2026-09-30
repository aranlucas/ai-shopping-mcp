// Summarizes the vitest-evals JSON report from `pnpm eval:agent` as Markdown
// (used for the GitHub Actions step summary).
//
//   node scripts/eval-agent-summary.mjs [eval-results/agent.json]
import { readFile } from "node:fs/promises";

const reportPath = process.argv[2] ?? "eval-results/agent.json";
const report = JSON.parse(await readFile(reportPath, "utf8"));

const runs = report.testResults
  .flatMap((file) => file.assertionResults)
  .filter((test) => test.meta?.eval)
  .map((test) => {
    const score = test.meta.eval.scores[0] ?? {};
    const usage = test.meta.harness?.run?.usage ?? {};
    return {
      model: test.ancestorTitles.at(-1),
      task: test.title.replace(/^\[\w+\] /, ""),
      split: score.metadata?.split ?? "train",
      pass: test.status === "passed",
      score: score.score ?? 0,
      rationale: score.metadata?.rationale ?? "",
      feedback: score.metadata?.feedback ?? "",
      toolCalls: usage.toolCalls ?? 0,
      toolErrors: score.metadata?.toolErrors ?? 0,
      tokens: usage.totalTokens ?? 0,
    };
  });

const errored = report.testResults
  .flatMap((file) => file.assertionResults)
  .filter((test) => !test.meta?.eval && test.status === "failed");

const models = [...new Set(runs.map((run) => run.model))];
const tasks = [...new Set(runs.map((run) => run.task))];
const rate = (rows) =>
  rows.length ? `${rows.filter((row) => row.pass).length}/${rows.length}` : "-";
const avg = (rows, key) =>
  rows.length
    ? (rows.reduce((sum, row) => sum + row[key], 0) / rows.length).toFixed(1)
    : "-";
const oneLine = (text) => text.replace(/\s+/g, " ").trim();

const lines = [
  "## Agent eval",
  "",
  "| Model | Train | Held-out | Avg tool calls | Tool errors | Avg tokens |",
  "| --- | --- | --- | --- | --- | --- |",
  ...models.map((model) => {
    const rows = runs.filter((run) => run.model === model);
    return `| ${model} | ${rate(rows.filter((r) => r.split === "train"))} | ${rate(rows.filter((r) => r.split === "test"))} | ${avg(rows, "toolCalls")} | ${rows.reduce((sum, r) => sum + r.toolErrors, 0)} | ${Math.round(Number(avg(rows, "tokens")) || 0)} |`;
  }),
  "",
  `| Task | ${models.join(" | ")} |`,
  `| --- |${models.map(() => " --- |").join("")}`,
  ...tasks.map((task) => {
    const cells = models.map((model) => {
      const run = runs.find((r) => r.model === model && r.task === task);
      return run ? `${run.pass ? "✅" : "❌"} ${run.toolCalls} calls` : "-";
    });
    const split = runs.find((r) => r.task === task)?.split;
    return `| ${task}${split === "test" ? " (held-out)" : ""} | ${cells.join(" | ")} |`;
  }),
];

const failures = runs.filter((run) => !run.pass);
if (failures.length || errored.length) {
  lines.push("", "### Failures", "");
  for (const run of failures) {
    lines.push(`- **${run.model} / ${run.task}**: ${oneLine(run.rationale)}`);
  }
  for (const test of errored) {
    lines.push(
      `- **${test.ancestorTitles.at(-1)} / ${test.title}** errored: ${oneLine(test.failureMessages.join(" ")).slice(0, 300)}`,
    );
  }
}

const feedback = runs.filter(
  (run) => run.feedback && !/^none\.?$/i.test(run.feedback),
);
if (feedback.length) {
  lines.push("", "### Model tool feedback", "");
  for (const run of feedback) {
    lines.push(`- ${run.model} / ${run.task}: ${oneLine(run.feedback)}`);
  }
}

console.log(`${lines.join("\n")}\n`);
