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

const cases = process.argv.includes("--all")
  ? [...tuningCases, ...holdoutCases]
  : process.argv.includes("--holdout")
    ? holdoutCases
    : tuningCases;
const compact = process.argv.includes("--compact");
const rankedControl = process.argv.includes("--ranked-control");
const orders = rankedControl
  ? ["acceptable-first"]
  : ["original", "reversed", "shuffled"];
const outputPath =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
  "jev-evaluation-latest.json";
const selectorSource = await readFile(
  new URL("./fixtures/jev-product-selector.ts", import.meta.url),
  "utf8",
);
const report = {
  startedAt: new Date().toISOString(),
  dataset: `${cases.length} synthetic hand-labeled grocery cases, ${orders.length} candidate order(s); labels fixed before inference`,
  orders,
  controlDescription: rankedControl
    ? "Label-informed ordering puts acceptable candidates first; an ideal-retrieval control, not observed Kroger relevance."
    : null,
  candidateSet: compact
    ? "Original challenge candidates without unrelated fillers"
    : "Expanded to 20 candidates with unrelated fillers",
  rankedControl,
  comparison:
    "First eligible candidate in identical order; same stock/UPC/curbside eligibility as production. Synthetic order is not Kroger ranking.",
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
    products: compact ? testCase.candidates : expandedCandidates(testCase),
  }));
  for (const order of orders) {
    for (let offset = 0; offset < expanded.length; offset += 10) {
      const batch = expanded.slice(offset, offset + 10);
      const items = batch.map((testCase, index) => ({
        requestId: `item_${index}`,
        query: testCase.query,
        products:
          order === "acceptable-first"
            ? testCase.products.toSorted(
                (a, b) =>
                  Number(testCase.acceptableUpcs.includes(b.upc)) -
                  Number(testCase.acceptableUpcs.includes(a.upc)),
              )
            : order === "reversed"
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
      report.batches.push({
        order,
        ids: batch.map((testCase) => testCase.id),
        ...body,
      });
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
        const firstEligible = items[index].products.find((product) => {
          const variant = product.items?.[0];
          return (
            variant?.inventory?.stockLevel !== "TEMPORARILY_OUT_OF_STOCK" &&
            Boolean(product.upc) &&
            variant?.fulfillment?.curbside === true
          );
        });
        const baselineCorrect = expectedAbstention
          ? !firstEligible
          : Boolean(
              firstEligible &&
              testCase.acceptableUpcs.includes(firstEligible.upc),
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
          baselineCorrect,
          baselineActual: firstEligible
            ? { upc: firstEligible.upc, name: firstEligible.description }
            : "unresolved",
          candidates: items[index].products,
          expected: expectedAbstention
            ? "unresolved"
            : testCase.candidates
                .filter((product) =>
                  testCase.acceptableUpcs.includes(product.upc),
                )
                .map((product) => ({
                  upc: product.upc,
                  name: product.description,
                })),
          actual:
            selection?.status === "selected"
              ? {
                  upc: selection.product.upc,
                  name: selection.product.description,
                }
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
  const selections = results.filter(
    (result) => typeof result.actual === "object",
  );
  const expectedAbstentions = results.filter(
    (result) => result.expected === "unresolved",
  );
  const durations = report.batches
    .map((batch) => batch.elapsedMs)
    .toSorted((a, b) => a - b);
  report.summary = {
    ...summarize(results),
    uniqueCases: cases.length,
    matchableRequests: {
      jev: summarize(results.filter((row) => row.expected !== "unresolved")),
      firstEligible: {
        correct: results.filter(
          (row) => row.expected !== "unresolved" && row.baselineCorrect,
        ).length,
        total: results.filter((row) => row.expected !== "unresolved").length,
      },
    },
    failedBatches: report.batches.filter((batch) => batch.error).length,
    firstEligible: {
      correct: results.filter((row) => row.baselineCorrect).length,
      total: results.length,
      wrongSelections: results.filter(
        (row) => typeof row.baselineActual === "object" && !row.baselineCorrect,
      ).length,
      selected: results.filter((row) => typeof row.baselineActual === "object")
        .length,
    },
    paired: {
      jevWins: results.filter((row) => row.correct && !row.baselineCorrect)
        .length,
      jevRegressions: results.filter(
        (row) => !row.correct && row.baselineCorrect,
      ).length,
      bothCorrect: results.filter((row) => row.correct && row.baselineCorrect)
        .length,
      bothWrong: results.filter((row) => !row.correct && !row.baselineCorrect)
        .length,
    },
    wrongSelections: selections.filter((row) => !row.correct).length,
    missedMatches: results.filter(
      (row) => row.expected !== "unresolved" && row.actual === "unresolved",
    ).length,
    byOrder: Object.fromEntries(
      orders.map((order) => {
        const rows = results.filter((row) => row.order === order);
        return [
          order,
          {
            jev: summarize(rows),
            firstEligible: {
              correct: rows.filter((row) => row.baselineCorrect).length,
              total: rows.length,
            },
          },
        ];
      }),
    ),
    selectedPrecision: summarize(selections),
    expectedAbstentions: summarize(expectedAbstentions),
    errors: results.filter((result) => result.actual === "error").length,
    casesPassingAllOrders: cases.filter((testCase) =>
      results
        .filter((result) => result.id === testCase.id)
        .every((result) => result.correct),
    ).length,
    byCategory: Object.fromEntries(
      [...new Set(cases.map((testCase) => testCase.category))].map(
        (category) => [
          category,
          summarize(results.filter((result) => result.category === category)),
        ],
      ),
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
      .reduce(
        (sum, call) => sum + (call.response?.usage?.input_tokens ?? 0),
        0,
      ),
  };
  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify(report.summary, null, 2));
} finally {
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  await worker?.stop();
  await rm(directory, { recursive: true, force: true });
}
