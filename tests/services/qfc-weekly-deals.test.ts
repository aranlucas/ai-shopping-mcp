import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { components as ProductComponents } from "../../src/services/kroger/product.js";
import type {
  NormalizedWeeklyDeal,
  ProductSearchFn,
} from "../../src/services/qfc-weekly-deals.js";
import { getQfcWeeklyDeals } from "../../src/services/qfc-weekly-deals.js";

type KrogerProduct = ProductComponents["schemas"]["products.productModel"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockOkResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function mockErrorResponse(status: number, data: unknown = {}) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

/** Build a minimal Kroger product with optional pricing. */
function makeProduct(opts: {
  productId?: string;
  description?: string;
  regular?: number;
  promo?: number;
  categories?: string[];
  size?: string;
}): KrogerProduct {
  return {
    productId: opts.productId ?? "0001111041700",
    description: opts.description ?? "Test Product",
    brand: "Kroger",
    categories: opts.categories ?? ["Produce"],
    items: [
      {
        itemId: opts.productId ?? "0001111041700",
        size: opts.size ?? "1 lb",
        price: {
          regular: opts.regular,
          promo: opts.promo,
        },
      },
    ],
    images: [
      {
        default: true,
        perspective: "front",
        sizes: [{ size: "medium", url: "https://example.com/img/product.jpg" }],
      },
    ],
  };
}

/** Build a DACS mapConfig JSON string. */
function makeMapConfig(
  id: number,
  headline: string,
  bodyCopy?: string | null,
  imageURL?: string | null,
) {
  return JSON.stringify({
    content: {
      id,
      headline,
      bodyCopy: bodyCopy ?? null,
      imageURL: imageURL ?? null,
    },
  });
}

const now = Date.now();

const MOCK_PRINT_CIRCULAR = {
  id: "circ-print-1",
  eventId: "evt-print-1",
  eventName: "QFC Weekly Ad",
  eventStartDate: new Date(now - 3 * 86_400_000).toISOString(),
  eventEndDate: new Date(now + 4 * 86_400_000).toISOString(),
  divisionCode: "705",
  divisionName: "QFC",
  week: "2026-02-19",
  previewCircular: false,
  timezone: "America/Los_Angeles",
  circularType: "print",
  tags: ["CLASSIC_VIEW"],
  description: "Weekly print ad",
  locationId: "70500847",
};

const MOCK_CIRCULARS_RESPONSE = { data: [MOCK_PRINT_CIRCULAR] };

const MOCK_LISTING_RESPONSE = {
  pages: [{ eventPageId: "page-1", page: "1" }],
  adId: "ad-1",
  adTitle: "QFC Weekly Ad",
};

const MOCK_PAGE_RESPONSE = {
  eventPageId: "page-1",
  contents: [
    {
      contentType: "Offer",
      mapConfig: makeMapConfig(101, "Fresh Strawberries", "1 lb"),
    },
    {
      contentType: "Offer",
      mapConfig: makeMapConfig(102, "Boneless Chicken Breast", "per lb"),
    },
    // Non-offer content should be ignored
    { contentType: "Banner", mapConfig: makeMapConfig(103, "Store Header") },
  ],
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Configure fetchMock for the happy print-ad path. */
function setupPrintAdFetch() {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes("digitalads/v1/circulars")) {
      return Promise.resolve(mockOkResponse(MOCK_CIRCULARS_RESPONSE));
    }
    if (url.includes(`/api/dacs/evt-print-1?`)) {
      return Promise.resolve(mockOkResponse(MOCK_LISTING_RESPONSE));
    }
    if (url.includes(`/api/dacs/evt-print-1/pages/page-1`)) {
      return Promise.resolve(mockOkResponse(MOCK_PAGE_RESPONSE));
    }
    return Promise.reject(new Error(`Unmocked URL: ${url}`));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getQfcWeeklyDeals", () => {
  describe("print-ad primary path", () => {
    it("returns sourceMode print_fallback and two normalized deals", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({ locationId: "70500847" });

      expect(result.sourceMode).toBe("print_fallback");
      expect(result.locationId).toBe("70500847");
      expect(result.divisionCode).toBe("705");
      expect(result.deals).toHaveLength(2);
    });

    it("normalizes deal titles and source from print-ad offers", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({ locationId: "70500847" });

      const [strawberry, chicken] = result.deals;
      expect(strawberry.title).toBe("Fresh Strawberries");
      expect(strawberry.source).toBe("print");
      expect(strawberry.price).toBe("See print ad");
      expect(strawberry.details).toBe("1 lb");

      expect(chicken.title).toBe("Boneless Chicken Breast");
      expect(chicken.source).toBe("print");
      expect(chicken.price).toBe("See print ad");
    });

    it("sets validFrom and validTill from circular dates", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({ locationId: "70500847" });

      for (const deal of result.deals) {
        expect(deal.validFrom).toBe(MOCK_PRINT_CIRCULAR.eventStartDate);
        expect(deal.validTill).toBe(MOCK_PRINT_CIRCULAR.eventEndDate);
      }
    });

    it("attaches printCircular to response", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({ locationId: "70500847" });

      expect(result.printCircular?.eventId).toBe("evt-print-1");
    });

    it("skips non-Offer content types in print pages", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({ locationId: "70500847" });

      // MOCK_PAGE_RESPONSE has 2 Offers + 1 Banner — only 2 should appear
      expect(result.deals.every((d) => d.title !== "Store Header")).toBe(true);
    });

    it("respects the limit parameter", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        limit: 1,
      });

      expect(result.deals).toHaveLength(1);
    });

    it("deduplicates offers with the same id across pages", async () => {
      // Return the same offer on both pages
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("digitalads/v1/circulars")) {
          return Promise.resolve(mockOkResponse(MOCK_CIRCULARS_RESPONSE));
        }
        if (url.includes("/api/dacs/evt-print-1?")) {
          return Promise.resolve(
            mockOkResponse({
              pages: [
                { eventPageId: "page-1", page: "1" },
                { eventPageId: "page-2", page: "2" },
              ],
            }),
          );
        }
        // Both pages return the same offer id
        if (url.includes("/api/dacs/evt-print-1/pages/")) {
          return Promise.resolve(
            mockOkResponse({
              contents: [
                {
                  contentType: "Offer",
                  mapConfig: makeMapConfig(101, "Fresh Strawberries", "1 lb"),
                },
              ],
            }),
          );
        }
        return Promise.reject(new Error(`Unmocked URL: ${url}`));
      });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        pageLimit: 2,
      });

      expect(result.deals.filter((d) => d.id === "101")).toHaveLength(1);
    });

    it("uses default location when none provided", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals();

      expect(result.locationId).toBe("70500847");
    });
  });

  describe("search API augmentation of print deals", () => {
    it("augments a deal with promo price and savings when product has promo", async () => {
      setupPrintAdFetch();
      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockImplementation(async (term: string) => {
          if (term === "Fresh Strawberries") {
            return [
              makeProduct({
                description: "Fresh Strawberries",
                regular: 3.99,
                promo: 1.99,
              }),
            ];
          }
          return [];
        });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      const strawberry = result.deals.find(
        (d) => d.title === "Fresh Strawberries",
      );
      expect(strawberry?.price).toBe("$1.99");
      expect(strawberry?.savings).toContain("Save");
      expect(strawberry?.savings).toContain("$2.00");
      expect(strawberry?.savings).toContain("$3.99");
    });

    it("augments a deal with regular price when product has no promo", async () => {
      setupPrintAdFetch();
      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockImplementation(async (term: string) => {
          if (term === "Boneless Chicken Breast") {
            return [
              makeProduct({
                description: "Boneless Chicken Breast",
                regular: 5.99,
              }),
            ];
          }
          return [];
        });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      const chicken = result.deals.find(
        (d) => d.title === "Boneless Chicken Breast",
      );
      expect(chicken?.price).toBe("$5.99");
      expect(chicken?.savings).toBeUndefined();
    });

    it("leaves price as 'See print ad' when no product match found", async () => {
      setupPrintAdFetch();
      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockResolvedValue([] as KrogerProduct[]);

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      for (const deal of result.deals) {
        expect(deal.price).toBe("See print ad");
      }
    });

    it("counts augmentedCount correctly in meta", async () => {
      setupPrintAdFetch();
      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockImplementation(async (term: string) => {
          // Only augment Fresh Strawberries
          if (term === "Fresh Strawberries") {
            return [makeProduct({ regular: 3.99, promo: 1.99 })];
          }
          return [];
        });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(result.meta?.augmentedCount).toBe(1);
    });

    it("reports augmentedCount of 0 when no deals are matched", async () => {
      setupPrintAdFetch();
      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockResolvedValue([] as KrogerProduct[]);

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(result.meta?.augmentedCount).toBe(0);
    });

    it("skips augmentation and leaves meta.augmentedCount undefined when searchProducts not provided", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({ locationId: "70500847" });

      expect(result.meta?.augmentedCount).toBeUndefined();
      for (const deal of result.deals) {
        expect(deal.price).toBe("See print ad");
      }
    });

    it("prefers a promo-priced product over a regular-only product", async () => {
      setupPrintAdFetch();
      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockImplementation(async (term: string) => {
          if (term === "Fresh Strawberries") {
            return [
              // First result: regular price only
              makeProduct({
                productId: "0000000000001",
                regular: 5.0,
              }),
              // Second result: has promo price
              makeProduct({
                productId: "0000000000002",
                regular: 3.99,
                promo: 1.99,
              }),
            ];
          }
          return [];
        });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      const strawberry = result.deals.find(
        (d) => d.title === "Fresh Strawberries",
      );
      // Should use the promo-priced product, not the first one
      expect(strawberry?.price).toBe("$1.99");
      expect(strawberry?.savings).toBeDefined();
    });

    it("handles search error for an individual deal gracefully", async () => {
      setupPrintAdFetch();
      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));

      // Should not throw — deals returned unchanged with "See print ad"
      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(result.deals).toHaveLength(2);
      for (const deal of result.deals) {
        expect(deal.price).toBe("See print ad");
      }
    });

    it("calls searchProducts with the deal title and correct locationId", async () => {
      setupPrintAdFetch();
      const searchProducts = vi
        .fn<Parameters<ProductSearchFn>, ReturnType<ProductSearchFn>>()
        .mockResolvedValue([]);

      await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      const calledTerms = searchProducts.mock.calls.map((c) => c[0]);
      expect(calledTerms).toContain("Fresh Strawberries");
      expect(calledTerms).toContain("Boneless Chicken Breast");

      for (const call of searchProducts.mock.calls) {
        expect(call[1]).toBe("70500847");
        expect(call[2]).toBe(5); // augmentation uses limit 5
      }
    });
  });

  describe("search API fallback when print-ad fails", () => {
    function setupFailedPrintFetch() {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("digitalads/v1/circulars")) {
          return Promise.resolve(mockOkResponse(MOCK_CIRCULARS_RESPONSE));
        }
        // DACS endpoints fail
        if (url.includes("przone.net")) {
          return Promise.resolve(
            mockErrorResponse(503, { error: "Service Unavailable" }),
          );
        }
        return Promise.reject(new Error(`Unmocked URL: ${url}`));
      });
    }

    it("falls back to search API when print-ad listing returns error", async () => {
      setupFailedPrintFetch();

      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockImplementation(async (term: string) => {
          if (term === "chicken") {
            return [
              makeProduct({
                productId: "0001111000001",
                description: "Rotisserie Chicken",
                regular: 7.99,
                promo: 4.99,
              }),
            ];
          }
          return [];
        });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(result.sourceMode).toBe("search_api");
      expect(result.deals.length).toBeGreaterThan(0);
      expect(result.deals[0].title).toBe("Rotisserie Chicken");
      expect(result.deals[0].source).toBe("search_api");
    });

    it("includes print-ad failure warning in response", async () => {
      setupFailedPrintFetch();

      const searchProducts: ProductSearchFn = vi.fn().mockResolvedValue([
        makeProduct({
          productId: "0001111000001",
          regular: 5.99,
          promo: 3.99,
        }),
      ]);

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(
        result.warnings.some((w) => w.includes("Print-ad parsing failed")),
      ).toBe(true);
    });

    it("filters out search API products without promo pricing", async () => {
      setupFailedPrintFetch();

      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockImplementation(async (term: string) => {
          if (term === "milk") {
            return [
              makeProduct({
                productId: "0001111000001",
                regular: 4.99,
                promo: 2.99,
              }),
              makeProduct({ productId: "0001111000002", regular: 3.99 }), // no promo
            ];
          }
          return [];
        });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(result.deals.every((d) => d.price !== "See print ad")).toBe(true);
      // Only the promo-priced product should appear
      expect(result.deals.some((d) => d.savings?.includes("Save"))).toBe(true);
    });

    it("deduplicates search API results by productId", async () => {
      setupFailedPrintFetch();

      // Return the same productId from two different category searches
      const duplicateProduct = makeProduct({
        productId: "DUPLICATE-001",
        regular: 5.99,
        promo: 3.99,
      });

      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockResolvedValue([duplicateProduct]);

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      const ids = result.deals.map((d) => d.id);
      const unique = new Set(ids);
      expect(ids.length).toBe(unique.size);
    });

    it("correctly prices search API deals with promo savings", async () => {
      setupFailedPrintFetch();

      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockImplementation(async (term: string) => {
          if (term === "beef") {
            return [
              makeProduct({
                productId: "0001111000003",
                description: "Ground Beef",
                regular: 8.99,
                promo: 5.99,
              }),
            ];
          }
          return [];
        });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      const beef = result.deals.find((d) => d.title === "Ground Beef");
      expect(beef?.price).toBe("$5.99");
      expect(beef?.savings).toContain("Save");
      expect(beef?.savings).toContain("$3.00");
    });
  });

  describe("error handling", () => {
    it("throws when print-ad fails and no searchProducts provided", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("digitalads/v1/circulars")) {
          return Promise.resolve(mockOkResponse(MOCK_CIRCULARS_RESPONSE));
        }
        return Promise.resolve(mockErrorResponse(503));
      });

      await expect(
        getQfcWeeklyDeals({ locationId: "70500847" }),
      ).rejects.toThrow();
    });

    it("returns empty deals (not throws) when print-ad fails and search API errors are all caught per-term", async () => {
      // Per-term errors in fetchDealsBySearchApi are swallowed via .catch(() => []),
      // so the overall call succeeds with 0 deals rather than throwing.
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("digitalads/v1/circulars")) {
          return Promise.resolve(mockOkResponse(MOCK_CIRCULARS_RESPONSE));
        }
        return Promise.resolve(mockErrorResponse(503));
      });

      const searchProducts: ProductSearchFn = vi
        .fn()
        .mockRejectedValue(new Error("Auth error"));

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(result.sourceMode).toBe("search_api");
      expect(result.deals).toHaveLength(0);
      expect(
        result.warnings.some((w) => w.includes("Print-ad parsing failed")),
      ).toBe(true);
    });

    it("throws when no print circular is found and no searchProducts provided", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("digitalads/v1/circulars")) {
          // Return circulars without a print type
          return Promise.resolve(
            mockOkResponse({
              data: [
                {
                  ...MOCK_PRINT_CIRCULAR,
                  circularType: "weeklyAd",
                  tags: ["SHOPPABLE"],
                },
              ],
            }),
          );
        }
        return Promise.reject(new Error(`Unmocked URL: ${url}`));
      });

      await expect(
        getQfcWeeklyDeals({ locationId: "70500847" }),
      ).rejects.toThrow();
    });

    it("adds warning but continues when circular fetch fails", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("digitalads/v1/circulars")) {
          return Promise.resolve(mockErrorResponse(500));
        }
        return Promise.reject(new Error(`Unmocked URL: ${url}`));
      });

      // With no circular, we have no printCircular → falls to searchProducts
      const searchProducts: ProductSearchFn = vi.fn().mockResolvedValue([
        makeProduct({
          productId: "0001111000001",
          regular: 3.99,
          promo: 1.99,
        }),
      ]);

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        searchProducts,
      });

      expect(
        result.warnings.some((w) =>
          w.includes("Unable to fetch weekly circulars"),
        ),
      ).toBe(true);
      expect(result.sourceMode).toBe("search_api");
    });
  });

  describe("division code inference", () => {
    it("infers division code from first 3 chars of locationId", async () => {
      setupPrintAdFetch();

      const result = await getQfcWeeklyDeals({ locationId: "70500847" });

      expect(result.divisionCode).toBe("705");
    });

    it("uses explicit divisionCode when provided", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("digitalads/v1/circulars")) {
          return Promise.resolve(mockOkResponse(MOCK_CIRCULARS_RESPONSE));
        }
        if (url.includes("przone.net")) {
          return Promise.resolve(mockOkResponse(MOCK_LISTING_RESPONSE));
        }
        if (url.includes("/pages/")) {
          return Promise.resolve(mockOkResponse(MOCK_PAGE_RESPONSE));
        }
        return Promise.reject(new Error(`Unmocked URL: ${url}`));
      });

      const result = await getQfcWeeklyDeals({
        locationId: "70500847",
        divisionCode: "999",
      });

      expect(result.divisionCode).toBe("999");
    });
  });
});
