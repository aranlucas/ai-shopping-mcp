import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { wrapV2ToolHandler, wrapRawV2ToolHandler } from "./v2-tool-handler.js";

describe("tool test input boundary", () => {
  const config = {
    inputSchema: z
      .object({
        quantity: z.coerce.number().int().min(1).default(1),
        code: z
          .string()
          .trim()
          .transform((value) => value.toUpperCase()),
      })
      .refine((input) => input.code !== "FORBIDDEN", {
        message: "Forbidden code",
      }),
  };

  it("applies defaults, coercions and transformations before invoking the callback", async () => {
    const handler = vi.fn<
      (
        args: Record<string, unknown>,
      ) => Promise<{ content: Array<{ type: string; text: string }> }>
    >(async (_args) => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const call = wrapV2ToolHandler(handler, config);
    await call({ code: " milk " });
    expect(handler.mock.calls[0]?.[0]).toEqual({ quantity: 1, code: "MILK" });
    await call({ code: "eggs", quantity: "2" });
    expect(handler.mock.calls[1]?.[0]).toEqual({ quantity: 2, code: "EGGS" });
  });

  it("rejects invalid input before any callback side effect", async () => {
    const handler = vi.fn<
      (
        args: Record<string, unknown>,
      ) => Promise<{ content: Array<{ type: string; text: string }> }>
    >(async (_args) => ({
      content: [],
    }));
    const call = wrapV2ToolHandler(handler, config);
    await expect(call({ code: "FORBIDDEN" })).rejects.toThrow("Forbidden code");
    await expect(call({ code: "milk", quantity: 0 })).rejects.toThrow(
      "Too small",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("makes raw callback testing an explicit separate choice", async () => {
    const handler = vi.fn<
      (
        args: Record<string, unknown>,
      ) => Promise<{ content: Array<{ type: string; text: string }> }>
    >(async (_args) => ({
      content: [],
    }));
    await wrapRawV2ToolHandler(handler)({ quantity: "unparsed" });
    expect(handler.mock.calls[0]?.[0]).toEqual({ quantity: "unparsed" });
  });
});
