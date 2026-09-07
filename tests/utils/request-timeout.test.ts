import createClient from "openapi-fetch";
import { describe, expect, it } from "vitest";
import type { paths } from "../../src/services/gateway/schema.js";
import { requestTimeoutMiddleware } from "../../src/utils/request-timeout.js";

describe("request deadlines", () => {
  it("aborts a stalled request and creates an independent deadline for the next request", async () => {
    const signals: AbortSignal[] = [];
    const client = createClient<paths>({
      baseUrl: "https://gateway.example",
      fetch: async (request) => {
        signals.push(request.signal);
        if (signals.length > 1) return Response.json({ items: [] });
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
    });
    client.use(requestTimeoutMiddleware(undefined, 10));
    await expect(client.GET("/api/grocery/pantry")).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(client.GET("/api/grocery/pantry")).resolves.toMatchObject({ data: { items: [] } });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    const client = createClient<paths>({
      baseUrl: "https://gateway.example",
      fetch: async (request) => {
        request.signal.throwIfAborted();
        return Response.json({ items: [] });
      },
    });
    client.use(requestTimeoutMiddleware(controller.signal));
    await expect(client.GET("/api/grocery/pantry")).rejects.toThrow("caller cancelled");
  });
});
