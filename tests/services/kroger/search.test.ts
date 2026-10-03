import { productClientWith } from "../../kroger-clients.js";
import { describe, expect, it, vi } from "vitest";

import type { KrogerClients } from "../../../src/services/kroger/client.js";
import {
  searchProductsForTerms,
  type ProductSearchRequest,
} from "../../../src/services/kroger/search.js";

type SearchResponse = {
  data?: unknown;
  error?: unknown;
  response: Response;
};

type SearchOptions = {
  params: { query?: Record<string, string | number> };
};

type SearchGet = (
  path: string,
  options: SearchOptions,
) => Promise<SearchResponse>;

function productClient(get: SearchGet): KrogerClients["productClient"] {
  return productClientWith(get);
}

const requests: ProductSearchRequest[] = [
  { requestId: "item_0", term: "milk" },
  { requestId: "item_1", term: "unobtainium" },
];

describe("searchProductsForTerms", () => {
  it("keeps request identity and distinguishes an empty success from failure", async () => {
    const get = vi.fn<SearchGet>(async (_path, options) => {
      const term = String(options.params?.query?.["filter.term"] ?? "");

      if (term === "milk") {
        return {
          data: { data: [] },
          response: new Response(null, { status: 200 }),
        };
      }

      return {
        error: { reason: "Unavailable" },
        response: new Response(null, { status: 503 }),
      };
    });

    const results = await searchProductsForTerms(productClient(get), requests, {
      limitPerTerm: 5,
    });

    expect(results).toEqual([
      {
        requestId: "item_0",
        term: "milk",
        status: "success",
        products: [],
      },
      {
        requestId: "item_1",
        term: "unobtainium",
        status: "failed",
        error: expect.objectContaining({ type: "API_ERROR" }),
      },
    ]);
    expect(results[0]).not.toHaveProperty("count");
    expect(results[1]).not.toHaveProperty("products");
  });

  it("passes each request's term and preserves completion progress", async () => {
    const get = vi.fn<SearchGet>(async () => ({
      data: { data: [] },
      response: new Response(null, { status: 200 }),
    }));

    const progress: Array<[number, number]> = [];

    await searchProductsForTerms(
      productClient(get),
      requests,
      { limitPerTerm: 3, locationId: "70500847" },
      (completed, total) => {
        progress.push([completed, total]);
      },
    );

    expect(get).toHaveBeenCalledTimes(2);
    expect(progress).toHaveLength(2);
    expect(progress.map((entry) => entry[1])).toEqual([2, 2]);

    for (const [, options] of get.mock.calls) {
      expect(options.params.query).toMatchObject({
        "filter.locationId": "70500847",
        "filter.fulfillment": "ais",
        "filter.limit": 3,
      });
    }
  });

  it("applies Kroger's term limits: under 3 characters fails alone, over 8 words is trimmed", async () => {
    const get = vi.fn<SearchGet>(async () => ({
      data: { data: [] },
      response: new Response(null, { status: 200 }),
    }));

    const results = await searchProductsForTerms(
      productClient(get),
      [
        { requestId: "a", term: "ox" },
        {
          requestId: "b",
          term: "one two three four five six seven eight nine ten",
        },
      ],
      { limitPerTerm: 5 },
    );

    expect(results[0]).toMatchObject({
      status: "failed",
      error: expect.objectContaining({ type: "VALIDATION_ERROR" }),
    });
    expect(results[1]).toMatchObject({ status: "success" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][1].params.query?.["filter.term"]).toBe(
      "one two three four five six seven eight",
    );
  });
});

describe("text search workload budget", () => {
  it("rejects more than ten requests without contacting the provider", async () => {
    const get = vi.fn<SearchGet>(async () => ({
      data: { data: [] },
      response: new Response(null, { status: 200 }),
    }));

    const input = Array.from({ length: 11 }, (_, index) => ({
      requestId: String(index),
      term: `item ${index}`,
    }));

    const results = await searchProductsForTerms(productClient(get), input, {
      limitPerTerm: 5,
    });

    expect(results).toHaveLength(11);
    expect(
      results.every(
        (result) =>
          result.status === "failed" &&
          result.error.type === "VALIDATION_ERROR",
      ),
    ).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it("limits simultaneous searches to five and keeps input identities", async () => {
    let active = 0;
    let peak = 0;

    const get = vi.fn<SearchGet>(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      active--;

      return {
        data: { data: [] },
        response: new Response(null, { status: 200 }),
      };
    });

    const input = Array.from({ length: 10 }, (_, index) => ({
      requestId: String(index),
      term: `item ${index}`,
    }));

    const results = await searchProductsForTerms(productClient(get), input, {
      limitPerTerm: 20,
    });

    expect(results.map((result) => result.requestId)).toEqual(
      input.map((request) => request.requestId),
    );
    expect(get).toHaveBeenCalledTimes(10);
    expect(peak).toBe(5);
  });
});
