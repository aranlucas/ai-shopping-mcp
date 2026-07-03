# Cart API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Public `PUT /v1/cart/add` back into the Partner cart spec (fixing the currently broken typecheck), then upgrade `view_cart` to read the live Kroger cart via Partner `GET /v1/carts/{id}` with the existing KV mirror as fallback.

**Architecture:** One merged `kroger/cart.json` OpenAPI spec generates one `cart.d.ts`, so the existing `cartClient` serves both the Public add endpoint and the Partner read endpoint. A new `CartIdStorage` remembers the user's cart UUID (`user:{userId}:kroger-cart-id`) after it is supplied once via `view_cart`'s new optional `cartId` input; there is no automatic discovery (Partner `GET /v1/carts` 403s, `PUT /v1/cart/add` returns 204 with no body). `view_cart` never hard-fails: any live-read problem degrades to the mirror with actionable text.

**Tech Stack:** Cloudflare Workers, TypeScript, openapi-typescript + openapi-fetch, neverthrow, Zod v4 (`zod/v4`), vitest on `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-07-02-cart-api-integration-design.md`

## Global Constraints

- No `any` in TypeScript; parse external JSON from `unknown` with Zod via existing helpers.
- Use generated OpenAPI schema types from `src/services/kroger/cart.js` imports; never derive types from client method signatures.
- `cartClient` must NOT be added to the shared Kroger KV response cache (user data leak). Only the cart _ID_ is stored, user-scoped.
- Prefer `neverthrow` helpers (`fromApiResponse`, `safeStorage`) over `try/catch`; KV failures are non-fatal.
- Import Zod as `import * as z from "zod/v4"`.
- Small-model contract: ids printed as `key=value` in `content[0].text`; response/error text names the next/recovery tool. `tests/evals/golden-path.eval.test.ts:163` requires the literal phrase `in-store/app changes are not shown` in the mirror output — it must survive.
- The working tree has pre-existing uncommitted changes out of scope for this plan (`kroger/product.json`, `kroger/catalog.json`, `src/services/kroger/product.d.ts`, `src/services/kroger/catalog.d.ts`, `package.json`). Do NOT commit or revert them; commit only the files each task names.
- Run commands with `pnpm` (Node >= 24.13).

---

### Task 1: Merge Public `/v1/cart/add` into the Partner cart spec and regenerate types

The working tree's `kroger/cart.json` is the Partner Cart API spec; the committed version at `HEAD` is still the old Public spec. The worker imports `cart.cartItemModel` / `cart.cartItemRequestModel` and calls `PUT /v1/cart/add`, none of which exist in the Partner spec — so `tsc` currently fails with 5 errors. This task merges the Public path/schemas into the Partner spec and fixes a Kroger spec bug (the `/v1/carts/{id}` path param is declared `type: integer` but cart IDs are UUID strings).

**Files:**

- Modify: `kroger/cart.json` (working-tree Partner version)
- Regenerate: `src/services/kroger/cart.d.ts` (via `pnpm generate:cart`)
- Scratch (not committed): `/private/tmp/claude-502/-Users-lucas-Projects-ai-shopping-mcp/a90c4f28-697f-4f7f-998b-68a564d09699/scratchpad/merge-cart-spec.py`

**Interfaces:**

- Consumes: `git show HEAD:kroger/cart.json` (old Public spec), working-tree `kroger/cart.json` (Partner spec).
- Produces: generated types where BOTH exist: `paths["/v1/cart/add"]["put"]` with `components["schemas"]["cart.cartItemModel"]` / `["cart.cartItemRequestModel"]`, AND `paths["/v1/carts/{id}"]["get"]` (`operations["getCart"]`) whose path param is `id: string` and whose 200 body is `components["schemas"]["carts.cartPayloadModel"]` (`{ data?: carts.cartModel }`, items typed `carts.cartItemResponseModel` with optional `description`, `upc`, `quantity` and required `modality`). Task 3 relies on these exact names.

- [ ] **Step 1: Confirm the current failure (this is the failing "test")**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL with exactly these 5 errors — `cart.cartItemModel` / `cart.cartItemRequestModel` missing (src/tools/cart.ts:23-24), `"/v1/cart/add"` not assignable (src/tools/cart.ts:96, tests/services/kroger/client.test.ts:352, :584).

