import { afterEach, describe, expect, it, vi } from "vitest";
import { selectProductMatches, type SelectorAi } from "../../src/services/product-selector.js";
import { stubJevAi, type JevRun } from "../jev-stub.js";

const candy = { upc: "1", description: "Candy", items: [{ fulfillment: { curbside: true } }] };
const milk = { upc: "2", description: "Milk", items: [{ fulfillment: { curbside: true } }] };

async function selectProductMatch(params: {
  ai: SelectorAi;
  query: string;
  products: Parameters<typeof selectProductMatches>[0]["items"][number]["products"];
  forPickup: boolean;
}) {
  const [selection] = await selectProductMatches({
    ai: params.ai,
    items: [{ query: params.query, products: params.products }],
    forPickup: params.forPickup,
  });
  return selection;
}

function response(choice: string, probabilities: Record<string, number>) {
  return {
    model: "jev-1.13.0",
    answers: { item_0: { type: "choice", choice, confidence: 0.9, probabilities } },
  };
}

describe("Jev product selection", () => {
  afterEach(() => vi.useRealTimers());

  it("batches ten items with twenty candidates each into one inference request", async () => {
    const products = Array.from({ length: 20 }, (_, index) => ({
      ...milk,
      upc: String(index),
      description: `Milk ${index}`,
    }));
    const run = vi.fn<JevRun>(stubJevAi("Milk 19").gateway("default").run);
    const selections = await selectProductMatches({
      ai: { gateway: () => ({ run }) },
      items: Array.from({ length: 10 }, () => ({ query: "milk", products })),
      forPickup: true,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(Object.keys(run.mock.calls[0]?.[0].query.questions ?? {})).toHaveLength(10);
    expect(selections).toEqual(
      Array.from({ length: 10 }, () => ({ status: "selected", product: products[19] })),
    );
  });

  it("maps reordered answers by item ID and preserves empty shortlists and abstentions", async () => {
    const run = vi.fn<JevRun>(async () =>
      Response.json({
        model: "jev-test",
        answers: {
          item_2: response("no_match", { candidate_0: 0, no_match: 1, needs_review: 0 }).answers
            .item_0,
          item_1: response("candidate_0", { candidate_0: 1, no_match: 0, needs_review: 0 }).answers
            .item_0,
        },
      }),
    );
    const selections = await selectProductMatches({
      ai: { gateway: () => ({ run }) },
      items: [
        { query: "milk", products: [] },
        { query: "milk", products: [milk] },
        { query: "milk", products: [candy] },
      ],
      forPickup: true,
    });
    expect(selections).toEqual([
      { status: "unresolved" },
      { status: "selected", product: milk },
      { status: "unresolved" },
    ]);
    expect(Object.keys(run.mock.calls[0]?.[0].query.questions ?? {})).toEqual(["item_1", "item_2"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "unexpected"])("rejects a batch with a %s answer", async (failure) => {
    const answer = response("candidate_0", { candidate_0: 1, no_match: 0, needs_review: 0 }).answers
      .item_0;
    const run = vi.fn<JevRun>(async () =>
      Response.json({
        model: "jev-test",
        answers: failure === "missing" ? { item_0: answer } : { item_0: answer, item_9: answer },
      }),
    );
    await expect(
      selectProductMatches({
        ai: { gateway: () => ({ run }) },
        items: [
          { query: "milk", products: [milk] },
          { query: "candy", products: [candy] },
        ],
        forPickup: true,
      }),
    ).rejects.toThrow("Jev must answer exactly the requested item questions");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses Jev on the default gateway and preserves its exact product choice", async () => {
    const stub = stubJevAi("Milk");
    const run = vi.fn<JevRun>(stub.gateway("default").run);
    const gateway = vi.fn<SelectorAi["gateway"]>(() => ({ run }));
    const result = await selectProductMatch({
      ai: { gateway },
      query: "milk",
      products: [candy, milk],
      forPickup: true,
    });
    expect(result).toEqual({ status: "selected", product: milk });
    expect(gateway).toHaveBeenCalledExactlyOnceWith("default");
    expect(run).toHaveBeenCalledExactlyOnceWith(
      {
        provider: "openrouter",
        endpoint: "../alpha/decisions",
        headers: { "Content-Type": "application/json", "cf-aig-max-attempts": "1" },
        query: expect.objectContaining({
          model: "typesafe/jev-1.13",
          state: { items: { item_0: { requestedItem: "milk" } } },
        }),
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it.each(["no_match", "needs_review"])(
    "honors %s without another inference request",
    async (choice) => {
      const run = vi.fn<JevRun>(async () =>
        Response.json(
          response(choice, {
            candidate_0: 0,
            no_match: choice === "no_match" ? 1 : 0,
            needs_review: choice === "needs_review" ? 1 : 0,
          }),
        ),
      );
      expect(
        await selectProductMatch({
          ai: { gateway: () => ({ run }) },
          query: "milk",
          products: [candy],
          forPickup: true,
        }),
      ).toEqual({ status: "unresolved" });
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it("filters out-of-stock, in-store-only, and missing-UPC products for pickup", async () => {
    const products = [
      {
        ...milk,
        items: [
          {
            inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" as const },
            fulfillment: { curbside: true },
          },
        ],
      },
      { ...milk, items: [{ fulfillment: { instore: true, curbside: false } }] },
      { ...milk, upc: undefined },
      milk,
    ];
    const run = vi.fn<JevRun>(stubJevAi().gateway("default").run);
    expect(
      await selectProductMatch({
        ai: { gateway: () => ({ run }) },
        query: "milk",
        products,
        forPickup: true,
      }),
    ).toEqual({ status: "selected", product: milk });
    const input = run.mock.calls[0]?.[0].query;
    expect(JSON.stringify(input)).not.toContain("candidate_1");
  });

  it("does not call Jev for an empty eligible shortlist", async () => {
    const run = vi.fn<JevRun>(stubJevAi().gateway("default").run);
    expect(
      await selectProductMatch({
        ai: { gateway: () => ({ run }) },
        query: "milk",
        products: [],
        forPickup: true,
      }),
    ).toEqual({ status: "unresolved" });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    {},
    response("invented_upc", { invented_upc: 1 }),
    response("candidate_0", { candidate_0: 1 }),
    response("candidate_0", { candidate_0: 0.9, no_match: 0.9, needs_review: 0 }),
    response("candidate_0", { candidate_0: 0.1, no_match: 0.9, needs_review: 0 }),
  ])("rejects malformed or inconsistent responses without fallback", async (raw) => {
    const run = vi.fn<JevRun>(async () => Response.json(raw));
    await expect(
      selectProductMatch({
        ai: { gateway: () => ({ run }) },
        query: "milk",
        products: [milk],
        forPickup: false,
      }),
    ).rejects.toThrow(/.+/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("propagates provider errors without retrying or selecting a product", async () => {
    const run = vi.fn<JevRun>(async () => {
      throw new Error("Provider unavailable");
    });
    await expect(
      selectProductMatch({
        ai: { gateway: () => ({ run }) },
        query: "milk",
        products: [milk],
        forPickup: false,
      }),
    ).rejects.toThrow("Provider unavailable");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects HTTP errors without retrying or selecting a product", async () => {
    const run = vi.fn<JevRun>(async () => new Response("Provider unavailable", { status: 503 }));
    await expect(
      selectProductMatch({
        ai: { gateway: () => ({ run }) },
        query: "milk",
        products: [milk],
        forPickup: false,
      }),
    ).rejects.toThrow("Jev request failed with HTTP 503");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("aborts and rejects after the deadline even when the binding ignores cancellation", async () => {
    vi.useFakeTimers();
    const run = vi.fn<JevRun>(() => new Promise(() => {}));
    // oxlint-disable-next-line vitest/valid-expect -- attach the rejection handler before advancing fake time; awaited below
    const pending = expect(
      selectProductMatch({
        ai: { gateway: () => ({ run }) },
        query: "milk",
        products: [milk],
        forPickup: false,
      }),
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(run.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
