import { describe, expect, it } from "vitest";

import type { Props, ToolContext } from "../../src/tools/types.js";

import { errorResult, textResult } from "../../src/tools/types.js";

// ----- getUser -----

describe("getUser", () => {
  it("returns null when not authenticated", () => {
    const ctx = {
      getUser: () => null,
    } as unknown as ToolContext;

    expect(ctx.getUser()).toBeNull();
  });

  it("returns props when authenticated", () => {
    const props: Props = {
      id: "user-123",
      accessToken: "token",
      tokenExpiresAt: Date.now(),
    };
    const ctx = {
      getUser: () => props,
    } as unknown as ToolContext;

    expect(ctx.getUser()).toEqual(props);
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
