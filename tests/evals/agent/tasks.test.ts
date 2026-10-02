import { describe, expect, it } from "vitest";

import { AGENT_TASKS, type AgentOutput } from "./tasks.js";

function emptyOutput(answer: string): AgentOutput {
  return { answer, feedback: "", cart: [], lists: [], pantry: [] };
}

describe("missing-item grading", () => {
  const task = AGENT_TASKS.find((candidate) => candidate.id === "missing-item");

  function missingItemPasses(answer: string): boolean {
    if (!task) throw new Error("Missing training task");
    return task.checks(emptyOutput(answer), [])[1]?.pass ?? false;
  }

  it.each([
    "Kroger returned no products for zzzfrobnut sauce, so I left it out.",
    "No Kroger results came back for zzzfrobnut sauce.",
    "No results for zzzfrobnut sauce.",
    "No matching options for zzzfrobnut sauce.",
    "There was no match for zzzfrobnut sauce.",
    "I couldn't find zzzfrobnut sauce.",
    "I couldn’t locate zzzfrobnut sauce.",
    "I did not find zzzfrobnut sauce.",
    "zzzfrobnut sauce was not found.",
    "zzzfrobnut sauce is unavailable.",
    "zzzfrobnut sauce is out of stock.",
  ])("accepts a missing-item explanation: %s", (answer) => {
    expect(missingItemPasses(answer)).toBe(true);
  });

  it.each([
    "Added bread.",
    "Added bread and zzzfrobnut sauce.",
    "zzzfrobnut sauce is available.",
    "No products for bread. Added zzzfrobnut sauce.",
    "Bread is unavailable; zzzfrobnut sauce is available.",
    "zzzfrobnut sauce is not unavailable.",
    "zzzfrobnut sauce is not out of stock.",
    "No missing products. Added zzzfrobnut sauce.",
  ])("rejects an answer that doesn't report the missing item: %s", (answer) => {
    expect(missingItemPasses(answer)).toBe(false);
  });
});

it("allows read-only product discovery but still detects cart writes", () => {
  const task = AGENT_TASKS.find((candidate) => candidate.id === "use-first");
  if (!task) throw new Error("Missing training task");
  const output = emptyOutput("Use spinach first, then yogurt.");
  const readOnly = task.checks(output, [
    { name: "shop_for_items", status: "ok" },
  ]);
  const write = task.checks(output, [
    { name: "add_shopping_list_to_cart", status: "ok" },
  ]);
  expect(readOnly.find((entry) => entry.name === "made no writes")?.pass).toBe(
    true,
  );
  expect(write.find((entry) => entry.name === "made no writes")?.pass).toBe(
    false,
  );
  const storeWrite = task.checks(output, [
    { name: "set_preferred_store", status: "ok" },
  ]);
  expect(
    storeWrite.find((entry) => entry.name === "made no writes")?.pass,
  ).toBe(false);
});
