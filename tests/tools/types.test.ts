import { describe, expect, it } from "vitest";

import { textResult } from "../../src/tools/types.js";

// ----- textResult -----

describe("textResult", () => {
  it("wraps text in MCP content format", () => {
    expect(textResult("hello")).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("sets content type to the literal string 'text'", () => {
    const result = textResult("msg");
    expect(result.content[0].type).toBe("text");
  });

  it("does not set isError on success results", () => {
    const result = textResult("ok");
    expect(result).not.toHaveProperty("isError");
  });

  it("preserves empty string content", () => {
    expect(textResult("")).toEqual({
      content: [{ type: "text", text: "" }],
    });
  });

  it("preserves multiline text without modification", () => {
    const multiline = "line one\nline two\nline three";
    expect(textResult(multiline).content[0].text).toBe(multiline);
  });
});
