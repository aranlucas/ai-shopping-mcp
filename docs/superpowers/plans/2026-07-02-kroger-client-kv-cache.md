# Kroger Client KV Caching, ProductService, and Enriched Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache Kroger `productClient`/`locationClient` GET responses in Cloudflare KV via a generic client-level middleware, inject a thin `ProductService` through `ToolContext` (DI), and simplify `create_shopping_list` to take `{upc, quantity, notes}` with the display name enriched server-side.

**Architecture:** A new `createKrogerCacheMiddleware(kv, ttlSeconds)` in `src/services/kroger/client.ts`, applied via `.use()` to `productClient`/`locationClient` exactly like the existing auth middleware — caching is transparent to every call site. `ProductService` wraps the now-cached `productClient` with no caching logic of its own, constructed once in `buildServer` and added to `ToolContext` as `ctx.productService`. The bespoke per-term product-search cache in `src/tools/product.ts` is deleted as redundant with the client-level cache.

**Tech Stack:** TypeScript, Cloudflare Workers, `openapi-fetch` middleware, Cloudflare KV, `neverthrow`, Zod v4, Vitest (`@cloudflare/vitest-pool-workers`).

## Global Constraints

- No `any` in TypeScript — use schema types, explicit narrowing, or reusable aliases.
- Use generated OpenAPI schema types directly from `src/services/kroger/*.js`.
- `pnpm test` must pass before any task is considered done; add/update tests for every behavioral change.
- `ToolContext` registration must not require auth context (unaffected by this plan — no tool registration changes touch auth).
- Do not add refresh behavior to `createKrogerAuthMiddleware`; this plan only adds a sibling middleware, it does not modify auth middleware logic.
- Preserve existing storage/formatting helpers instead of introducing parallel implementations (this is why the old product-search cache is deleted rather than left running alongside the new one).

---

## Task 1: Shared KV helper (`src/utils/kv.ts`)

**Files:**

- Create: `src/utils/kv.ts`
- Test: `tests/utils/kv.test.ts`

**Interfaces:**

- Produces: `KvLike` (type, `Pick<KVNamespace, "get" | "put">`), `isKvLike(value: unknown): value is KvLike`, `getUserDataKv(env: Env): KvLike | null`. Later tasks import these instead of the copies currently living in `src/tools/weekly-deals.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/kv.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { getUserDataKv, isKvLike } from "../../src/utils/kv.js";

function makeKv() {
  return {
    get: async () => null,
    put: async () => {},
  };
}

describe("isKvLike", () => {
  it("returns true for an object with get and put methods", () => {
    expect(isKvLike(makeKv())).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isKvLike(undefined)).toBe(false);
  });

  it("returns false for an object missing put", () => {
    expect(isKvLike({ get: async () => null })).toBe(false);
  });

  it("returns false for a non-object", () => {
    expect(isKvLike("not-an-object")).toBe(false);
  });
});

describe("getUserDataKv", () => {
  it("returns the KV binding when present and KV-shaped", () => {
    const kv = makeKv();
    const env = { USER_DATA_KV: kv } as unknown as Env;
    expect(getUserDataKv(env)).toBe(kv);
  });

  it("returns null when USER_DATA_KV is absent", () => {
    const env = {} as unknown as Env;
    expect(getUserDataKv(env)).toBeNull();
  });

  it("returns null when USER_DATA_KV is not KV-shaped", () => {
    const env = { USER_DATA_KV: "not-kv" } as unknown as Env;
    expect(getUserDataKv(env)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/utils/kv.test.ts`
Expected: FAIL — `src/utils/kv.ts` does not exist yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/utils/kv.ts`:

```typescript
/** Minimal KV surface shared by every KV-backed cache in this codebase. */
export type KvLike = Pick<KVNamespace, "get" | "put">;

export function isKvLike(value: unknown): value is KvLike {
  return !!value && typeof value === "object" && "get" in value && "put" in value;
}

