import { describe, expect, it, vi } from "vitest";

import { withMcpOriginProtection } from "../../src/utils/mcp-security.js";

describe("withMcpOriginProtection", () => {
  it("rejects requests with an Origin from a different host", async () => {
    const wrapped = withMcpOriginProtection({
      fetch: vi.fn().mockResolvedValue(new Response("ok")),
    });

    const response = await wrapped.fetch(
      new Request("https://worker.test/mcp", {
        headers: { Origin: "https://evil.test" },
      }),
      {},
      {} as ExecutionContext,
    );

    expect(response.status).toBe(403);
  });

  it("allows requests with no Origin header", async () => {
    const handler = { fetch: vi.fn().mockResolvedValue(new Response("ok")) };
    const wrapped = withMcpOriginProtection(handler);

    const response = await wrapped.fetch(
      new Request("https://worker.test/mcp"),
      {},
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(handler.fetch).toHaveBeenCalledOnce();
  });
});