- [ ] **Step 2: Write the merge script**

Create `/private/tmp/claude-502/-Users-lucas-Projects-ai-shopping-mcp/a90c4f28-697f-4f7f-998b-68a564d09699/scratchpad/merge-cart-spec.py`:

```python
import json
import subprocess

partner = json.load(open("kroger/cart.json"))
public = json.loads(subprocess.check_output(["git", "show", "HEAD:kroger/cart.json"]))

# 1. Fix a Kroger spec bug: /v1/carts/{id} declares the id path param as
#    type: integer, but cart IDs are UUID strings (the spec's own example is
#    "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4").
for op in ("get", "put"):
    for param in partner["paths"]["/v1/carts/{id}"][op]["parameters"]:
        if param["name"] == "id":
            param["schema"]["type"] = "string"

# 2. Re-add the Public PUT /v1/cart/add path. The Partner spec names the same
#    error schemas with underscores instead of dots, so remap those $refs.
add_path = public["paths"]["/v1/cart/add"]
remap = {
    "#/components/schemas/Invalid.UPC": "#/components/schemas/Invalid_UPC",
    "#/components/schemas/Invalid.modality": "#/components/schemas/Invalid_modality",
    "#/components/schemas/Invalid.parameters": "#/components/schemas/Invalid_parameters",
}


def walk(node):
    if isinstance(node, dict):
        if node.get("$ref") in remap:
            node["$ref"] = remap[node["$ref"]]
        for value in node.values():
            walk(value)
    elif isinstance(node, list):
        for value in node:
            walk(value)


walk(add_path)
partner["paths"]["/v1/cart/add"] = add_path

# 3. Carry over the two Public schemas src/tools/cart.ts imports by exact name.
for name in ("cart.cartItemModel", "cart.cartItemRequestModel"):
    partner["components"]["schemas"][name] = public["components"]["schemas"][name]

with open("kroger/cart.json", "w") as f:
    json.dump(partner, f, indent=2)
    f.write("\n")
print("merged:", sorted(partner["paths"].keys()))
```

- [ ] **Step 3: Run the merge and regenerate types**

Run (from the repo root `/Users/lucas/Projects/ai-shopping-mcp`):

```bash
python3 /private/tmp/claude-502/-Users-lucas-Projects-ai-shopping-mcp/a90c4f28-697f-4f7f-998b-68a564d09699/scratchpad/merge-cart-spec.py
pnpm generate:cart
```

Expected: script prints `merged: ['/v1/cart/add', '/v1/carts', '/v1/carts/{id}', '/v1/carts/{id}/items', '/v1/carts/{id}/items/{upc}']`; `generate:cart` rewrites `src/services/kroger/cart.d.ts` without error.

- [ ] **Step 4: Verify the typecheck is green and the generated shape is right**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (0 errors).

Run: `grep -n '"/v1/cart/add"\|"cart.cartItemModel"\|id: string' src/services/kroger/cart.d.ts | head`
Expected: all three appear (`id: string` inside the `getCart`/`putCart` operations).

- [ ] **Step 5: Run the existing cart-related suites**

Run: `pnpm exec vitest run tests/tools/cart.test.ts tests/services/kroger/client.test.ts`
Expected: PASS — zero behavioral change; these suites prove `/v1/cart/add` still works exactly as before.

- [ ] **Step 6: Commit**

```bash
git add kroger/cart.json src/services/kroger/cart.d.ts
git commit -m "feat: merge Partner cart endpoints into cart spec, keep Public /v1/cart/add"
```

---

### Task 2: `CartIdStorage`

**Files:**

- Modify: `src/utils/user-storage.ts` (new class after `CartMirrorStorage`, ~line 428; register in `createUserStorage`, ~line 468)
- Modify: `tests/tools/tool-test-harness.ts:163-168` (add `cartId` stub next to `cartMirror`)
- Test: `tests/utils/user-storage.test.ts`

**Interfaces:**

