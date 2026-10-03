// Runs the agent eval with one vitest process per model. Tests inside a
// process stay sequential (they share the Kroger fetch stub and the Worker's
// storage), so parallelism comes from separate processes, capped by
// EVAL_CONCURRENCY (default 2): OpenRouter's free tier allows about 20
// requests a minute per account, and more processes only buy 429 retries.
// Each model writes eval-results/agent-<model>.json for the summary script
// and `vitest-evals serve eval-results`.
//
//   pnpm eval:agent
//   EVAL_MODELS=qwen/qwen3.8-27b:free EVAL_TASKS=budget-basket pnpm eval:agent
//   EVAL_CONCURRENCY=1 pnpm eval:agent
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";

const DEFAULT_MODELS = [
  "stealth/space-bunny-alpha",
  "qwen/qwen3.8-27b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-2.6b:free",
];

const models =
  process.env.EVAL_MODELS?.split(",").filter(Boolean) ?? DEFAULT_MODELS;

const slug = (model) => model.replace(/[^a-z0-9]+/gi, "-");

const concurrency = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 2));

await mkdir("eval-results", { recursive: true });

await Promise.all(
  (await readdir("eval-results"))
    .filter((file) => /^agent.*\.json$/.test(file))
    .map((file) => rm(`eval-results/${file}`)),
);

function runModel(model) {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "tests/evals/agent.eval.test.ts",
        "--reporter=vitest-evals/reporter",
        "--reporter=json",
        `--outputFile.json=eval-results/agent-${slug(model)}.json`,
      ],
      {
        env: { ...process.env, EVAL_AGENT: "1", EVAL_MODELS: model },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const prefix = (chunk) =>
      String(chunk)
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => `[${model}] ${line}\n`)
        .join("");

    child.stdout.on("data", (chunk) => process.stdout.write(prefix(chunk)));
    child.stderr.on("data", (chunk) => process.stderr.write(prefix(chunk)));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// A small worker pool: each worker takes the next model when it finishes one.
const queue = [...models];

const codes = [];

await Promise.all(
  Array.from({ length: Math.min(concurrency, models.length) }, async () => {
    for (let model = queue.shift(); model; model = queue.shift()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each worker runs its models one at a time
      codes.push(await runModel(model));
    }
  }),
);

console.log(
  `\nFinished ${models.length} model(s); ${codes.filter((code) => code !== 0).length} with failing tasks. Summary: pnpm eval:agent:summary`,
);
