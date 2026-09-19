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
  return { GET: get } as unknown as KrogerClients["productClient"];
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
});