- Consumes: private `getKey(userId, dataType)` helper (`user:{userId}:{dataType}`) already in `user-storage.ts`.
- Produces: `class CartIdStorage { get(userId: string): Promise<string | null>; set(userId: string, cartId: string): Promise<void> }`, exposed as `ctx.storage.cartId` (key: `user:{userId}:kroger-cart-id`). Task 3 calls `ctx.storage.cartId.get(...)` / `.set(...)`.

- [ ] **Step 1: Write the failing tests**

In `tests/utils/user-storage.test.ts`, add `CartIdStorage` to the existing import block from `../../src/utils/user-storage.js`, then add after the `CartMirrorStorage` describe block (~line 568):

```typescript
// ----- CartIdStorage -----

describe("CartIdStorage", () => {
  let kv: KVNamespace;
  let storage: CartIdStorage;

  beforeEach(() => {
    kv = createMockKV();
    storage = new CartIdStorage(kv);
  });

  it("set then get round-trips the cart id", async () => {
    await storage.set("user1", "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4");
    expect(await storage.get("user1")).toBe("2b9b3963-5cac-42f8-9d28-7bebdec0b9e4");
  });

  it("get returns null when no cart id is stored", async () => {
    expect(await storage.get("user1")).toBeNull();
  });

  it("namespaces the key by user id", async () => {
    await storage.set("user1", "cart-a");
    expect(await storage.get("user2")).toBeNull();
  });
});
```

And inside the `createUserStorage` describe (~line 685), extend the existing `creates all storage instances` test with:

```typescript
expect(storage.cartId).toBeInstanceOf(CartIdStorage);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/utils/user-storage.test.ts`
Expected: FAIL — `CartIdStorage` has no exported member / is not defined.

- [ ] **Step 3: Implement `CartIdStorage`**

In `src/utils/user-storage.ts`, after the `CartMirrorStorage` class (~line 428):

```typescript
/**
 * Kroger Cart ID Storage — remembers the user's live Kroger cart UUID so
 * view_cart can read the real cart without the model re-supplying it.
 * The value is a plain string, not JSON.
 */
export class CartIdStorage {
  constructor(private kv: KVNamespace) {}

  async get(userId: string): Promise<string | null> {
    return this.kv.get(getKey(userId, "kroger-cart-id"));
  }

  async set(userId: string, cartId: string): Promise<void> {
    await this.kv.put(getKey(userId, "kroger-cart-id"), cartId);
  }
}
```

In `createUserStorage` (~line 468), add to the returned object:

```typescript
    cartId: new CartIdStorage(kv),
```

In `tests/tools/tool-test-harness.ts`, add to the `storage` object literal in `makeStorage` (after the `cartMirror` entry, line 168):

