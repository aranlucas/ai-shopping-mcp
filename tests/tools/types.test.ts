import { describe, expect, it } from "vitest";

import { errorResult, textResult } from "../../src/tools/types.js";

// ----- textResult / errorResult -----

describe("textResult", () => {
  it("wraps text in MCP content format", () => {
    expect(textResult("hello")).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });
});

describe("errorResult", () => {
  it("wraps text in MCP error format", () => {
    expect(errorResult("bad")).toEqual({
      content: [{ type: "text", text: "bad" }],
      isError: true,
    });
  });
});
