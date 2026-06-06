import { describe, expect, it } from "vitest";

import { errorResult, getSessionScopedUserId, textResult } from "../../src/tools/types.js";

// ----- getSessionScopedUserId -----

describe("getSessionScopedUserId", () => {
  it("combines user and session identifiers", () => {
    expect(getSessionScopedUserId("user-123", "session-456")).toBe("user-123:session:session-456");
  });
});

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
