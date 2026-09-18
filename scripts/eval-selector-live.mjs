import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";
import {
  cases as tuningCases,
  holdoutCases,
  expandedCandidates,
  shuffled,
} from "./fixtures/jev-grocery-cases.mjs";

const summarize = (rows) => ({
  correct: rows.filter((row) => row.correct).length,
  total: rows.length,
});

const cases = process.argv.includes("--holdout") ? holdoutCases : tuningCases;
const outputPath = process.argv[2] ?? "docs/jev-evaluation-latest.json";
const selectorSource = await readFile(
  new URL("../src/services/product-selector.ts", import.meta.url),
  "utf8",
);
const report = {
  startedAt: new Date().toISOString(),
  dataset: `${cases.length} synthetic hand-labeled grocery cases, three candidate orders; labels fixed before inference`,
  selectorSource,
  selectorSha256: createHash("sha256").update(selectorSource).digest("hex"),
  batches: [],
  results: [],
};
const directory = await mkdtemp(join(tmpdir(), "jev-selector-eval-"));
let worker;
try {
  const configPath = join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "jev-selector-eval",
      compatibility_date: "2025-03-10",
      ai: { binding: "AI", remote: true },
    }),
  );
  worker = await unstable_dev(
    fileURLToPath(new URL("./selector-live-worker.ts", import.meta.url)),
    {
      config: configPath,
      ip: "127.0.0.1",
      port: 0,
      inspectorPort: 0,
      persist: false,
      logLevel: "error",
      experimental: { disableExperimentalWarning: true, watch: false },
    },
  );
  const expanded = cases.map((testCase) => ({
    ...testCase,
    products: expandedCandidates(testCase),
  }));
  for (const order of ["original", "reversed", "shuffled"]) {
    for (let offset = 0; offset < expanded.length; offset += 10) {
      const batch = expanded.slice(offset, offset + 10);
      const items = batch.map((testCase, index) => ({
        query: testCase.query,
        products:
          order === "reversed"
            ? testCase.products.toReversed()
            : order === "shuffled"
              ? shuffled(testCase.products, 42 + offset + index)
              : testCase.products,
      }));
      // Deliberately serial: measure isolated latency without bursts or application retries.
      // oxlint-disable-next-line eslint/no-await-in-loop -- isolate latency and avoid inference bursts
      const response = await worker.fetch("http://localhost/?diagnostics=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, forPickup: true }),
      });
      // oxlint-disable-next-line eslint/no-await-in-loop -- score each completed batch before the next
      const body = await response.json();
      const batchIndex = report.batches.length;
      report.batches.push({ order, ids: batch.map((testCase) => testCase.id), ...body });
      for (const [index, testCase] of batch.entries()) {
        const selection = body.selections?.[index];
        const expectedAbstention = testCase.acceptableUpcs.length === 0;
        const correct = Boolean(
          selection &&
          (expectedAbstention
            ? selection.status === "unresolved"
            : selection.status === "selected" &&
              testCase.acceptableUpcs.includes(selection.product.upc)),
        );
        const answer = body.calls?.[0]?.response?.answers?.[`item_${index}`];
        report.results.push({
          id: testCase.id,
          category: testCase.category,
          query: testCase.query,
          note: testCase.note,
          order,
          batchIndex,
          correct,
          expected: expectedAbstention
            ? "unresolved"
            : testCase.candidates
                .filter((product) => testCase.acceptableUpcs.includes(product.upc))
                .map((product) => ({ upc: product.upc, name: product.description })),
          actual:
            selection?.status === "selected"
              ? { upc: selection.product.upc, name: selection.product.description }
              : (selection?.status ?? "error"),
          choice: answer?.choice,
          confidence: answer?.confidence,
          topProbability: answer?.probabilities?.[answer?.choice],
          error: body.error,
        });
      }
      console.log(
        `${order} batch ${offset / 10 + 1}: ${report.results.slice(-batch.length).filter((result) => result.correct).length}/${batch.length}, ${body.elapsedMs}ms${body.error ? `, ${body.error}` : ""}`,
      );
    }
  }
  const results = report.results;
  const selections = results.filter((result) => typeof result.actual === "object");
  const expectedAbstentions = results.filter((result) => result.expected === "unresolved");
  const durations = report.batches.map((batch) => batch.elapsedMs).toSorted((a, b) => a - b);
  report.summary = {
    ...summarize(results),
    uniqueCases: cases.length,
    selectedPrecision: summarize(selections),
    expectedAbstentions: summarize(expectedAbstentions),
    errors: results.filter((result) => result.actual === "error").length,
    casesPassingAllOrders: cases.filter((testCase) =>
      results.filter((result) => result.id === testCase.id).every((result) => result.correct),
    ).length,
    byCategory: Object.fromEntries(
      [...new Set(cases.map((testCase) => testCase.category))].map((category) => [
        category,
        summarize(results.filter((result) => result.category === category)),
      ]),
    ),
    latencyMs: {
      min: durations[0],
      median: durations[Math.floor(durations.length / 2)],
      max: durations.at(-1),
    },
    reportedCostUsd: report.batches
      .flatMap((batch) => batch.calls ?? [])
      .reduce((sum, call) => sum + (call.response?.usage?.cost ?? 0), 0),
    inputTokens: report.batches
      .flatMap((batch) => batch.calls ?? [])
      .reduce((sum, call) => sum + (call.response?.usage?.input_tokens ?? 0), 0),
  };
  console.log(JSON.stringify(report.summary, null, 2));
} finally {
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  await worker?.stop();
  await rm(directory, { recursive: true, force: true });
}
