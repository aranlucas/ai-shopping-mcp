import { describe, expect, it } from "vitest";

import { getSessionScopedUserId, textResult } from "../../src/tools/types.js";

// ----- getSessionScopedUserId -----

describe("getSessionScopedUserId", () => {
  it("combines user and session identifiers into a namespaced key", () => {
    expect(getSessionScopedUserId("user-123", "session-456")).toBe("user-123:session:session-456");
  });

  it("produces distinct keys for different sessions of the same user", () => {
    const key1 = getSessionScopedUserId("user-abc", "sess-1");
    const key2 = getSessionScopedUserId("user-abc", "sess-2");
    expect(key1).not.toBe(key2);
  });

  it("produces distinct keys for different users in the same session", () => {
    const key1 = getSessionScopedUserId("user-a", "shared-session");
    const key2 = getSessionScopedUserId("user-b", "shared-session");
    expect(key1).not.toBe(key2);
  });

  it("always includes the literal :session: separator", () => {
    const key = getSessionScopedUserId("u", "s");
    expect(key).toContain(":session:");
  });

  it("preserves user id as a prefix so keys can be grouped by user", () => {
    const userId = "user-xyz";
    const key = getSessionScopedUserId(userId, "some-session");
    expect(key.startsWith(userId)).toBe(true);
  });
});

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
