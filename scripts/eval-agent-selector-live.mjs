import { z } from "zod/v4";

const selectedActualSchema = z.object({
  upc: z.string().optional(),
  name: z.string().optional(),
});

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";

const model = process.env.EVAL_SELECTOR_MODEL ?? "openai/gpt-5.4-mini";

const sources = process.argv.slice(2);

if (sources.length === 0)
  throw new Error("Supply one or more paired JEV report paths");

const workerSource = await readFile(
  new URL("./agent-selector-live-worker.ts", import.meta.url),
  "utf8",
);

const directory = await mkdtemp(join(tmpdir(), "agent-selector-eval-"));

let worker;

try {
  const config = join(directory, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "agent-selector-eval",
      compatibility_date: "2025-03-10",
      ai: { binding: "AI", remote: true },
    }),
  );
  worker = await unstable_dev(
    fileURLToPath(new URL("./agent-selector-live-worker.ts", import.meta.url)),
    {
      config,
      ip: "127.0.0.1",
      port: 0,
      inspectorPort: 0,
      persist: false,
      logLevel: "error",
      experimental: { disableExperimentalWarning: true, watch: false },
    },
  );

  for (const sourcePath of sources) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- process each source serially
    const source = JSON.parse(await readFile(sourcePath, "utf8"));

    const report = {
      startedAt: new Date().toISOString(),
      model,
      sourcePath,
      sourceSha256: createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex"),
      workerSource,
      workerSha256: createHash("sha256").update(workerSource).digest("hex"),
      method:
        "Single forced select_products tool call per batch; same ordered catalog evidence and conservative policy as JEV. Selector comparison, not an end-to-end MCP tool loop. 60-second agent deadline versus 5-second JEV deadline; no retries.",
      batches: [],
      results: [],
    };

    const outputPath = sourcePath.replace(/\.json$/, "-agent.json");

    try {
      for (const [batchIndex, originalBatch] of source.batches.entries()) {
        const rows = source.results.filter(
          (row) => row.batchIndex === batchIndex,
        );

        const items = rows.map((row, index) => ({
          requestId: `item_${index}`,
          query: row.query,
          products: row.candidates,
        }));

        // oxlint-disable-next-line eslint/no-await-in-loop -- avoid inference bursts
        const response = await worker.fetch("http://localhost/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, items, forPickup: true }),
        });

        // oxlint-disable-next-line eslint/no-await-in-loop -- score completed batch before continuing
        const body = await response.json().catch((error) => ({
          error: `Evaluation transport returned a non-JSON response (HTTP ${response.status}): ${error instanceof Error ? error.message : String(error)}`,
          elapsedMs: null,
        }));

        report.batches.push({
          order: originalBatch.order,
          ids: originalBatch.ids,
          ...body,
        });

        for (const [index, row] of rows.entries()) {
          const selection = body.selections?.[index];

          const actual =
            selection?.status === "selected"
              ? {
                  upc: selection.product.upc,
                  name: selection.product.description,
                }
              : (selection?.status ?? "error");

          const correct =
            row.expected === "unresolved"
              ? actual === "unresolved"
              : selectedActualSchema.safeParse(actual).success &&
                row.expected.some((product) => product.upc === actual.upc);

          report.results.push({
            id: row.id,
            query: row.query,
            order: row.order,
            category: row.category,
            batchIndex,
            expected: row.expected,
            actual,
            correct,
            jevCorrect: row.correct,
            jevActual: row.actual,
            choice: body.choices?.[`item_${index}`],
            error: body.error,
          });
        }

        console.log(
          `${sourcePath} ${originalBatch.order} batch ${batchIndex + 1}: ${report.results.slice(-rows.length).filter((row) => row.correct).length}/${rows.length}, ${body.elapsedMs}ms${body.error ? `, ${body.error}` : ""}`,
        );
      }

      const rows = report.results;

      const selected = rows.filter(
        (row) => selectedActualSchema.safeParse(row.actual).success,
      );

      const negative = rows.filter((row) => row.expected === "unresolved");

      const durations = report.batches
        .map((batch) => batch.elapsedMs)
        .filter((duration) => z.number().safeParse(duration).success)
        .toSorted((a, b) => a - b);

      report.summary = {
        correct: rows.filter((row) => row.correct).length,
        total: rows.length,
        jevCorrect: rows.filter((row) => row.jevCorrect).length,
        agentWins: rows.filter((row) => row.correct && !row.jevCorrect).length,
        agentRegressions: rows.filter((row) => !row.correct && row.jevCorrect)
          .length,
        selectedPrecision: {
          correct: selected.filter((row) => row.correct).length,
          total: selected.length,
        },
        expectedAbstentions: {
          correct: negative.filter((row) => row.correct).length,
          total: negative.length,
        },
        wrongSelections: selected.filter((row) => !row.correct).length,
        missedMatches: rows.filter(
          (row) => row.expected !== "unresolved" && row.actual === "unresolved",
        ).length,
        errors: rows.filter((row) => row.actual === "error").length,
        latencyMs: {
          min: durations[0],
          median: durations[Math.floor(durations.length / 2)],
          max: durations.at(-1),
        },
        reportedCostUsd: report.batches.reduce(
          (sum, batch) => sum + (batch.raw?.usage?.cost ?? 0),
          0,
        ),
        inputTokens: report.batches.reduce(
          (sum, batch) => sum + (batch.raw?.usage?.prompt_tokens ?? 0),
          0,
        ),
        outputTokens: report.batches.reduce(
          (sum, batch) => sum + (batch.raw?.usage?.completion_tokens ?? 0),
          0,
        ),
      };
      report.completedAt = new Date().toISOString();
      console.log(JSON.stringify(report.summary, null, 2));
    } finally {
      // oxlint-disable-next-line eslint/no-await-in-loop -- preserve even an interrupted report
      await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
    }
  }
} finally {
  await worker?.stop();
  await rm(directory, { recursive: true, force: true });
}
