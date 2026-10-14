import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  agentReportSchema,
  agentSelectorBodySchema,
  codexActionSchema,
  codexTurnSchema,
  pairedReportSchema,
  responseAnswers,
  responseUsage,
  selectorBodySchema,
} from "./eval-schemas.mjs";
import {
  cases,
  holdoutCases,
  expandedCandidates,
  shuffled,
} from "./fixtures/jev-grocery-cases.mjs";

await test("selector diagnostics keep catalog evidence and arbitrary provider failures", () => {
  const product = { upc: "123", description: "Milk", price: { regular: 4.5 } };

  const body = {
    selections: [{ requestId: "item_0", status: "selected", product }],
    calls: [{ elapsedMs: 10, status: 502, response: "upstream unavailable" }],
    elapsedMs: 11,
    diagnostic: "preserve me",
  };

  assert.deepEqual(selectorBodySchema.parse(body), body);
  assert.equal(responseUsage(body.calls[0].response), undefined);
  assert.equal(responseAnswers(body.calls[0].response), undefined);
  assert.equal(selectorBodySchema.safeParse({ ...body, elapsedMs: "11" }).success, false);
  assert.equal(
    selectorBodySchema.safeParse({ ...body, selections: [{ status: "selected" }] }).success,
    false,
  );
});

await test("usage, probabilities and transport failures remain typed and optional", () => {
  const response = {
    usage: { cost: 0.001, input_tokens: 12, completion_tokens: 3 },
    answers: {
      item_0: { choice: "candidate_0", confidence: 0.9, probabilities: { candidate_0: 0.9 } },
    },
  };

  assert.equal(responseUsage(response)?.cost, 0.001);
  assert.equal(responseAnswers(response)?.item_0.choice, "candidate_0");
  assert.equal(responseUsage({ usage: { cost: "free" } }), undefined);
  assert.equal(responseUsage({ usage: { cost: null, prompt_tokens: 12 } })?.prompt_tokens, 12);
  assert.deepEqual(agentSelectorBodySchema.parse({ error: "non-JSON", elapsedMs: null }), {
    error: "non-JSON",
    elapsedMs: null,
  });
});

await test("paired reports accept scoring inputs and reject malformed labels", () => {
  const report = {
    batches: [{ order: "original", ids: ["milk"], elapsedMs: 10 }],
    results: [
      {
        id: "milk",
        query: "milk",
        category: "category",
        order: "original",
        batchIndex: 0,
        candidates: [{ upc: "123", description: "Milk" }],
        expected: [{ upc: "123", name: "Milk" }],
        actual: "unresolved",
        correct: false,
        baselineCorrect: true,
        baselineActual: { upc: "123", name: "Milk" },
      },
    ],
    sourceSha256: "original hash",
  };

  assert.deepEqual(pairedReportSchema.parse(report), report);
  assert.equal(
    pairedReportSchema.safeParse({ ...report, results: [{ ...report.results[0], expected: 123 }] })
      .success,
    false,
  );
});

await test("Codex validates both observations and the harness action contract", () => {
  const initial = {
    taskId: "milk",
    split: "train",
    observation: { system: "policy", prompt: "milk", tools: [{ name: "search" }] },
  };

  const toolResult = {
    taskId: "milk",
    split: "train",
    observation: { name: "search", text: "[]", isError: false },
  };

  assert.deepEqual(codexTurnSchema.parse(initial), initial);
  assert.deepEqual(codexTurnSchema.parse(toolResult), toolResult);
  assert.equal(codexTurnSchema.safeParse({ ...initial, observation: "invalid" }).success, false);
  assert.equal(
    codexActionSchema.safeParse({
      id: "turn",
      action: { type: "tool", name: "search", arguments: { query: "milk", limit: 2 } },
    }).success,
    true,
  );
  assert.equal(
    codexActionSchema.safeParse({
      id: "turn",
      action: { type: "finish", answer: "done", feedback: "none" },
    }).success,
    true,
  );
  assert.equal(
    codexActionSchema.safeParse({ id: "turn", action: { type: "tool", name: "", arguments: [] } })
      .success,
    false,
  );
});

await test("fixtures retain deterministic ordering, labels and 20-candidate expansion", () => {
  for (const fixture of [...cases, ...holdoutCases]) {
    assert.ok(
      fixture.acceptableUpcs.every((upc) =>
        fixture.candidates.some((product) => product.upc === upc),
      ),
    );
    const expanded = expandedCandidates(fixture);
    assert.equal(expanded.length, 20);
    assert.deepEqual(expanded.slice(0, fixture.candidates.length), fixture.candidates);
    assert.deepEqual(shuffled(expanded, 42), shuffled(expanded, 42));
    assert.deepEqual(
      shuffled(expanded, 42).toSorted((a, b) => a.upc.localeCompare(b.upc)),
      expanded.toSorted((a, b) => a.upc.localeCompare(b.upc)),
    );
  }
});

await test("summary handles passes, missing usage, failed runs and pre-eval errors", () => {
  const report = {
    testResults: [
      {
        assertionResults: [
          {
            ancestorTitles: ["model-a"],
            title: "[train] milk",
            status: "passed",
            failureMessages: [],
            meta: {
              eval: { scores: [{ score: 1, metadata: { split: "train", toolErrors: 0 } }] },
              harness: { run: { usage: { toolCalls: 2, totalTokens: 100 } } },
            },
          },
          {
            ancestorTitles: ["model-a"],
            title: "[test] eggs",
            status: "failed",
            failureMessages: [],
            meta: {
              eval: {
                scores: [
                  {
                    score: 0,
                    metadata: {
                      split: "test",
                      rationale: "wrong\nproduct",
                      feedback: "clarify the tool",
                      toolErrors: 1,
                    },
                  },
                ],
              },
            },
          },
          {
            ancestorTitles: ["model-b"],
            title: "setup",
            status: "failed",
            failureMessages: ["request\ntimeout"],
          },
        ],
      },
    ],
  };

  assert.equal(agentReportSchema.safeParse(report).success, true);
  assert.equal(
    agentReportSchema.safeParse({ testResults: [{ assertionResults: [{}] }] }).success,
    false,
  );
  const directory = mkdtempSync(join(tmpdir(), "agent-summary-test-"));

  try {
    writeFileSync(join(directory, "agent-example.json"), JSON.stringify(report));

    const result = spawnSync(
      process.execPath,
      [new URL("./eval-agent-summary.mjs", import.meta.url).pathname, directory],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("| model-a | 1/1 | 0/1 | 1.0 | 1 | 100 |"));
    assert.ok(result.stdout.includes("**model-a / eggs**: wrong product"));
    assert.ok(result.stdout.includes("**model-b / setup** errored: request timeout"));
    assert.ok(result.stdout.includes("model-a / eggs: clarify the tool"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
