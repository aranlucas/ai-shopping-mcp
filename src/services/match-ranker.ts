/**
 * Semantic match ranking for `shop_for_items`. `pickBestMatch` (src/tools/shop.ts)
 * takes the first pickup-available result of a keyword search, so a loose term
 * like "milk" can match a milk-chocolate bar ahead of an actual milk product.
 * This module re-orders a term's candidate products best-match-first using
 * Cloudflare Workers AI's BGE reranker, then applies deterministic availability
 * scoring so in-stock, shoppable products win close calls.
 *
 * Hard invariant: this must never throw and never block for long. Any AI
 * error, timeout, or malformed response falls back to returning the products
 * in their original order — the caller's existing heuristic (`pickBestMatch`)
 * still runs on the result either way.
 *
 * See docs/small-model-efficiency-plan.md, "Server-side AI" items 8-9.
 */
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { components as ProductComponents } from "./kroger/product.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type ProductItem = NonNullable<Product["items"]>[number];
type StockLevel = NonNullable<NonNullable<ProductItem["inventory"]>["stockLevel"]>;

const RERANKER_MODEL = "@cf/baai/bge-reranker-base" as const;
const RERANKER_TIMEOUT_MS = 1500;

const STOCK_SCORE: Record<StockLevel, number> = {
  HIGH: 0.12,
  LOW: 0.04,
  TEMPORARILY_OUT_OF_STOCK: -0.4,
};
const CURBSIDE_SCORE = 0.08;
const INSTORE_SCORE = 0.04;
const DELIVERY_SCORE = 0.02;

const rerankerResponseSchema = z.object({
  response: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      score: z.number(),
    }),
  ),
});

type RankedProduct = {
  product: Product;
  score: number;
  index: number;
};

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`match-ranker timed out after ${ms}ms`)), ms);
  });
}

function primaryItem(product: Product): ProductItem | undefined {
  return product.items?.[0];
}

function availabilityScore(product: Product): number {
  const item = primaryItem(product);
  const stockScore = item?.inventory?.stockLevel ? STOCK_SCORE[item.inventory.stockLevel] : 0;
  const fulfillment = item?.fulfillment;

  return (
    stockScore +
    (fulfillment?.curbside ? CURBSIDE_SCORE : 0) +
    (fulfillment?.instore ? INSTORE_SCORE : 0) +
    (fulfillment?.delivery ? DELIVERY_SCORE : 0)
  );
}

/** Compact context text passed to the reranker for a candidate product. */
function productContextText(product: Product): string {
  const item = primaryItem(product);
  const parts = [
    product.description,
    product.brand,
    item?.size,
    product.categories?.join(", "),
    item?.price?.promo != null ? `promo=$${item.price.promo}` : undefined,
    item?.price?.regular != null ? `regular=$${item.price.regular}` : undefined,
    `stock=${item?.inventory?.stockLevel ?? "unknown"}`,
    `curbside=${Boolean(item?.fulfillment?.curbside)}`,
    `instore=${Boolean(item?.fulfillment?.instore)}`,
    `delivery=${Boolean(item?.fulfillment?.delivery)}`,
  ];

  return parts.filter((part) => part && part.length > 0).join(" | ");
}

function parseRerankerResponse(value: unknown): Array<{ id: number; score: number }> | null {
  const parsed = rerankerResponseSchema.safeParse(value);
  return parsed.success ? parsed.data.response : null;
}

async function rankProductMatchesInner(params: {
  ai: Ai;
  query: string;
  products: Product[];
}): Promise<Product[]> {
  const { ai, query, products } = params;

  const contexts = products.map((product) => ({ text: productContextText(product) }));
  // @ts-expect-error Cloudflare's generated reranker type still omits `query`.
  const raw = await ai.run(RERANKER_MODEL, {
    query,
    contexts,
    top_k: products.length,
  });

  const reranked = parseRerankerResponse(raw);
  if (!reranked || reranked.length !== products.length) return products;

  const seen = new Set<number>();
  const scored: RankedProduct[] = [];
  for (const entry of reranked) {
    if (entry.id >= products.length || seen.has(entry.id)) return products;
    seen.add(entry.id);
    const product = products[entry.id];
    scored.push({
      product,
      score: entry.score + availabilityScore(product),
      index: entry.id,
    });
  }

  // Stable sort descending by final score; original index keeps ties deterministic.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.map((entry) => entry.product);
}

/**
 * Ranks `products` best-match-first against `query` using Workers AI's
 * reranker, with deterministic stock and fulfillment scoring layered on top.
 * Falls back to the original product order (untouched) on any error, timeout
 * (~1.5s), or a malformed reranker response — never throws.
 */
export async function rankProductMatches(params: {
  ai: Ai;
  query: string;
  products: Product[];
}): Promise<Product[]> {
  const { ai, query, products } = params;
  if (products.length === 0) return products;

  return ResultAsync.fromPromise(
    Promise.race([
      rankProductMatchesInner({ ai, query, products }),
      rejectAfter(RERANKER_TIMEOUT_MS),
    ]),
    (e) => e,
  )
    .orTee((e) =>
      console.warn(
        "rankProductMatches: falling back to original order (non-fatal):",
        e instanceof Error ? e.message : String(e),
      ),
    )
    .unwrapOr(products);
}