/** Resolves the shared user-data KV binding, or null when absent/malformed. */
export function getUserDataKv(env: Env): KvLike | null {
  return isKvLike(env?.USER_DATA_KV) ? env.USER_DATA_KV : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/utils/kv.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/kv.ts tests/utils/kv.test.ts
git commit -m "feat: add shared KvLike/getUserDataKv helper"
```

---

## Task 2: Kroger cache middleware in `client.ts`

**Files:**

- Modify: `src/services/kroger/client.ts`
- Test: `tests/services/kroger/client.test.ts`

**Interfaces:**

- Consumes: `KvLike` from `src/utils/kv.ts` (Task 1).
- Produces: `createKrogerCacheMiddleware(kv: KvLike | null, ttlSeconds: number): Middleware`. `createKrogerClients(getTokenInfo, kv?: KvLike | null): KrogerClients` — `kv` is a new second parameter defaulting to `null`, so every existing single-argument call site keeps compiling and behaving as before (cache disabled). Task 3 passes a real KV through it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/services/kroger/client.test.ts` (after the existing `createKrogerClients` describe block, before end of file). First add the import:

```typescript
import {
  KrogerTokenExpiredError,
  createKrogerAuthMiddleware,
  createKrogerCacheMiddleware,
  createKrogerClients,
  isKrogerTokenExpiring,
  refreshKrogerToken,
} from "../../../src/services/kroger/client.js";
```

Then append:

```typescript
// ----- createKrogerCacheMiddleware -----

describe("createKrogerCacheMiddleware", () => {
  function makeMockKv(initialData: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(initialData));
    return {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      put: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      store,
    };
  }

  function makeRequestParams(request: Request) {
    return {
      request,
      schemaPath: "/v1/products/{id}",
      params: {},
      options: {} as never,
      id: "test",
    };
  }

  function makeResponseParams(request: Request, response: Response) {
    return {
      request,
      response,
      schemaPath: "/v1/products/{id}",
      params: {},
      options: {} as never,
      id: "test",
    };
  }

  it("onRequest returns undefined on a cache miss", async () => {
    const kv = makeMockKv();
    const middleware = createKrogerCacheMiddleware(kv, 600);
    const request = new Request("https://api.kroger.com/v1/products/0001111041700");

    const result = await middleware.onRequest?.(makeRequestParams(request));

    expect(result).toBeUndefined();
    expect(kv.get).toHaveBeenCalledWith(
      "kroger-cache|v1|https://api.kroger.com/v1/products/0001111041700",
    );
  });

  it("onRequest returns a reconstructed Response on a cache hit", async () => {
    const url = "https://api.kroger.com/v1/products/0001111041700";
    const kv = makeMockKv({
      [`kroger-cache|v1|${url}`]: JSON.stringify({
        status: 200,
        body: '{"data":{"upc":"0001111041700"}}',
      }),
    });
    const middleware = createKrogerCacheMiddleware(kv, 600);
    const request = new Request(url);

    const result = await middleware.onRequest?.(makeRequestParams(request));

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { upc: "0001111041700" } });
  });

  it("onRequest never reads the cache for non-GET requests", async () => {
    const kv = makeMockKv();
    const middleware = createKrogerCacheMiddleware(kv, 600);
    const request = new Request("https://api.kroger.com/v1/cart/add", { method: "PUT" });

    const result = await middleware.onRequest?.(makeRequestParams(request));

    expect(result).toBeUndefined();
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("onRequest is a no-op when kv is null", async () => {
    const middleware = createKrogerCacheMiddleware(null, 600);
    const request = new Request("https://api.kroger.com/v1/products/0001111041700");

    const result = await middleware.onRequest?.(makeRequestParams(request));

    expect(result).toBeUndefined();
  });

  it("onResponse caches a successful GET response", async () => {
    const kv = makeMockKv();
    const middleware = createKrogerCacheMiddleware(kv, 600);
    const request = new Request("https://api.kroger.com/v1/products/0001111041700");
    const response = new Response('{"data":{"upc":"0001111041700"}}', { status: 200 });

    await middleware.onResponse?.(makeResponseParams(request, response));

    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value, options] = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      { expirationTtl: number },
    ];
    expect(key).toBe("kroger-cache|v1|https://api.kroger.com/v1/products/0001111041700");
    expect(JSON.parse(value)).toEqual({ status: 200, body: '{"data":{"upc":"0001111041700"}}' });
    expect(options.expirationTtl).toBe(600);
  });

  it("onResponse does not cache a non-GET response", async () => {
    const kv = makeMockKv();
    const middleware = createKrogerCacheMiddleware(kv, 600);
    const request = new Request("https://api.kroger.com/v1/cart/add", { method: "PUT" });
    const response = new Response(null, { status: 204 });

    await middleware.onResponse?.(makeResponseParams(request, response));

    expect(kv.put).not.toHaveBeenCalled();
  });

  it("onResponse does not cache a non-ok GET response", async () => {
    const kv = makeMockKv();
    const middleware = createKrogerCacheMiddleware(kv, 600);
    const request = new Request("https://api.kroger.com/v1/products/0009999999999");
    const response = new Response('{"error":"not found"}', { status: 500 });

    await middleware.onResponse?.(makeResponseParams(request, response));

    expect(kv.put).not.toHaveBeenCalled();
  });

  it("onResponse is a no-op when kv is null", async () => {
    const middleware = createKrogerCacheMiddleware(null, 600);
    const request = new Request("https://api.kroger.com/v1/products/0001111041700");
    const response = new Response('{"data":{}}', { status: 200 });

    // Should not throw even though there's no kv to write to.
    await expect(
      middleware.onResponse?.(makeResponseParams(request, response)),
    ).resolves.toBeUndefined();
  });

  it("a malformed cache entry is treated as a miss", async () => {
    const url = "https://api.kroger.com/v1/products/0001111041700";
    const kv = makeMockKv({ [`kroger-cache|v1|${url}`]: "{not-valid-json" });
    const middleware = createKrogerCacheMiddleware(kv, 600);
    const request = new Request(url);

    const result = await middleware.onRequest?.(makeRequestParams(request));

    expect(result).toBeUndefined();
  });
});

// ----- createKrogerClients cache wiring -----

describe("createKrogerClients cache wiring", () => {
  it("defaults to no caching when kv is omitted", async () => {
    const { productClient } = createKrogerClients(() => ({
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    }));

    const getSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"data":{}}', { status: 200 }));

    await productClient.GET("/v1/products/{id}", { params: { path: { id: "0001111041700" } } });
    await productClient.GET("/v1/products/{id}", { params: { path: { id: "0001111041700" } } });

    expect(getSpy).toHaveBeenCalledTimes(2);
    getSpy.mockRestore();
  });

  it("caches repeated productClient GETs when kv is provided", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    const { productClient } = createKrogerClients(
      () => ({ accessToken: "token", tokenExpiresAt: Date.now() + 30 * 60 * 1000 }),
      kv,
    );

    const getSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"data":{"upc":"0001111041700"}}', { status: 200 }));

    const first = await productClient.GET("/v1/products/{id}", {
      params: { path: { id: "0001111041700" } },
    });
    const second = await productClient.GET("/v1/products/{id}", {
      params: { path: { id: "0001111041700" } },
    });

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(first.data).toEqual({ upc: "0001111041700" });
    expect(second.data).toEqual({ upc: "0001111041700" });
    getSpy.mockRestore();
  });

  it("does not cache cartClient requests even when kv is provided", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    const { cartClient } = createKrogerClients(
      () => ({ accessToken: "token", tokenExpiresAt: Date.now() + 30 * 60 * 1000 }),
      kv,
    );

    const getSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await cartClient.PUT("/v1/cart/add", { body: { items: [] } });

    expect(store.size).toBe(0);
    getSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/services/kroger/client.test.ts`
Expected: FAIL — `createKrogerCacheMiddleware` is not exported from `src/services/kroger/client.js`, and `createKrogerClients` doesn't accept a second argument.

- [ ] **Step 3: Implement the middleware and wire it into `createKrogerClients`**

In `src/services/kroger/client.ts`, add the import and a new schema/type near the top (after the existing imports):

```typescript
import * as z from "zod/v4";

import type { KvLike } from "../../utils/kv.js";

import { safeJsonParseWithSchema } from "../../utils/json.js";
```

Add this block after `createKrogerAuthMiddleware` and before `createKrogerClients`:

```typescript
const KROGER_CACHE_TTL_SECONDS = 600;

type KrogerCacheEntry = { status: number; body: string };

const krogerCacheEntrySchema = z.object({
  status: z.number(),
  body: z.string(),
});

function krogerCacheKeyFor(url: string): string {
  return `kroger-cache|v1|${url}`;
}

/**
 * Generic KV-cache middleware for Kroger GET responses, structured like
 * `createKrogerAuthMiddleware`. Only GET requests are ever read from or
 * written to cache; only 2xx responses are cached. KV read/write failures
 * are non-fatal — a read failure falls through to a live request, a write
 * failure is logged and swallowed.
 */
export function createKrogerCacheMiddleware(kv: KvLike | null, ttlSeconds: number): Middleware {
  return {
    async onRequest({ request }) {
      if (!kv || request.method !== "GET") return;

      let raw: string | null;
      try {
        raw = await kv.get(krogerCacheKeyFor(request.url));
      } catch {
        return;
      }
      if (!raw) return;

      const entry = safeJsonParseWithSchema(raw, krogerCacheEntrySchema).match(
        (value): KrogerCacheEntry => value,
        () => null,
      );
      if (!entry) return;

      return new Response(entry.body, {
        status: entry.status,
        headers: { "content-type": "application/json" },
      });
    },

    async onResponse({ request, response }) {
      if (!kv || request.method !== "GET" || !response.ok) return;

      const body = await response.clone().text();
      const entry: KrogerCacheEntry = { status: response.status, body };

      try {
        await kv.put(krogerCacheKeyFor(request.url), JSON.stringify(entry), {
          expirationTtl: ttlSeconds,
        });
      } catch (e) {
        console.warn(
          "Kroger response cache write failed (non-fatal):",
          e instanceof Error ? e.message : String(e),
        );
      }
    },
  };
}
```

Update `createKrogerClients`:

```typescript
/**
 * Creates all Kroger API clients with authentication middleware applied.
 * Returns fresh client instances — no global mutable state.
 *
 * `productClient` and `locationClient` also get the KV-cache middleware:
 * their GET responses aren't user-specific, so sharing a cache across users
 * is the point. `cartClient`/`identityClient` are deliberately excluded —
 * the cache has no per-user scoping, and caching a future GET on either
 * would leak one user's data to another.
 */
export function createKrogerClients(
  getTokenInfo: () => KrogerTokenInfo | null,
  kv: KvLike | null = null,
) {
  const authMiddleware = createKrogerAuthMiddleware(getTokenInfo);
  const cacheMiddleware = createKrogerCacheMiddleware(kv, KROGER_CACHE_TTL_SECONDS);
  const base = { baseUrl: "https://api.kroger.com" };

  const cartClient = createClient<CartPaths>(base);
  const identityClient = createClient<IdentityPaths>(base);
  const locationClient = createClient<LocationPaths>(base);
  const productClient = createClient<ProductPaths>(base);

  cartClient.use(authMiddleware);
  identityClient.use(authMiddleware);
  locationClient.use(authMiddleware);
  productClient.use(authMiddleware);

  locationClient.use(cacheMiddleware);
  productClient.use(cacheMiddleware);

  return { cartClient, identityClient, locationClient, productClient };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/services/kroger/client.test.ts`
Expected: PASS (all tests including the pre-existing ones)

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/services/kroger/client.ts tests/services/kroger/client.test.ts
git commit -m "feat: add KV-cache middleware for productClient/locationClient GETs"
```

---

## Task 3: `ProductService`

**Files:**

- Create: `src/services/kroger/product-service.ts`
- Test: `tests/services/kroger/product-service.test.ts`

**Interfaces:**

- Consumes: `KrogerClients["productClient"]` (unchanged shape from Task 2), `fromApiResponse` from `src/utils/result.ts`, `notFoundError`/`AppError` from `src/errors.ts`.
- Produces: `class ProductService { constructor(productClient); getProduct(upc: string, locationId?: string): ResultAsync<Product, AppError>; enrichProductName(upc: string, locationId?: string): Promise<string | null>; }` where `Product = ProductComponents["schemas"]["products.productModel"]`. Task 4 adds this to `ToolContext`; Tasks 6/7/10 consume it.

- [ ] **Step 1: Write the failing tests**

Create `tests/services/kroger/product-service.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import type { KrogerClients } from "../../../src/services/kroger/client.js";
import type { components as ProductComponents } from "../../../src/services/kroger/product.js";

import { ProductService } from "../../../src/services/kroger/product-service.js";

type Product = ProductComponents["schemas"]["products.productModel"];

function stubProductClient(
  get: (...args: unknown[]) => Promise<{ data?: unknown; error?: unknown; response: Response }>,
): KrogerClients["productClient"] {
  return { GET: get } as unknown as KrogerClients["productClient"];
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    upc: "0001111041700",
    description: "Kroger 2% Reduced Fat Milk",
    brand: "Kroger",
    ...overrides,
  };
}