```typescript
    cartId: {
      get: async () => null,
      set: async () => {},
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/utils/user-storage.test.ts && pnpm exec tsc --noEmit`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/user-storage.ts tests/utils/user-storage.test.ts tests/tools/tool-test-harness.ts
git commit -m "feat: add CartIdStorage for remembering the live Kroger cart id"
```

---

### Task 3: `view_cart` live read with mirror fallback

**Files:**

- Modify: `src/tools/cart.ts` (the `view_cart` registration, lines 321-358, plus new helpers and type aliases near the top)
- Test: `tests/tools/cart.test.ts` (extend `makeStorage`/`makeContext` helpers lines 112-191 and the `view_cart` describe block lines 548-630)

**Interfaces:**

- Consumes: `cartClient.GET("/v1/carts/{id}", { params: { path: { id } } })` from Task 1's types; `ctx.storage.cartId.get/set` from Task 2; existing `fromApiResponse`, `safeStorage`, `toMcpError`, `getProps`, `textResult`.
- Produces: `view_cart` input schema `{ cartId?: string }`; live output containing `cartId={id}` and per-item `upc=` lines; mirror output retaining the phrase `in-store/app changes are not shown`.

- [ ] **Step 1: Extend the test helpers**

In `tests/tools/cart.test.ts`:

1. Add two parameters to the local `makeStorage` (line 112) and a `cartId` entry to its returned object:

```typescript
function makeStorage(
  storedList: ShoppingList | null = null,
  storedLocation: PreferredLocation | null = null,
  snapshotSetCalls: unknown[][] = [],
  existingSnapshot: CartSnapshotItem[] | null = null,
  mirrorAppendCalls: unknown[][] = [],
  mirrorItems: Array<CartSnapshotItem & { addedAt: string }> = [],
  storedCartId: string | null = null,
  cartIdSetCalls: string[][] = [],
): UserStorage {
```

and inside the returned object (after `cartMirror`):

```typescript
    cartId: {
      get: async () => storedCartId,
      set: async (userId: string, cartId: string) => {
        cartIdSetCalls.push([userId, cartId]);
      },
    } as unknown as UserStorage["cartId"],
```

2. Add a GET stub to `makeContext` (line 151). Extend the signature and the `cartClient` literal:

```typescript
type GetCall = { path: string; options: unknown };

const LIVE_CART = {
  id: "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4",
  items: [
    {
      upc: "0001111040110",
      description: "QFC Vitamin D Whole Milk Gallon",
      quantity: 1,
      modality: "PICKUP" as const,
    },
  ],
};

function makeContext(
  storage?: UserStorage,
  putConfig: { status: number; throws?: boolean } = { status: 204 },
  getConfig: { status: number; cart?: typeof LIVE_CART } = { status: 200, cart: LIVE_CART },
): {
  context: ToolContext;
  putCalls: PutCall[];
  snapshotSetCalls: unknown[][];
  getCalls: GetCall[];
} {
```

with, inside the `cartClient` object literal next to `PUT`:

```typescript
        GET: async (path: string, options: unknown) => {
          getCalls.push({ path, options });
          if (getConfig.status !== 200) {
            return {
              data: undefined,
              error: { reason: "cart not found" },
              response: new Response("{}", { status: getConfig.status }),
            };
          }
          return {
            data: { data: getConfig.cart },
            response: new Response(null, { status: 200 }),
          };
        },
```

(declare `const getCalls: GetCall[] = [];` beside `putCalls` and add `getCalls` to the return object).

- [ ] **Step 2: Write the failing tests**

Add to the `view_cart tool` describe block (after the existing tests, before its closing `});` at line 630):

```typescript
it("reads the live cart when an explicit cartId is passed and prints cartId= and upc=", async () => {
  const cartIdSetCalls: string[][] = [];
  const storage = makeStorage(null, null, [], null, [], [], null, cartIdSetCalls);
  const { context, getCalls } = makeContext(storage);
  registerCartTools(context);

  const result = await getCapturedHandler("view_cart")({
    cartId: "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4",
  });

  expect(isErrorResult(result)).toBe(false);
  const text = textFromResult(result);
  expect(text).toContain("cartId=2b9b3963-5cac-42f8-9d28-7bebdec0b9e4");
  expect(text).toContain("QFC Vitamin D Whole Milk Gallon x1");
  expect(text).toContain("upc=0001111040110");
  expect(getCalls).toHaveLength(1);
  expect(getCalls[0].path).toBe("/v1/carts/{id}");
});

it("persists the cartId after a successful live read", async () => {
  const cartIdSetCalls: string[][] = [];
  const storage = makeStorage(null, null, [], null, [], [], null, cartIdSetCalls);
  const { context } = makeContext(storage);
  registerCartTools(context);

  await getCapturedHandler("view_cart")({ cartId: "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4" });

  expect(cartIdSetCalls).toEqual([[USER_ID, "2b9b3963-5cac-42f8-9d28-7bebdec0b9e4"]]);
});

it("uses the stored cartId for a live read when no cartId is passed", async () => {
  const storage = makeStorage(null, null, [], null, [], [], "stored-cart-id");
  const { context, getCalls } = makeContext(storage);
  registerCartTools(context);

  const result = await getCapturedHandler("view_cart")({});

  expect(textFromResult(result)).toContain("cartId=stored-cart-id");
  expect(getCalls).toHaveLength(1);
});

it("falls back to the mirror with a cartId hint when no id is known", async () => {
  const storage = makeStorage(
    null,
    null,
    [],
    null,
    [],
    [
      {
        upc: "0001111042578",
        quantity: 2,
        modality: "PICKUP",
        productName: "Organic Whole Milk",
        addedAt: "2026-06-30T00:00:00.000Z",
      },
    ],
  );
  const { context, getCalls } = makeContext(storage);
  registerCartTools(context);

  const result = await getCapturedHandler("view_cart")({});

  const text = textFromResult(result);
  expect(getCalls).toHaveLength(0);
  expect(text).toContain("in-store/app changes are not shown");
  expect(text).toContain("cartId");
});

