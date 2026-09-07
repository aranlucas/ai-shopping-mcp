import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithReadRetry } from "../../src/utils/fetch.js";

afterEach(() => vi.unstubAllGlobals());

describe("selective read retry", () => {
  it("retries a transient read once", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const response = await fetchWithReadRetry(new Request("https://gateway.example/pantry"));
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "never repeats %s on upstream failure",
    async (method) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
      vi.stubGlobal("fetch", fetcher);
      expect(
        (await fetchWithReadRetry(new Request("https://gateway.example/cart", { method }))).status,
      ).toBe(503);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("does not override Retry-After", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", fetcher);
    await fetchWithReadRetry(new Request("https://gateway.example/pantry"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cancels before a delayed retry", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort(new Error("request cancelled"));
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      fetchWithReadRetry(
        new Request("https://gateway.example/pantry", { signal: controller.signal }),
      ),
    ).rejects.toThrow("request cancelled");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