describe("ProductService.getProduct", () => {
  it("returns Ok with the product on a successful lookup", async () => {
    const product = makeProduct();
    const get = vi.fn(async () => ({
      data: { data: product },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    const result = await service.getProduct("0001111041700");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(product);
  });

  it("passes locationId as filter.locationId when provided", async () => {
    const get = vi.fn(async () => ({
      data: { data: makeProduct() },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    await service.getProduct("0001111041700", "70500847");

    const [, opts] = get.mock.calls[0] as [string, { params: { query: Record<string, string> } }];
    expect(opts.params.query["filter.locationId"]).toBe("70500847");
  });

  it("returns Err NOT_FOUND when the API returns no product data", async () => {
    const get = vi.fn(async () => ({
      data: { data: undefined },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    const result = await service.getProduct("0009999999999");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("NOT_FOUND");
    expect(result._unsafeUnwrapErr().message).toContain("0009999999999");
  });

  it("returns Err API_ERROR when the API call fails", async () => {
    const get = vi.fn(async () => ({
      error: { reason: "Internal Server Error" },
      response: new Response(null, { status: 500 }),
    }));
    const service = new ProductService(stubProductClient(get));

    const result = await service.getProduct("0001111041700");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("API_ERROR");
  });
});

describe("ProductService.enrichProductName", () => {
  it("returns the product description on success", async () => {
    const get = vi.fn(async () => ({
      data: { data: makeProduct({ description: "Whole Milk" }) },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0001111041700")).toBe("Whole Milk");
  });

  it("returns null when the product has no description", async () => {
    const get = vi.fn(async () => ({
      data: { data: makeProduct({ description: undefined }) },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0001111041700")).toBeNull();
  });

  it("returns null (never throws) when the lookup fails", async () => {
    const get = vi.fn(async () => ({
      error: { reason: "boom" },
      response: new Response(null, { status: 500 }),
    }));
    const service = new ProductService(stubProductClient(get));

    await expect(service.enrichProductName("0001111041700")).resolves.toBeNull();
  });

  it("returns null when the product is not found", async () => {
    const get = vi.fn(async () => ({
      data: { data: undefined },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0009999999999")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/services/kroger/product-service.test.ts`
Expected: FAIL — `src/services/kroger/product-service.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/services/kroger/product-service.ts`:

```typescript
import { type ResultAsync, err, ok } from "neverthrow";

import type { AppError } from "../../errors.js";
import type { components as ProductComponents } from "./product.js";
import type { KrogerClients } from "./client.js";

import { notFoundError } from "../../errors.js";
import { fromApiResponse } from "../../utils/result.js";

type Product = ProductComponents["schemas"]["products.productModel"];

/**
 * Thin wrapper around `productClient.GET("/v1/products/{id}")`. No caching
 * logic of its own — `productClient` is already KV-cached at the client
 * layer (see `createKrogerCacheMiddleware` in `client.ts`).
 */
export class ProductService {
  constructor(private productClient: KrogerClients["productClient"]) {}

  getProduct(upc: string, locationId?: string): ResultAsync<Product, AppError> {
    const queryParams: Record<string, string> = {};
    if (locationId) {
      queryParams["filter.locationId"] = locationId;
    }

    return fromApiResponse(
      this.productClient.GET("/v1/products/{id}", {
        params: { path: { id: upc }, query: queryParams },
      }),
      "get product details",
    ).andThen((data) => {
      const product = data.data;
      if (!product) {
        return err(notFoundError(`No information found for UPC: ${upc}`));
      }
      return ok(product);
    });
  }

  async enrichProductName(upc: string, locationId?: string): Promise<string | null> {
    return this.getProduct(upc, locationId).match(
      (product) => product.description ?? null,
      () => null,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/services/kroger/product-service.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/kroger/product-service.ts tests/services/kroger/product-service.test.ts
git commit -m "feat: add ProductService wrapper around productClient"
```

---

## Task 4: Wire KV + `ProductService` into `ToolContext` and `buildServer`

**Files:**

- Modify: `src/tools/types.ts`
- Modify: `src/server.ts`
- Test: `tests/tools/types.test.ts` (only if it already asserts `ToolContext` shape — otherwise no test changes; verified by every other task's tests compiling)

**Interfaces:**

- Consumes: `ProductService` (Task 3), `getUserDataKv` (Task 1), updated `createKrogerClients` (Task 2).
- Produces: `ToolContext.productService: ProductService` (new required field). Every test helper that builds a `ToolContext` object literal must supply this field from Task 5 onward — this task only changes production code; it will not compile alongside the rest of the test suite until Task 5 lands, so run Tasks 4 and 5 back-to-back before committing either (see Task 5's note).

- [ ] **Step 1: Update `ToolContext`**

In `src/tools/types.ts`, add the import and field:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { KrogerClients } from "../services/kroger/client.js";
import type { ProductService } from "../services/kroger/product-service.js";
import type { createUserStorage } from "../utils/user-storage.js";
```

```typescript
// Shared context passed to all tool registration functions.
// Infrastructure dependencies only. Auth is accessed via getMcpAuthContext() from agents/mcp.
export type ToolContext = {
  server: McpServer;
  clients: KrogerClients;
  productService: ProductService;
  storage: UserStorage;
  getEnv: () => Env;
  getSessionId: () => string;
};
```

- [ ] **Step 2: Update `buildServer` in `src/server.ts`**

Add imports:

```typescript
import { ProductService } from "./services/kroger/product-service.js";
import { getUserDataKv } from "./utils/kv.js";
```

Update the body of `buildServer` (the section building `clients`/`ctx`):

```typescript
function buildServer(env: Env, sessionId: string): McpServer {
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);

  const clients = createKrogerClients((): KrogerTokenInfo | null => {
    const props = getMcpAuthContext()?.props;
    if (
      !props ||
      typeof props.accessToken !== "string" ||
      typeof props.tokenExpiresAt !== "number"
    ) {
      return null;
    }
    return { accessToken: props.accessToken, tokenExpiresAt: props.tokenExpiresAt };
  }, getUserDataKv(env));

  const storage = createUserStorage(env.USER_DATA_KV);
  const productService = new ProductService(clients.productClient);

  const ctx: ToolContext = {
    server,
    clients,
    productService,
    storage,
    getEnv: () => env,
    getSessionId: () => sessionId,
  };

  // Register the single unified View resource (all app tools share this one UI)
  registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

  // Register all MCP features
  registerPrompts(server);
  for (const register of TOOL_REGISTRARS) register(ctx);

  return server;
}
```

- [ ] **Step 3: Confirm this compiles in isolation is not possible yet — proceed directly to Task 5**

This task's change makes `productService` a required field on `ToolContext`, which breaks every test file that builds a `ToolContext` object literal directly. Do not run `pnpm exec tsc --noEmit` or `pnpm test` as a gate here — Task 5 fixes every call site in the same work session. Commit only after Task 5's steps are also complete (Task 5 ends with the full green build).

- [ ] **Step 4: Commit** (do this at the end of Task 5, together — see Task 5 Step 8)

---

## Task 5: Fix every test helper that constructs `ToolContext`

This task makes the codebase compile again after Task 4. Every file below builds a `ToolContext` object literal and needs a `productService` field. Work through them in order; this task has no separate "failing test" step because the failure mode is a compile error, not a red test — Step 1 demonstrates that compile error, and each subsequent step fixes one file.

**Files:**

- Modify: `tests/tools/tool-test-harness.ts` (shared by `cart` is NOT — see below; used by `storage-backed-tools.test.ts`, `location-storage-backed.test.ts`, `orders-storage-backed.test.ts`)
- Modify: `tests/tools/product.test.ts`
- Modify: `tests/tools/resources-registration.test.ts`
- Modify: `tests/tools/shop.test.ts`
- Modify: `tests/tools/cart.test.ts`
- Modify: `tests/tools/item-flags.test.ts`
- Modify: `tests/tools/recipes.test.ts`
- Modify: `tests/tools/weekly-deals.test.ts`
- Modify: `tests/evals/mcp-agent-contract.test.ts`
- Modify: `tests/utils/view-resource.test.ts`

**Interfaces:**

- Consumes: `ProductService` (Task 3).

- [ ] **Step 1: Confirm the compile error**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL with multiple `Property 'productService' is missing in type '{...}' but required in type 'ToolContext'` errors across the files listed above.

- [ ] **Step 2: `tests/tools/tool-test-harness.ts` — add a configurable `productService` stub**

This harness is shared by `storage-backed-tools.test.ts` (which needs per-test control over enriched product names for pantry/deal-flag matching), `location-storage-backed.test.ts`, and `orders-storage-backed.test.ts` (which don't touch `productService` at all). Add a new exported factory and thread it through both context builders.

Add near the top, after the existing type imports:

```typescript
import type { ProductService } from "../../src/services/kroger/product-service.js";
```

Add this new exported function (place it after `makeStorage`, before `makeContext`):

```typescript
/**
 * Builds a `ProductService` stub for tests that don't need a real
 * `productClient`. `enrichProductName` resolves from `nameByUpc`, falling
 * back to `null` (the same fallback-to-upc behavior production code gets)
 * for any upc not in the map.
 */
export function makeProductService(nameByUpc: Record<string, string> = {}): ProductService {
  return {
    getProduct: () => {
      throw new Error("ProductService.getProduct stub not configured for this test");
    },
    enrichProductName: async (upc: string) => nameByUpc[upc] ?? null,
  } as unknown as ProductService;
}
```

Update `makeContext` and `makeContextWithElicit` to accept an optional `productService` and default it:

```typescript
export function makeContext(
  storage = makeStorage(),
  productService: ProductService = makeProductService(),
): ToolContext {
  return {
    server: {
      registerTool: (name: string, config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
      server: {
        elicitInput: async () => ({ action: "accept", content: { confirm: true } }),
      },
    } as unknown as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async () => ({
          data: undefined,
          response: new Response(null, { status: 204 }),
        }),
      },
    } as unknown as ToolContext["clients"],
    productService,
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}

export function makeContextWithElicit(
  storage: UserStorage,
  elicitResult: ElicitResult,
  cartStatus = 204,
  productService: ProductService = makeProductService(),
): ToolContext {
  return {
    server: {
      registerTool: (name: string, config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
      server: {
        elicitInput: async () => elicitResult,
      },
    } as unknown as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async () => ({
          data: undefined,
          response: new Response(null, { status: cartStatus }),
        }),
      },
    } as unknown as ToolContext["clients"],
    productService,
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}
```

- [ ] **Step 3: `tests/tools/product.test.ts` — wire a real `ProductService` around the existing mock `productClient`**

This file's `makeContext` already mocks `productClient.GET`; the `get_product` handler will delegate to `ctx.productService.getProduct`, which internally calls that same mocked `GET`. Wiring a real `ProductService` around the existing mock means every existing `get_product` test (lines ~492-606) needs **no other changes**.

Add the import:

```typescript
import { ProductService } from "../../src/services/kroger/product-service.js";
```

Replace `makeContext`:

```typescript
function makeContext(productGet: ProductGetFn, storage?: UserStorage): ToolContext {
  const clients = { productClient: { GET: productGet } } as unknown as ToolContext["clients"];
  return {
    server: {} as ToolContext["server"],
    clients,
    productService: new ProductService(clients.productClient),
    storage: storage ?? makeStorage(),
    getEnv: () =>
      ({
        USER_DATA_KV: { get: async () => null, put: async () => {} },
      }) as unknown as Env,
    getSessionId: () => "session-1",
  };
}
```

- [ ] **Step 4: `tests/tools/resources-registration.test.ts` — same pattern for the product resource**

Add the import:

```typescript
import { ProductService } from "../../src/services/kroger/product-service.js";
import type { KrogerClients } from "../../src/services/kroger/client.js";
```

Replace `makeContext`:

```typescript
function makeContext(storage: UserStorage, productClient: unknown = {}): ToolContext {
  return {
    server: makeServer(),
    clients: { productClient } as unknown as ToolContext["clients"],
    productService: new ProductService(productClient as KrogerClients["productClient"]),
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}
```

- [ ] **Step 5: Add a trivial `productService` stub to the remaining files**

None of `shop.test.ts`, `cart.test.ts`, `item-flags.test.ts`, `recipes.test.ts`, `weekly-deals.test.ts`, `mcp-agent-contract.test.ts`, or `view-resource.test.ts` exercise `ctx.productService` directly (shop_for_items builds `ShoppingListItem`s inline without it; the rest don't touch shopping-list creation or product lookups by UPC). Add the same one-line stub to each file's context builder — no behavioral test changes needed.

Add this helper near the top of each file (after the existing type imports, before the first `describe`) and reference it from the context builder:

```typescript
function stubProductService(): ToolContext["productService"] {
  return {
    getProduct: () => {
      throw new Error("productService not used in this test");
    },
    enrichProductName: async () => null,
  } as unknown as ToolContext["productService"];
}
```

Then add `productService: stubProductService(),` to the returned object in each file's context builder:

- `tests/tools/shop.test.ts` — in `makeContext`'s returned object (the function starting `function makeContext(productGet, preferredLocation, cartOptions = {})`), add the field alongside `storage,`.
- `tests/tools/cart.test.ts` — in `makeContext`'s returned `context` object (the function returning `{ context, putCalls, snapshotSetCalls }`), add the field alongside `storage: actualStorage,`.
- `tests/tools/item-flags.test.ts` — in `makeKvContext`, add the field alongside `storage: {} as ToolContext["storage"],`.
- `tests/tools/recipes.test.ts` — in `makeContext`, add the field alongside `storage,`.
- `tests/tools/weekly-deals.test.ts` — in `makeWeeklyDealsContext`, add the field alongside the existing `clients` entry.
- `tests/evals/mcp-agent-contract.test.ts` — in `makeContext`, add the field alongside `storage: {} as ToolContext["storage"],`.
- `tests/utils/view-resource.test.ts` — in `makeContext(env)`, add the field alongside `storage: {} as ToolContext["storage"],`.

- [ ] **Step 6: Run the full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no `productService` missing-property errors remain. (`storage-backed-tools.test.ts` and `shopping-list.ts` itself will still have errors/failures until Tasks 9-10 land — that's expected; re-run this exact command again at the end of Task 10.)

- [ ] **Step 7: Run the currently-unblocked test files**

Run: `pnpm exec vitest run tests/tools/product.test.ts tests/tools/resources-registration.test.ts tests/tools/shop.test.ts tests/tools/cart.test.ts tests/tools/item-flags.test.ts tests/tools/recipes.test.ts tests/tools/weekly-deals.test.ts tests/evals/mcp-agent-contract.test.ts tests/utils/view-resource.test.ts`
Expected: PASS. (`mcp-agent-contract.test.ts`'s schema-shape test at "models product search and shopping list validation in schemas" will still be green here because `productName` is silently stripped by Zod, not rejected — Task 11 tightens this assertion to use `upc` once the schema itself changes in Task 10.)

- [ ] **Step 8: Commit Tasks 4 and 5 together**

```bash
git add src/tools/types.ts src/server.ts tests/tools/tool-test-harness.ts tests/tools/product.test.ts tests/tools/resources-registration.test.ts tests/tools/shop.test.ts tests/tools/cart.test.ts tests/tools/item-flags.test.ts tests/tools/recipes.test.ts tests/tools/weekly-deals.test.ts tests/evals/mcp-agent-contract.test.ts tests/utils/view-resource.test.ts
git commit -m "feat: inject ProductService through ToolContext"
```

---

## Task 6: `get_product` uses `ctx.productService`

**Files:**

- Modify: `src/tools/product.ts`

**Interfaces:**

- Consumes: `ctx.productService.getProduct(upc, storeId)` (Tasks 3-4).

- [ ] **Step 1: Replace the `get_product` handler body**

In `src/tools/product.ts`, find the `get_product` tool registration's handler:

```typescript
async ({ upc, storeId }) => {
  const queryParams: Record<string, string> = {};
  if (storeId) {
    queryParams["filter.locationId"] = storeId;
  }

  const result = await fromApiResponse(
    productClient.GET("/v1/products/{id}", {
      params: {
        path: { id: upc },
        query: queryParams,
      },
    }),
    "get product details",
  ).andThen((data) => {
    const product = data.data;
    if (!product) {
      return err(notFoundError(`No information found for UPC: ${upc}`));
    }
    return ok(product);
  });

  return result.match((product) => {
    return {
      content: [{ type: "text" as const, text: formatProductDetailMarkdown(product) }],
      structuredContent: { _view: "get_product", product },
    };
  }, toMcpError);
},
```

Replace with:

```typescript
async ({ upc, storeId }) => {
  const result = await ctx.productService.getProduct(upc, storeId);

  return result.match((product) => {
    return {
      content: [{ type: "text" as const, text: formatProductDetailMarkdown(product) }],
      structuredContent: { _view: "get_product", product },
    };
  }, toMcpError);
},
```

This is a verbatim behavior match — `ProductService.getProduct` (Task 3) uses the exact same `fromApiResponse(..., "get product details")` call and the exact same not-found message.

- [ ] **Step 2: Run the tests**

Run: `pnpm exec vitest run tests/tools/product.test.ts`
Expected: PASS unchanged — Task 5 Step 3 already wired `ctx.productService` around the same mocked `productClient.GET`, so the `get_product` describe block (lines ~492-606) requires zero further edits.

- [ ] **Step 3: Commit**

```bash
git add src/tools/product.ts
git commit -m "refactor: get_product delegates to ctx.productService"
```

---

## Task 7: Product resource uses `ctx.productService`

**Files:**

- Modify: `src/tools/resources.ts`

**Interfaces:**

- Consumes: `ctx.productService.getProduct(upc, locationId)` (Tasks 3-4).

- [ ] **Step 1: Replace the product-resource handler body**

In `src/tools/resources.ts`, find the `shopping://product/{upc}` resource handler (inside `registerResources`):

```typescript
async (uri: URL) => {
  const match = uri.href.match(/shopping:\/\/product\/([0-9]{13})/);
  if (!match) {
    return toonResource(uri.href, {
      error: "Invalid product URI format. Expected: shopping://product/{13-digit-upc}",
    });
  }

  const upc = match[1];

  const props = getProps();
  const locationId = (
    await safeStorage(
      () => ctx.storage.preferredLocation.get(props.id),
      "fetch preferred location",
    )
  ).match(
    (location) => location?.locationId,
    () => undefined,
  );

  const queryParams: Record<string, string> = {};
  if (locationId) {
    queryParams["filter.locationId"] = locationId;
  }

  const result = await fromApiResponse(
    productClient.GET("/v1/products/{id}", {
      params: {
        path: { id: upc },
        query: queryParams,
      },
    }),
    "fetch product details",
  );

  return result.match(
    (data) => {
      const product = data.data;
      if (!product) {
        return toonResource(uri.href, {
          error: `No product found with UPC: ${upc}`,
        });
      }
      return toonResource(uri.href, product);
    },
    (error) =>
      toonResource(uri.href, {
        error: `Failed to fetch product: ${error.message}`,
      }),
  );
},
```

Replace with:

```typescript
async (uri: URL) => {
  const match = uri.href.match(/shopping:\/\/product\/([0-9]{13})/);
  if (!match) {
    return toonResource(uri.href, {
      error: "Invalid product URI format. Expected: shopping://product/{13-digit-upc}",
    });
  }

  const upc = match[1];

  const props = getProps();
  const locationId = (
    await safeStorage(
      () => ctx.storage.preferredLocation.get(props.id),
      "fetch preferred location",
    )
  ).match(
    (location) => location?.locationId,
    () => undefined,
  );

  const result = await ctx.productService.getProduct(upc, locationId);

  return result.match(
    (product) => toonResource(uri.href, product),
    (error) => {
      if (error.type === "NOT_FOUND") {
        return toonResource(uri.href, { error: `No product found with UPC: ${upc}` });
      }
      return toonResource(uri.href, { error: `Failed to fetch product: ${error.message}` });
    },
  );
},
```

Branching on `error.type === "NOT_FOUND"` preserves the two distinct existing error messages (`"No product found..."` vs `"Failed to fetch product..."`) that `tests/tools/resources-registration.test.ts` already asserts on.

- [ ] **Step 2: Drop `productClient` and the now-unused `fromApiResponse` import**

At the top of `registerResources`, remove the now-unused destructure:

```typescript
export function registerResources(ctx: ToolContext) {
  const { productClient } = ctx.clients;
```

becomes:

```typescript
export function registerResources(ctx: ToolContext) {
```

Update the import line — `fromApiResponse` is no longer used anywhere in this file:

```typescript
import { fromApiResponse, getProps, safeStorage } from "../utils/result.js";
```

becomes:

```typescript
import { getProps, safeStorage } from "../utils/result.js";
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run tests/tools/resources-registration.test.ts`
Expected: PASS unchanged — Task 5 Step 4 already wired `ctx.productService` around the same mocked `productClient`.

- [ ] **Step 4: Run the full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors from `src/tools/resources.ts` (confirms `productClient` and `fromApiResponse` removal didn't leave dangling references).

- [ ] **Step 5: Commit**

```bash
git add src/tools/resources.ts
git commit -m "refactor: product resource delegates to ctx.productService"
```

---

## Task 8: Remove the now-redundant per-term product-search cache

**Files:**

- Modify: `src/tools/product.ts`
- Modify: `src/tools/shop.ts`
- Modify: `tests/tools/product.test.ts`

**Interfaces:**

- Produces: `searchProductsForTerms(productClient, terms, { locationId?, limitPerTerm }, onSearchComplete?)` — same name, `kv` removed from the params object. Task 11 doesn't touch this signature further.

- [ ] **Step 1: Trim `src/tools/product.ts` imports**

Replace the top of the file:

```typescript
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { components as ProductComponents } from "../services/kroger/product.js";
import type { KvLike } from "./weekly-deals.js";

import { notFoundError } from "../errors.js";
import {
  formatProductDetailMarkdown,
  formatSearchProductsMarkdown,
} from "../utils/format-response.js";
import { safeJsonParseWithSchema } from "../utils/json.js";
import { fromApiResponse, getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";
import { type ToolContext, errorResult } from "./types.js";
import { isKvLike } from "./weekly-deals.js";
```

with:

```typescript
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { components as ProductComponents } from "../services/kroger/product.js";

import {
  formatProductDetailMarkdown,
  formatSearchProductsMarkdown,
} from "../utils/format-response.js";
import { fromApiResponse, getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";
import { type ToolContext, errorResult } from "./types.js";
```

- [ ] **Step 2: Delete the cache constants, types, and helpers**

Delete these blocks entirely from `src/tools/product.ts` (everything between the `Product` type alias and `getProductInputSchema`):

```typescript
/**
 * Short-TTL KV cache for per-term product searches. ...
 */
const PRODUCT_SEARCH_CACHE_TTL_SECONDS = 600;

type ProductSearchCacheEntry = {
  products: Product[];
};

const cachedProductSchema = z.custom<Product>(...);

const productSearchCacheEntrySchema = z.looseObject({...}).transform(...);

/** Builds the cache key for a single-term product search. */
export function buildProductSearchCacheKey(...): string { ... }

/** Resolves the KV binding for the product-search cache. */
export function getProductSearchCacheKv(ctx: ToolContext): KvLike { ... }

async function readProductSearchCache(...): Promise<ProductSearchCacheEntry | null> { ... }

async function writeProductSearchCache(...): Promise<void> { ... }
```

- [ ] **Step 3: Simplify `searchProductsForTerms`**

Replace the whole function:

```typescript
export async function searchProductsForTerms(
  productClient: KrogerClients["productClient"],
  terms: string[],
  params: { locationId?: string; limitPerTerm: number },
  onSearchComplete?: (completed: number, total: number) => Promise<void> | void,
): Promise<ProductSearchResult[]> {
  let completedSearches = 0;
  const totalSearches = terms.length;

  const searchPromises = terms.map(async (term) => {
    const queryParams: Record<string, string | number> = {
      "filter.term": term,
      ...(params.locationId ? { "filter.locationId": params.locationId } : {}),
      "filter.fulfillment": "ais",
      "filter.limit": params.limitPerTerm,
    };

    const apiResult = await fromApiResponse(
      productClient.GET("/v1/products", {
        params: { query: queryParams },
      }),
      `search products for "${term}"`,
    );

    completedSearches++;
    if (onSearchComplete) await onSearchComplete(completedSearches, totalSearches);

    return apiResult
      .map((data) => {
        const products = data?.data || [];
        return { term, products, count: products.length, failed: false as const };
      })
      .orTee((error) => logProductSearchError(term, error))
      .match(
        (result) => result,
        () => ({ term, products: [] as Product[], count: 0, failed: true as const }),
      );
  });

  const results = await Promise.all(searchPromises);

  for (const result of results) {
    if (!result.failed && result.count > 0) {
      result.products.sort((a, b) => {
        const aItem = a.items?.[0];
        const bItem = b.items?.[0];
        const aPickup = aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
        const bPickup = bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

        if (aPickup && !bPickup) return -1;
        if (!aPickup && bPickup) return 1;
        return 0;
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Update the `search_products` handler call site**

In `registerProductTools`, find:

```typescript
      const results = await searchProductsForTerms(
        productClient,
        terms,
        { locationId: resolvedLocationId, limitPerTerm, kv: getProductSearchCacheKv(ctx) },
        progressToken && sendNotification
```

Replace with:

```typescript
      const results = await searchProductsForTerms(
        productClient,
        terms,
        { locationId: resolvedLocationId, limitPerTerm },
        progressToken && sendNotification
```

- [ ] **Step 5: Update `src/tools/shop.ts` to use `getUserDataKv` instead of the removed `getProductSearchCacheKv`**

Add the import:

```typescript
import { getUserDataKv } from "../utils/kv.js";
```

Update the import from `./product.js` (drop `getProductSearchCacheKv`):

```typescript
import { getProductSearchCacheKv, searchProductsForTerms } from "./product.js";
```

becomes:

```typescript
import { searchProductsForTerms } from "./product.js";
```

Update the handler body — find:

```typescript
const terms = items.map((item) => item.name);
const kv = getProductSearchCacheKv(ctx);
const searchResults = await searchProductsForTerms(productClient, terms, {
  locationId,
  limitPerTerm: 5,
  kv,
});
```

Replace with:

```typescript
const terms = items.map((item) => item.name);
const kv = getUserDataKv(ctx.getEnv());
const searchResults = await searchProductsForTerms(productClient, terms, {
  locationId,
  limitPerTerm: 5,
});
```

(`kv` is still used a few lines below for `rankProductMatches({ ai, kv, ... })` — unchanged.)

- [ ] **Step 6: Delete the removed cache's tests from `tests/tools/product.test.ts`**

Delete the `buildProductSearchCacheKey` import from the top:

```typescript
import {
  buildProductSearchCacheKey,
  logProductSearchError,
  registerProductTools,
  searchProductsForTerms,
} from "../../src/tools/product.js";
```

becomes:

```typescript
import {
  logProductSearchError,
  registerProductTools,
  searchProductsForTerms,
} from "../../src/tools/product.js";
```

Delete the two `describe` blocks `"buildProductSearchCacheKey"` and `"searchProductsForTerms KV cache"` (everything from the `// searchProductsForTerms: product-search KV cache` comment through the end of the `"without a kv binding..."` test, i.e. from the line starting `// ---------------------------------------------------------------------------\n// searchProductsForTerms: product-search KV cache` through the closing `});` of the `searchProductsForTerms KV cache` describe block — this is the block read in the file's tail, roughly lines 609-810 as of this plan's writing).

Keep `createMockKV` and `stubProductClient` only if still referenced elsewhere in the file after deletion — check with:

```bash
grep -n "createMockKV\|stubProductClient" tests/tools/product.test.ts
```

If either helper is now unreferenced, delete it too (both were added solely for the removed cache tests, per the file's own comment "same pattern as tests/tools/response-size.test.ts and tests/utils/user-storage.test.ts" — that comment can go with them).

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run tests/tools/product.test.ts tests/tools/shop.test.ts`
Expected: PASS — `search_products` behavior is unaffected (same query params, same response shape); only the caching implementation moved.

- [ ] **Step 8: Run the full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/tools/product.ts src/tools/shop.ts tests/tools/product.test.ts
git commit -m "refactor: remove redundant per-term product-search KV cache"
```

---

## Task 9: Consolidate `weekly-deals.ts`/`item-flags.ts` onto the shared KV helper

**Files:**

- Modify: `src/tools/weekly-deals.ts`
- Modify: `src/tools/item-flags.ts`

**Interfaces:**

- Consumes: `KvLike`, `getUserDataKv` from `src/utils/kv.ts` (Task 1).

- [ ] **Step 1: `weekly-deals.ts` — replace the local `KvLike`/`isKvLike`/cache-resolution with the shared helper**

Replace:

```typescript
export type KvLike = Pick<KVNamespace, "get" | "put">;
```

with:

```typescript
export type { KvLike } from "../utils/kv.js";
```

Delete the local `isKvLike` function:

```typescript
export function isKvLike(value: unknown): value is KvLike {
  return !!value && typeof value === "object" && "get" in value && "put" in value;
}
```

Delete `safeGetCacheKv` and `getCacheKv`:

```typescript
const safeGetCacheKv = fromThrowable(
  (ctx: ToolContext) => {
    const env = ctx.getEnv();
    return isKvLike(env?.USER_DATA_KV) ? env.USER_DATA_KV : null;
  },
  () => null,
);

function getCacheKv(ctx: ToolContext): KvLike | null {
  return safeGetCacheKv(ctx).match(
    (kv) => kv,
    () => null,
  );
}
```

Add the import (near the other local imports):

```typescript
import { getUserDataKv } from "../utils/kv.js";
```

Update the `get_weekly_deals` handler call site:

```typescript
const kv = getCacheKv(ctx);
```

becomes:

```typescript
const kv = getUserDataKv(ctx.getEnv());
```

Remove `fromThrowable` from the neverthrow import if it's now unused in this file:

```typescript
import { ResultAsync, fromThrowable, okAsync } from "neverthrow";
```

becomes:

```typescript
import { ResultAsync, okAsync } from "neverthrow";
```

(Verify with `grep -n "fromThrowable" src/tools/weekly-deals.ts` — it should only have appeared in the deleted `safeGetCacheKv`.)

- [ ] **Step 2: `item-flags.ts` — same swap**

Replace the import:

```typescript
import { buildWeeklyDealsCacheKey, isKvLike, parseCacheEntry } from "./weekly-deals.js";
```

with:

```typescript
import { buildWeeklyDealsCacheKey, parseCacheEntry } from "./weekly-deals.js";
import { getUserDataKv } from "../utils/kv.js";
```

Update `getDealsForFlags`:

```typescript
const env = ctx.getEnv();
const kv = isKvLike(env?.USER_DATA_KV) ? env.USER_DATA_KV : null;
if (!kv) return [];
```

becomes:

```typescript
const kv = getUserDataKv(ctx.getEnv());
if (!kv) return [];
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run tests/tools/weekly-deals.test.ts tests/tools/item-flags.test.ts tests/tools/storage-backed-tools.test.ts tests/tools/shop.test.ts`

Note: `storage-backed-tools.test.ts` may still be red at this point pending Task 10 — that's expected; this step is here so you catch any regression specifically caused by this task's import changes (the other three files should be fully green).

Expected: `weekly-deals.test.ts`, `item-flags.test.ts`, `shop.test.ts` PASS.

- [ ] **Step 4: Run the full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors from `weekly-deals.ts`/`item-flags.ts` (unused-import errors would show up here first).

- [ ] **Step 5: Commit**

```bash
git add src/tools/weekly-deals.ts src/tools/item-flags.ts
git commit -m "refactor: consolidate KvLike/getUserDataKv usage onto src/utils/kv.ts"
```

---

## Task 10: Simplify `create_shopping_list` input and add enrichment

**Files:**

- Modify: `src/tools/shopping-list.ts`
- Modify: `tests/tools/storage-backed-tools.test.ts`

**Interfaces:**

- Consumes: `ctx.productService.enrichProductName(upc)` (Tasks 3-4).
- Produces: `createShoppingListInputSchema` items are now `{upc, quantity, notes}` (no `productName`). The handler still calls `createShoppingListRecord` (unchanged signature) with fully-enriched `ShoppingListItem[]`.

- [ ] **Step 1: Update `createShoppingListInputSchema`**

In `src/tools/shopping-list.ts`, replace:

```typescript
export const createShoppingListInputSchema = z.object({
  name: z.string().min(1).max(200).describe("List label, e.g. 'Tuesday dinner'."),
  items: z
    .array(
      z.object({
        productName: z.string().min(1).max(200).describe("Product name, e.g. 'Whole Milk'"),
        upc: upcSchema.optional().describe("UPC from search_products, needed for cart checkout"),
        quantity: z.coerce.number().min(1).max(999).default(1),
        notes: z.string().max(500).optional().describe("e.g. 'get organic'"),
      }),
    )
    .min(1, { message: "Shopping list must include at least one item" }),
});
```

with:

```typescript
export const createShoppingListInputSchema = z.object({
  name: z.string().min(1).max(200).describe("List label, e.g. 'Tuesday dinner'."),
  items: z
    .array(
      z.object({
        upc: upcSchema.describe("UPC from search_products"),
        quantity: z.coerce.number().min(1).max(999).default(1),
        notes: z.string().max(500).optional().describe("e.g. 'get organic'"),
      }),
    )
    .min(1, { message: "Shopping list must include at least one item" }),
});
```

- [ ] **Step 2: Update the tool description**

Find the `create_shopping_list` registration's `description` field:

```typescript
      description:
        'Creates a named shopping list snapshot; returns `listId` for add_shopping_list_to_cart. Example: {"name":"Tuesday dinner","items":[{"productName":"Whole Milk","upc":"0001111041700","quantity":1}]}',
```

Replace with:

```typescript
      description:
        'Creates a named shopping list snapshot; returns `listId` for add_shopping_list_to_cart. The product name is looked up automatically from the UPC. Example: {"name":"Tuesday dinner","items":[{"upc":"0001111041700","quantity":1}]}',
```

- [ ] **Step 3: Add enrichment to the handler**

Replace the handler body:

```typescript
    async ({ name, items }) => {
      const props = getProps();

      if (items.length === 0) {
        return toMcpError(validationError("Shopping list must include at least one item."));
      }

      // Best-effort pantry/deal flags (see item-flags.ts): a storage/cache
      // miss or error yields no flag, never a failed tool call. Location is
      // resolved best-effort too — no preferred store just means no deal
      // flags, not an error for this tool.
      const [pantry, resolvedLocation] = await Promise.all([
        getPantryForFlags(ctx, props.id),
        safeResolveLocationId(ctx.storage, props.id, undefined),
      ]);
      const locationId = resolvedLocation.match(
        (resolved) => resolved.locationId,
        () => undefined,
      );
      const deals = await getDealsForFlags(ctx, locationId);

      const lines = items
        .map((item, index) => {
          const flags = itemFlagLabels(item.productName, pantry, deals);
          const base = formatShoppingListItemCompact(item);
          const suffixed = flags.length > 0 ? `${base} | ${flags.join(" | ")}` : base;
          return `${index + 1}. ${suffixed}`;
        })
        .join("\n");

      const result = await createShoppingListRecord(
        ctx.storage,
        props.id,
        ctx.getSessionId(),
        name,
        items,
      );

      return result.match(
        ({ shortId, list }) => ({
          content: [
            {
              type: "text" as const,
              text: `Created shopping list "${name}" with ${items.length} item(s). listId=${shortId}\n\n${lines}`,
            },
          ],
          structuredContent: {
            _view: "create_shopping_list",
            listId: shortId,
            name: list.name,
            items: list.items,
          },
        }),
        toMcpError,
      );
    },
```

with:

```typescript
    async ({ name: listName, items }) => {
      const props = getProps();

      if (items.length === 0) {
        return toMcpError(validationError("Shopping list must include at least one item."));
      }

      // Product names are always looked up from the UPC (ProductService is
      // KV-cached at the Kroger client layer) — a lookup failure falls back
      // to the UPC as the display name, never a failed tool call. Lookups
      // run in parallel.
      const enrichedItems: ShoppingListItem[] = await Promise.all(
        items.map(async (item) => {
          const productName = await ctx.productService.enrichProductName(item.upc);
          return {
            productName: productName ?? item.upc,
            upc: item.upc,
            quantity: item.quantity,
            notes: item.notes,
          };
        }),
      );

      // Best-effort pantry/deal flags (see item-flags.ts): a storage/cache
      // miss or error yields no flag, never a failed tool call. Location is
      // resolved best-effort too — no preferred store just means no deal
      // flags, not an error for this tool.
      const [pantry, resolvedLocation] = await Promise.all([
        getPantryForFlags(ctx, props.id),
        safeResolveLocationId(ctx.storage, props.id, undefined),
      ]);
      const locationId = resolvedLocation.match(
        (resolved) => resolved.locationId,
        () => undefined,
      );
      const deals = await getDealsForFlags(ctx, locationId);

      const lines = enrichedItems
        .map((item, index) => {
          const flags = itemFlagLabels(item.productName, pantry, deals);
          const base = formatShoppingListItemCompact(item);
          const suffixed = flags.length > 0 ? `${base} | ${flags.join(" | ")}` : base;
          return `${index + 1}. ${suffixed}`;
        })
        .join("\n");

      const result = await createShoppingListRecord(
        ctx.storage,
        props.id,
        ctx.getSessionId(),
        listName,
        enrichedItems,
      );

      return result.match(
        ({ shortId, list }) => ({
          content: [
            {
              type: "text" as const,
              text: `Created shopping list "${listName}" with ${enrichedItems.length} item(s). listId=${shortId}\n\n${lines}`,
            },
          ],
          structuredContent: {
            _view: "create_shopping_list",
            listId: shortId,
            name: list.name,
            items: list.items,
          },
        }),
        toMcpError,
      );
    },
```

- [ ] **Step 4: Update `tests/tools/storage-backed-tools.test.ts`**

**4a.** "creates a shopping list and returns a short listId" (around the `it("creates a shopping list...")` block): give each item a distinct upc and use `makeProductService` to resolve names.

Replace:

```typescript
it("creates a shopping list and returns a short listId", async () => {
  registerShoppingListTools(makeContext());
  const handler = getCapturedHandler("create_shopping_list");

  const result = await handler({
    name: "Tuesday Dinner",
    items: [
      { productName: "Milk", upc: "0001111042578", quantity: 2 },
      { productName: "Bread", quantity: 1 },
    ],
  });

  expect(isErrorResult(result)).toBe(false);
  const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
  expect(sc["_view"]).toBe("create_shopping_list");
  expect(sc["listId"]).toMatch(/^list_[0-9a-f]{8}$/);
  expect(sc["name"]).toBe("Tuesday Dinner");
  expect((sc["items"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
    "Milk",
    "Bread",
  ]);
});
```

with:

```typescript
it("creates a shopping list and returns a short listId", async () => {
  registerShoppingListTools(
    makeContext(
      undefined,
      makeProductService({ "0001111042578": "Milk", "0009999999999": "Bread" }),
    ),
  );
  const handler = getCapturedHandler("create_shopping_list");

  const result = await handler({
    name: "Tuesday Dinner",
    items: [
      { upc: "0001111042578", quantity: 2 },
      { upc: "0009999999999", quantity: 1 },
    ],
  });

  expect(isErrorResult(result)).toBe(false);
  const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
  expect(sc["_view"]).toBe("create_shopping_list");
  expect(sc["listId"]).toMatch(/^list_[0-9a-f]{8}$/);
  expect(sc["name"]).toBe("Tuesday Dinner");
  expect((sc["items"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
    "Milk",
    "Bread",
  ]);
});
```

**4b.** "returns a fresh listId on each call so lists don't collide": drop `productName`, add `upc` (names aren't asserted here, default stub fallback to upc is fine).

Replace:

```typescript
const first = await handler({
  name: "First",
  items: [{ productName: "A", quantity: 1 }],
});
const second = await handler({
  name: "Second",
  items: [{ productName: "B", quantity: 2 }],
});
```

with:

```typescript
const first = await handler({
  name: "First",
  items: [{ upc: "0001111000001", quantity: 1 }],
});
const second = await handler({
  name: "Second",
  items: [{ upc: "0001111000002", quantity: 2 }],
});
```

**4c.** Pantry/deal-flag tests: give each item a upc and resolve it to the productName the flag logic needs to match against.

Replace:

```typescript
it("flags an item already in the pantry", async () => {
  const storage = makeStorage({
    pantry: {
      getAll: async () => [{ productName: "Milk", quantity: 1, addedAt: new Date().toISOString() }],
    } as unknown as UserStorage["pantry"],
  });
  registerShoppingListTools(makeContext(storage));

  const result = await getCapturedHandler("create_shopping_list")({
    name: "Groceries",
    items: [{ productName: "Milk", quantity: 1 }],
  });

  expect(isErrorResult(result)).toBe(false);
  expect(textFromResult(result)).toContain("in pantry");
});

it("does not flag an item that isn't in the pantry", async () => {
  const storage = makeStorage({
    pantry: {
      getAll: async () => [
        { productName: "Bread", quantity: 1, addedAt: new Date().toISOString() },
      ],
    } as unknown as UserStorage["pantry"],
  });
  registerShoppingListTools(makeContext(storage));

  const result = await getCapturedHandler("create_shopping_list")({
    name: "Groceries",
    items: [{ productName: "Milk", quantity: 1 }],
  });

  expect(textFromResult(result)).not.toContain("in pantry");
});
```

with:

```typescript
it("flags an item already in the pantry", async () => {
  const storage = makeStorage({
    pantry: {
      getAll: async () => [{ productName: "Milk", quantity: 1, addedAt: new Date().toISOString() }],
    } as unknown as UserStorage["pantry"],
  });
  registerShoppingListTools(makeContext(storage, makeProductService({ "0001111000001": "Milk" })));

  const result = await getCapturedHandler("create_shopping_list")({
    name: "Groceries",
    items: [{ upc: "0001111000001", quantity: 1 }],
  });

  expect(isErrorResult(result)).toBe(false);
  expect(textFromResult(result)).toContain("in pantry");
});

it("does not flag an item that isn't in the pantry", async () => {
  const storage = makeStorage({
    pantry: {
      getAll: async () => [
        { productName: "Bread", quantity: 1, addedAt: new Date().toISOString() },
      ],
    } as unknown as UserStorage["pantry"],
  });
  registerShoppingListTools(makeContext(storage, makeProductService({ "0001111000001": "Milk" })));

  const result = await getCapturedHandler("create_shopping_list")({
    name: "Groceries",
    items: [{ upc: "0001111000001", quantity: 1 }],
  });

  expect(textFromResult(result)).not.toContain("in pantry");
});
```

Replace the two weekly-deals-flag tests similarly:

```typescript
const context = makeContext();
context.getEnv = () =>
  ({
    USER_DATA_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    },
  }) as unknown as Env;
registerShoppingListTools(context);

const result = await getCapturedHandler("create_shopping_list")({
  name: "Groceries",
  items: [{ productName: "Whole Milk", quantity: 1 }],
});
```

(appears twice, once in "flags an item on sale..." and once in "yields no flag... for a corrupted weekly-deals cache entry") — in **both** occurrences, replace with:

```typescript
const context = makeContext(undefined, makeProductService({ "0001111000001": "Whole Milk" }));
context.getEnv = () =>
  ({
    USER_DATA_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    },
  }) as unknown as Env;
registerShoppingListTools(context);

const result = await getCapturedHandler("create_shopping_list")({
  name: "Groceries",
  items: [{ upc: "0001111000001", quantity: 1 }],
});
```

**4d.** "adds items from a persisted shopping list to the Kroger cart by listId" and "short-circuits a retried add_shopping_list_to_cart call instead of re-adding": drop `productName`, keep `upc`.

In both tests, replace:

```typescript
const createResult = await createHandler({
  name: "Dinner",
  items: [{ productName: "Milk", upc: "0001111042578", quantity: 2 }],
});
```

with:

```typescript
const createResult = await createHandler({
  name: "Dinner",
  items: [{ upc: "0001111042578", quantity: 2 }],
});
```

**4e.** "bails when the shopping list has no items with UPCs": `create_shopping_list` can no longer produce an item lacking a upc, so seed the shopping list directly through `ctx.storage.shoppingList.create` (exercising the real `handleListIdCart`'s `withoutUpc` branch in `cart.ts`, which this plan intentionally leaves in place — see the design doc's Downstream Impact section) instead of going through the tool.

Add this import at the top of the file:

```typescript
import { buildShoppingListStorageKey } from "../../src/tools/shopping-list.js";
```

Replace:

```typescript
it("bails when the shopping list has no items with UPCs", async () => {
  const storage = makeStorage();
  storage.preferredLocation = {
    get: async () => null,
    set: async () => {},
  } as unknown as UserStorage["preferredLocation"];

  const ctx = makeContextWithElicit(storage, { action: "accept" });
  registerShoppingListTools(ctx);
  registerCartTools(ctx);

  const createResult = await getCapturedHandler("create_shopping_list")({
    name: "No UPCs",
    items: [{ productName: "Strawberries", quantity: 2 }],
  });
  const listId = (createResult as { structuredContent: { listId: string } }).structuredContent
    .listId;

  const handler = getCapturedHandler("add_shopping_list_to_cart");
  const result = await handler({ listId, storeId: "70500847" });

  expect(isErrorResult(result)).toBe(false);
  const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
  expect((sc["items"] as unknown[]).length).toBe(0);
  expect((sc["needsUpc"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
    "Strawberries",
  ]);
  expect(textFromResult(result)).toContain("no items with a UPC");
});
```

with:

```typescript
it("bails when the shopping list has no items with UPCs", async () => {
  // create_shopping_list always resolves a upc from the input now, so a
  // upc-less item can only reach the cart tool via a pre-existing stored
  // list (e.g. a matched product missing its own upc from Kroger's API —
  // see shop_for_items's LineItem filtering). Seed storage directly to
  // exercise that path.
  const storage = makeStorage();
  storage.preferredLocation = {
    get: async () => null,
    set: async () => {},
  } as unknown as UserStorage["preferredLocation"];

  const ctx = makeContextWithElicit(storage, { action: "accept" });
  registerCartTools(ctx);

  const listId = "list_deadbeef";
  // buildShoppingListStorageKey scopes by (userId, sessionId) internally —
  // pass the raw userId/sessionId the harness authenticates as, not a
  // pre-scoped id.
  const storageKey = buildShoppingListStorageKey("user-123", "session-1", listId);
  await storage.shoppingList.create(storageKey, "No UPCs", [
    { productName: "Strawberries", quantity: 2 },
  ]);

  const handler = getCapturedHandler("add_shopping_list_to_cart");
  const result = await handler({ listId, storeId: "70500847" });

  expect(isErrorResult(result)).toBe(false);
  const sc = (result as { structuredContent: Record<string, unknown> }).structuredContent;
  expect((sc["items"] as unknown[]).length).toBe(0);
  expect((sc["needsUpc"] as Array<{ productName: string }>).map((i) => i.productName)).toEqual([
    "Strawberries",
  ]);
  expect(textFromResult(result)).toContain("no items with a UPC");
});
```

**4f.** Add the `makeProductService` import.

At the top of `tests/tools/storage-backed-tools.test.ts`, update:

```typescript
import {
  getCapturedHandler,
  getCapturedTool,
  isErrorResult,
  makeContext,
  makeContextWithElicit,
  makeStorage,
  resetToolTestHarness,
  textFromResult,
  unauthenticate,
} from "./tool-test-harness.js";
```

to:

```typescript
import {
  getCapturedHandler,
  getCapturedTool,
  isErrorResult,
  makeContext,
  makeContextWithElicit,
  makeProductService,
  makeStorage,
  resetToolTestHarness,
  textFromResult,
  unauthenticate,
} from "./tool-test-harness.js";
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run tests/tools/storage-backed-tools.test.ts`
Expected: PASS (all tests, including the rewritten "bails when the shopping list has no items with UPCs").

- [ ] **Step 6: Run the full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: PASS across the whole suite except `tests/evals/mcp-agent-contract.test.ts`'s schema-shape assertion and `tests/evals/golden-path.eval.test.ts`'s manual-path test — both still reference the old `productName`-in-input shape and are fixed in Task 11.

- [ ] **Step 8: Commit**

```bash
git add src/tools/shopping-list.ts tests/tools/storage-backed-tools.test.ts
git commit -m "feat: simplify create_shopping_list input to upc/quantity/notes with server-side name enrichment"
```

---

## Task 11: Update remaining schema-shape and eval assertions

**Files:**

- Modify: `tests/evals/mcp-agent-contract.test.ts`
- Modify: `tests/evals/golden-path.eval.test.ts`

**Interfaces:**

- Consumes: the new `createShoppingListInputSchema` shape (Task 10).

- [ ] **Step 1: `tests/evals/mcp-agent-contract.test.ts` — fix the schema `safeParse` assertions**

Replace:

```typescript
expect(
  createShoppingList.config.inputSchema?.safeParse({
    name: "Dinner",
    items: [{ productName: "Milk", quantity: 1 }],
  }).success,
).toBe(true);
```

with:

```typescript
expect(
  createShoppingList.config.inputSchema?.safeParse({
    name: "Dinner",
    items: [{ upc: "0001112223334", quantity: 1 }],
  }).success,
).toBe(true);
```

Also add a new assertion right after it (in the same `it("models product search and shopping list validation in schemas", ...)` block) confirming the old shape without a upc is now rejected:

```typescript
expect(
  createShoppingList.config.inputSchema?.safeParse({
    name: "Dinner",
    items: [{ productName: "Milk", quantity: 1 }],
  }).success,
).toBe(false);
```

- [ ] **Step 2: `tests/evals/golden-path.eval.test.ts` — drop `productName` from the manual-path call**

Replace:

```typescript
const created = await call("create_shopping_list", {
  name: "Bread run",
  items: [{ productName: "Bread", upc: upcs[0], quantity: 1 }],
});
```

with:

```typescript
const created = await call("create_shopping_list", {
  name: "Bread run",
  items: [{ upc: upcs[0], quantity: 1 }],
});
```

- [ ] **Step 3: Run these two test files**

Run: `pnpm exec vitest run tests/evals/mcp-agent-contract.test.ts tests/evals/golden-path.eval.test.ts`
Expected: PASS. (`golden-path.eval.test.ts` exercises the real `buildServer` end-to-end through `cloudflare:test`'s `SELF` — the eval harness's `/v1/products/{id}` fixture route in `tests/evals/harness.ts` already serves `findProductByUpc`, so `create_shopping_list`'s new enrichment call resolves a real fixture description with no harness changes needed.)

- [ ] **Step 4: Commit**

```bash
git add tests/evals/mcp-agent-contract.test.ts tests/evals/golden-path.eval.test.ts
git commit -m "test: update schema and eval assertions for upc-only shopping list input"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: oxlint clean, `pnpm build:views` succeeds (no view changes in this plan, but the design doc's "Views" section confirms `ShoppingListItemData` needs no change — this just confirms nothing broke), `tsc --noEmit` clean.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: all tests pass, including `tests/integration/mcp-client-oauth-integration.test.ts` (exercises the real `buildServer`/OAuth flow — unaffected by this plan but must still pass) and every eval test.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean. If the auto-fixable pre-commit hook already reformatted files during earlier commits, this should be a no-op.

- [ ] **Step 4: Manual spot-check of the cache (optional but recommended)**

Run: `pnpm dev`, then with `mcp-remote` or a similar client call `get_product` twice for the same UPC and confirm (via `wrangler dev`'s console/KV logs, or by adding a temporary `console.log` in `createKrogerCacheMiddleware`) that the second call is served from KV rather than hitting `api.kroger.com` again. Remove any temporary logging before finishing.

- [ ] **Step 5: Final commit (if Step 4 required any cleanup)**

```bash
git status
```

If clean, no commit needed — Tasks 1-11 already captured every change.

---

## Self-Review Notes (for the plan author / first reviewer)

- **Spec coverage:** Design doc §1 (middleware) → Task 2. §2 (client wiring) → Task 2. §3 (shared KV helper) → Task 1. §4 (ProductService) → Task 3. §5 (ToolContext DI) → Tasks 4-5. §6-7 (schema + enrichment) → Task 10. §8 (cache removal) → Task 8. weekly-deals/item-flags consolidation → Task 9. Files Changed table's eval/test rows → Tasks 10-11.
- **`kv` defaulting to `null`** in `createKrogerClients` (Task 2) is a deliberate deviation from the design doc's exact function signature (which shows no default) — it keeps `response-size.test.ts`'s and `client.test.ts`'s existing single-argument call sites compiling without unrelated edits, while `server.ts` (Task 4) always passes a real value. Documented inline in Task 2.
- **Resources.ts error-message branching** (Task 7) intentionally does not fully delegate error formatting to `ProductService` — it branches on `error.type === "NOT_FOUND"` to preserve the two distinct pre-existing messages `tests/tools/resources-registration.test.ts` asserts on. This is the one place `ctx.productService` is consumed without a byte-identical passthrough.
