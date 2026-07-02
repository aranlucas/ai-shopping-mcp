/**
 * Semantic match ranking for `shop_for_items`. `pickBestMatch` (src/tools/shop.ts)
 * takes the first pickup-available result of a keyword search, so a loose term
 * like "milk" can match a milk-chocolate bar ahead of an actual milk product.
 * This module re-orders a term's candidate products best-match-first using
 * Workers AI embeddings (`@cf/baai/bge-small-en-v1.5`), cosine similarity
 * between the query and `description + brand + size`, with a small boost for
 * pickup-available items so availability still matters.
 *
 * Hard invariant: this must never throw and never block for long. Any error,
 * timeout, missing binding, or malformed response falls back to returning the
 * products in their original order — the caller's existing heuristic
 * (`pickBestMatch`) still runs on the result either way.
 *
 * See docs/small-model-efficiency-plan.md, "Server-side AI" items 8-9.
 */
import * as z from "zod/v4";

import type { components as ProductComponents } from "./kroger/product.js";

import { safeJsonParseWithSchema } from "../utils/json.js";

type Product = ProductComponents["schemas"]["products.productModel"];

const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5" as const;
const EMBEDDING_TIMEOUT_MS = 1500;
const EMBEDDING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const PICKUP_SCORE_BOOST = 0.05;

const embeddingVectorSchema = z.array(z.number());
const embeddingResponseSchema = z.object({
  data: z.array(embeddingVectorSchema),
});

type EmbeddingVector = z.infer<typeof embeddingVectorSchema>;
type EmbeddingCacheEntry = { text: string; embedding: EmbeddingVector };

/**
 * Narrow structural type for just the Workers AI embedding call used here.
 * The response is intentionally parsed from `unknown` below because the
 * fallback invariant is runtime-critical: malformed AI output must never
 * escape this module.
 */
export type EmbeddingAi = {
  run(model: typeof EMBEDDING_MODEL, options: { text: string[] }): Promise<unknown>;
};

/**
 * Minimal KV surface the embedding cache needs, mirroring the `KvLike`
 * pattern used elsewhere for the product-search and weekly-deals caches
 * (src/tools/product.ts, src/tools/weekly-deals.ts) so callers can pass the
 * same `env.USER_DATA_KV`-derived binding through without adapting it.
 */
export type EmbeddingKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void>;
};

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime type guard so `env.AI` can be narrowed to `EmbeddingAi`. */
export function isEmbeddingAiLike(value: unknown): value is EmbeddingAi {
  return isRecord(value) && typeof value.run === "function";
}

function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`match-ranker timed out after ${ms}ms`)), ms);
  });
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildEmbeddingCacheKey(hash: string): string {
  return `embed|v1|bge-small|${hash}`;
}

function parseEmbeddingResponse(value: unknown): EmbeddingVector[] | null {
  const parsed = embeddingResponseSchema.safeParse(value);
  return parsed.success ? parsed.data.data : null;
}

function parseCachedEmbedding(raw: string): EmbeddingVector | null {
  return safeJsonParseWithSchema(raw, embeddingVectorSchema).match(
    (embedding) => embedding,
    () => null,
  );
}

function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Text embedded for a candidate product: description + brand + primary size. */
function productEmbeddingText(product: Product): string {
  const size = product.items?.[0]?.size ?? "";
  return `${product.description ?? ""} ${product.brand ?? ""} ${size}`.trim();
}

function hasPickup(product: Product): boolean {
  const item = product.items?.[0];
  return Boolean(item?.fulfillment?.curbside || item?.fulfillment?.instore);
}

/**
 * Reads cached embeddings (keyed by SHA-256 of the text) for as many `texts`
 * as are present in KV. Cache misses are simply absent from the returned map
 * — callers batch-embed whatever's left.
 */
async function readCachedEmbeddings(
  kv: EmbeddingKv,
  texts: string[],
): Promise<Map<string, EmbeddingVector>> {
  const cache = new Map<string, EmbeddingVector>();

  await Promise.all(
    texts.map(async (text) => {
      const hash = await sha256Hex(text);
      const raw = await kv.get(buildEmbeddingCacheKey(hash));
      if (!raw) return;
      const embedding = parseCachedEmbedding(raw);
      if (embedding) cache.set(text, embedding);
    }),
  );

  return cache;
}

async function writeCachedEmbeddings(
  kv: EmbeddingKv,
  entries: EmbeddingCacheEntry[],
): Promise<void> {
  await Promise.all(
    entries.map(async ({ text, embedding }) => {
      const hash = await sha256Hex(text);
      try {
        await kv.put(buildEmbeddingCacheKey(hash), JSON.stringify(embedding), {
          expirationTtl: EMBEDDING_CACHE_TTL_SECONDS,
        });
      } catch {
        // Best-effort cache write; a failure here must not fail ranking.
      }
    }),
  );
}

async function rankProductMatchesInner(params: {
  ai: EmbeddingAi;
  kv: EmbeddingKv;
  query: string;
  products: Product[];
}): Promise<Product[]> {
  const { ai, kv, query, products } = params;

  const texts = products.map(productEmbeddingText);
  const cached = await readCachedEmbeddings(kv, texts);

  // Query embeddings are never cached — only unique, uncached product texts
  // plus the query go into the single batched ai.run call below.
  const uncachedTexts = [...new Set(texts.filter((text) => !cached.has(text)))];
  const batchTexts = [query, ...uncachedTexts];

  const raw = await ai.run(EMBEDDING_MODEL, { text: batchTexts });
  const embeddings = parseEmbeddingResponse(raw);
  if (!embeddings || embeddings.length !== batchTexts.length) return products;

  const [queryEmbedding, ...newEmbeddings] = embeddings;

  if (uncachedTexts.length > 0) {
    await writeCachedEmbeddings(
      kv,
      uncachedTexts.map((text, i) => ({ text, embedding: newEmbeddings[i] })),
    );
  }

  const textToEmbedding = new Map(cached);
  uncachedTexts.forEach((text, i) => textToEmbedding.set(text, newEmbeddings[i]));

  const scored = products.map((product, index) => {
    const embedding = textToEmbedding.get(texts[index]);
    const similarity = embedding ? cosineSimilarity(queryEmbedding, embedding) : -Infinity;
    const score = hasPickup(product) ? similarity + PICKUP_SCORE_BOOST : similarity;
    return { product, score, index };
  });

  // Stable sort descending by score; ties keep original order via the index tiebreak.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.map((entry) => entry.product);
}

/**
 * Ranks `products` best-match-first against `query` using embedding cosine
 * similarity, with a small boost for pickup-available items. Falls back to
 * the original product order (untouched) on any error, timeout (~1.5s),
 * missing `ai`/`kv`, or a malformed embedding response — never throws.
 */
export async function rankProductMatches(params: {
  ai: EmbeddingAi;
  kv: EmbeddingKv;
  query: string;
  products: Product[];
}): Promise<Product[]> {
  const { ai, kv, query, products } = params;
  if (products.length === 0) return products;

  try {
    return await Promise.race([
      rankProductMatchesInner({ ai, kv, query, products }),
      rejectAfter(EMBEDDING_TIMEOUT_MS),
    ]);
  } catch (e) {
    console.warn(
      "rankProductMatches: falling back to original order (non-fatal):",
      e instanceof Error ? e.message : String(e),
    );
    return products;
  }
}