it("falls back to the mirror and names the failed cartId when the live read errors", async () => {
  const storage = makeStorage(
    null,
    null,
    [],
    null,
    [],
    [
      {
        upc: "0001111042578",
        quantity: 2,
        modality: "PICKUP",
        productName: "Organic Whole Milk",
        addedAt: "2026-06-30T00:00:00.000Z",
      },
    ],
  );
  const { context } = makeContext(storage, { status: 204 }, { status: 404 });
  registerCartTools(context);

  const result = await getCapturedHandler("view_cart")({ cartId: "stale-cart-id" });

  expect(isErrorResult(result)).toBe(false);
  const text = textFromResult(result);
  expect(text).toContain("cartId=stale-cart-id");
  expect(text).toContain("in-store/app changes are not shown");
  expect(text).toContain("Organic Whole Milk x2");
});

it("declares openWorldHint true now that it can call the Kroger API", () => {
  const { context } = makeContext(makeStorage());
  registerCartTools(context);
  const tool = testState.capturedTools.find((t) => t.name === "view_cart");
  const config = tool?.config as { annotations?: { openWorldHint?: boolean } };
  expect(config.annotations?.openWorldHint).toBe(true);
});
```

- [ ] **Step 3: Run tests to verify the new ones fail and the old ones pass**

Run: `pnpm exec vitest run tests/tools/cart.test.ts`
Expected: the 6 new tests FAIL (no `cartId` handling, GET never called, `openWorldHint` false); all pre-existing tests PASS.

- [ ] **Step 4: Implement the `view_cart` upgrade**

In `src/tools/cart.ts`:

1. Add a type alias next to the existing ones (line 23-24):

```typescript
type LiveCart = components["schemas"]["carts.cartModel"];
```

2. Add helpers above `registerCartTools`:

```typescript
const viewCartInputSchema = z.object({
  cartId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Kroger cart UUID for a live cart read. Remembered after the first successful call, so later calls can omit it.",
    ),
});

