import { describe, expect, it, vi } from "vitest";

import { withMcpOriginProtection } from "../../src/utils/mcp-security.js";

const BASE_URL = "https://worker.test/mcp";

function makeHandler() {
  return { fetch: vi.fn().mockResolvedValue(new Response("ok")) };
}

describe("withMcpOriginProtection", () => {
  describe("allowed requests", () => {
    it("allows requests with no Origin header", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler);

      const response = await wrapped.fetch(new Request(BASE_URL), {}, {} as ExecutionContext);

      expect(response.status).toBe(200);
      expect(handler.fetch).toHaveBeenCalledOnce();
    });

    it("allows requests when Origin matches the request host (same-host)", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler);

      const response = await wrapped.fetch(
        new Request(BASE_URL, {
          headers: { Origin: "https://worker.test" },
        }),
        {},
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(handler.fetch).toHaveBeenCalledOnce();
    });

    it("allows a cross-origin caller listed in allowedOrigins", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler, {
        allowedOrigins: ["https://trusted-client.test"],
      });

      const response = await wrapped.fetch(
        new Request(BASE_URL, {
          headers: { Origin: "https://trusted-client.test" },
        }),
        {},
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(handler.fetch).toHaveBeenCalledOnce();
    });
  });

  describe("blocked requests", () => {
    it("rejects requests with an Origin from a different host", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler);

      const response = await wrapped.fetch(
        new Request(BASE_URL, {
          headers: { Origin: "https://evil.test" },
        }),
        {},
        {} as ExecutionContext,
      );

      expect(response.status).toBe(403);
      expect(handler.fetch).not.toHaveBeenCalled();
    });

    it("rejects requests with a malformed Origin header", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler);

      const response = await wrapped.fetch(
        new Request(BASE_URL, {
          headers: { Origin: "not-a-url" },
        }),
        {},
        {} as ExecutionContext,
      );

      expect(response.status).toBe(403);
      expect(handler.fetch).not.toHaveBeenCalled();
    });

    it("does not call the inner handler when the request is blocked", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler);

      await wrapped.fetch(
        new Request(BASE_URL, {
          headers: { Origin: "https://attacker.test" },
        }),
        {},
        {} as ExecutionContext,
      );

      expect(handler.fetch).not.toHaveBeenCalled();
    });

    it("returns a JSON-RPC error envelope on rejection", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler);

      const response = await wrapped.fetch(
        new Request(BASE_URL, {
          headers: { Origin: "https://evil.test" },
        }),
        {},
        {} as ExecutionContext,
      );

      const body = await response.json();
      expect(body).toEqual({
        error: { code: -32000, message: "Forbidden: invalid Origin header" },
        id: null,
        jsonrpc: "2.0",
      });
    });

    it("rejects a cross-origin caller not listed in allowedOrigins", async () => {
      const handler = makeHandler();
      const wrapped = withMcpOriginProtection(handler, {
        allowedOrigins: ["https://trusted-client.test"],
      });

      const response = await wrapped.fetch(
        new Request(BASE_URL, {
          headers: { Origin: "https://other-client.test" },
        }),
        {},
        {} as ExecutionContext,
      );

      expect(response.status).toBe(403);
      expect(handler.fetch).not.toHaveBeenCalled();
    });
  });
});
