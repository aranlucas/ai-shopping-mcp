import createClient from "openapi-fetch";
import { describe, expect, it } from "vitest";
import type { paths } from "../../src/services/kroger/product.js";
import { requestTimeoutMiddleware } from "../../src/utils/request-timeout.js";

describe("request deadlines", () => {
  it("aborts a stalled request and creates an independent deadline for the next request", async () => {
    const signals: AbortSignal[] = [];
    const client = createClient<paths>({
      baseUrl: "https://api.kroger.com",
      fetch: async (request) => {
        signals.push(request.signal);
        if (signals.length > 1) return Response.json({ data: [] });
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            {
              once: true,
            },
          );
        });
      },
    });
    client.use(requestTimeoutMiddleware(undefined, 10));
    await expect(
      client.GET("/v1/products", {
        params: { query: { "filter.term": "milk" } },
      }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await expect(
      client.GET("/v1/products", {
        params: { query: { "filter.term": "milk" } },
      }),
    ).resolves.toMatchObject({
      data: { data: [] },
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    const client = createClient<paths>({
      baseUrl: "https://api.kroger.com",
      fetch: async (request) => {
        request.signal.throwIfAborted();
        return Response.json({ data: [] });
      },
    });
    client.use(requestTimeoutMiddleware(controller.signal));
    await expect(
      client.GET("/v1/products", {
        params: { query: { "filter.term": "milk" } },
      }),
    ).rejects.toThrow("caller cancelled");
  });
});