function formatLiveCart(cart: LiveCart, cartId: string): string {
  const items = cart.items ?? [];
  const lines = items.map(
    (item) =>
      `- ${item.description ?? item.upc} x${item.quantity ?? 1} | upc=${item.upc} | ${item.modality}`,
  );
  return [
    `Live Kroger cart (cartId=${cartId}): ${items.length} item(s)`,
    lines.join("\n"),
    "Add more items with shop_for_items or add_shopping_list_to_cart.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Mirror fallback for view_cart: shows what this assistant added to the cart.
 * `note` (when set) explains why the live cart is not being shown.
 */
function mirrorFallbackResult(ctx: ToolContext, userId: string, note?: string) {
  return safeStorage(() => ctx.storage.cartMirror.getAll(userId), "fetch cart mirror").match(
    (items) => {
      const parts: string[] = note ? [note] : [];
      if (items.length === 0) {
        parts.push(
          "No items added to your cart through this assistant yet. Use shop_for_items to search for items and add them to your Kroger cart.",
        );
      } else {
        const lines = items.map(
          (item) =>
            `- ${item.productName ?? item.upc} x${item.quantity} | upc=${item.upc} | ${item.modality}`,
        );
        parts.push(
          `Items added to your Kroger cart through this assistant (in-store/app changes are not shown):\n\n${lines.join("\n")}`,
        );
      }
      return textResult(parts.join("\n\n"));
    },
    toMcpError,
  );
}
```

3. Replace the whole `ctx.server.registerTool("view_cart", ...)` block (lines 321-358) with:

```typescript
ctx.server.registerTool(
  "view_cart",
  {
    title: "View Cart",
    description:
      "Shows the live Kroger cart when a cartId (from the Kroger website/app) has been provided once — it is remembered afterwards. Without one, shows only items added through this assistant.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: viewCartInputSchema,
  },
  async ({ cartId }) => {
    const props = getProps();

    const resolvedId =
      cartId ??
      (await safeStorage(() => ctx.storage.cartId.get(props.id), "read stored cart id").match(
        (value) => value,
        () => null,
      ));

    if (!resolvedId) {
      return mirrorFallbackResult(
        ctx,
        props.id,
        "No live cart id known — pass cartId to view_cart once to enable live cart reads.",
      );
    }

    const liveResult = await fromApiResponse(
      cartClient.GET("/v1/carts/{id}", { params: { path: { id: resolvedId } } }),
      "read live cart",
    );

    return liveResult.match(
      async (payload) => {
        await safeStorage(
          () => ctx.storage.cartId.set(props.id, resolvedId),
          "store cart id",
        ).orTee((error) => console.warn("Cart id store failed (non-fatal):", error.message));
        return textResult(formatLiveCart(payload.data ?? {}, resolvedId));
      },
      (error) =>
        mirrorFallbackResult(
          ctx,
          props.id,
          cartId
            ? `Live cart read failed for cartId=${cartId} — the id may be stale or wrong. Showing items added through this assistant instead.`
            : `Live cart read failed (${error.message}). Showing items added through this assistant instead.`,
        ),
    );
  },
);
```

Note: `registerCartTools` destructures `const { cartClient } = ctx.clients;` at the top — the GET call reuses it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/tools/cart.test.ts && pnpm exec tsc --noEmit`
Expected: PASS (all old and new tests), 0 type errors.

- [ ] **Step 6: Run the eval and contract suites (small-model contract gate)**

Run: `pnpm exec vitest run tests/evals/ tests/tools/response-size.test.ts`
Expected: PASS. `golden-path.eval.test.ts` exercises no-arg `view_cart` (no stored id in the eval KV → mirror fallback) and requires the `in-store/app changes are not shown` phrase and extractable `upc=` values. `token-budget.eval.test.ts` re-measures the tool surface — the new `cartId` input and description change add a small number of tokens; the suite must stay green WITHOUT raising budgets. If it fails, shorten the description/hint text, don't touch budgets.

- [ ] **Step 7: Commit**

```bash
git add src/tools/cart.ts tests/tools/cart.test.ts
git commit -m "feat: view_cart reads the live Kroger cart with mirror fallback"
```

---

### Task 4: Documentation and full verification

**Files:**

- Modify: `docs/cart-api-plan.md` (append an outcome section)

**Interfaces:**

- Consumes: decisions recorded in `docs/superpowers/specs/2026-07-02-cart-api-integration-design.md`.
- Produces: plan doc that reads as decided, not open.

- [ ] **Step 1: Append an outcome section to `docs/cart-api-plan.md`**

Add at the end of the file:

```markdown
---

## Outcome (2026-07-02)

Design: `docs/superpowers/specs/2026-07-02-cart-api-integration-design.md`.

**Adopted:**

- Merged spec: `kroger/cart.json` now contains the Partner endpoints plus the
  Public `PUT /v1/cart/add` (still the only write path we use). One
  `cartClient` serves both. The Partner spec's `integer` type on the
  `/v1/carts/{id}` path param was corrected to `string` (cart IDs are UUIDs).
- `view_cart` reads the live cart via Partner `GET /v1/carts/{id}` when a
  cart ID is known, falling back to the assistant-only KV mirror otherwise.
- Cart ID bootstrap is manual: `view_cart` accepts an optional `cartId` once
  and remembers it per user (`user:{userId}:kroger-cart-id`). The "cache the
  cart ID after `PUT /v1/cart/add`" idea in this doc does not work — that
  endpoint returns 204 with no body.

**Deferred:**

- Atlas API (`www.qfc.com/atlas/v1`): out of scope — Akamai browser-header
  fragility. It remains the only known automatic cart-ID discovery path.
- Cart mutation tools (`remove_from_cart` / `update_cart_item`): blocked on
  Partner `cart.basic:rw`; revisit with a Partner app registration.
- Catalog API V2 (`kroger/catalog.json`): spec committed but unwired; needs
  its own design.
```

- [ ] **Step 2: Full verification**

Run: `pnpm build && pnpm test`
Expected: build green (oxlint, view build, worker + views typecheck) and the entire test suite (including `pnpm eval:mcp` suites, which run as part of `pnpm test`) PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/cart-api-plan.md
git commit -m "docs: record cart API integration outcome in cart-api-plan"
```
