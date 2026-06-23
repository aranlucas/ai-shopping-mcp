# UI Refresh — shadcn + Instacart Visual Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce shadcn/ui components via the CLI, redesign product cards Instacart-style (image + quantity stepper), add skeleton loaders, add an order history view, polish three existing views, and fix four tool descriptions.

**Architecture:** shadcn components live in `views/shared/ui/`. The CLI is initialized at project root with a `components.json` pointing into the `views/` subtree. The existing `--app-*` CSS variable system is preserved; shadcn's CSS vars are wired to it via overrides added after CLI init. New `ProductCard` uses `Card` from shadcn as its structural wrapper.

**Tech Stack:** React 19, Tailwind v4 (`@tailwindcss/vite`), shadcn/ui (new-york style), Vite 8 with `vite-plugin-singlefile`, Vitest + Cloudflare Workers pool.

## Global Constraints

- All new `.ts`/`.tsx` files in `views/` must compile under `views/tsconfig.json`.
- No `any` in TypeScript — use schema-inferred types or explicit narrowing.
- Tailwind CSS is v4 — no `tailwind.config.ts`, all tokens are in `views/styles.css`.
- `pnpm test` must pass before handback; `pnpm build:views` must succeed after every client-side change.
- `vite-plugin-singlefile` bundles everything inline — new packages must be browser-safe (no Node.js-only APIs).
- Follow the existing `import … from "…/foo.js"` extension convention in view files.
- Views root is `views/`; server root is `src/`. Keep them separate.
- Run `pnpm install` after every `package.json` change.

---

### Task 1: shadcn CLI init + path alias setup

**Files:**

- Modify: `views/tsconfig.json`
- Modify: `vite.config.ts`
- Create: `components.json` (project root)
- Modify: `views/styles.css` (CLI will patch; then we override vars)

**Interfaces:**

- Produces: `views/shared/ui/utils.ts` exporting `cn(...inputs): string`; `views/styles.css` with shadcn `@theme inline` block and CSS var overrides.

- [ ] **Step 1: Add `@/*` path alias to views/tsconfig.json**

Replace the entire file:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "Preserve",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["../worker-configuration.d.ts"],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["./**/*.ts", "./**/*.tsx"]
}
```

- [ ] **Step 2: Add `@/*` alias to vite.config.ts**

In the `resolve.alias` block, add `"@": path.resolve(__dirname, "views")`:

```ts
resolve: {
  alias: {
    "@views": path.resolve(__dirname, "./views"),
    "@": path.resolve(__dirname, "views"),
  },
},
```

- [ ] **Step 3: Create components.json at project root**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "views/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/shared",
    "utils": "@/shared/ui/utils",
    "ui": "@/shared/ui",
    "lib": "@/shared/ui",
    "hooks": "@/shared"
  }
}
```

- [ ] **Step 4: Run shadcn init (skip prompts)**

```bash
npx shadcn@latest init --defaults --skip-preflight
```

Expected: CLI reads `components.json`, patches `views/styles.css` with an `@theme inline` block and `:root { --background: ...; --radius: ...; ... }` CSS vars, creates `views/shared/ui/utils.ts`.

If prompted for anything: confirm defaults.

- [ ] **Step 5: Override shadcn CSS vars to respect the host theme**

The CLI adds a `:root { --background: oklch(...); ... }` block. Replace those generated values with mappings to the existing `--app-*` / `--color-*` tokens.

In `views/styles.css`, locate the generated `:root` block the CLI added and replace the variable values (keep the variable names — only change the values):

```css
/* shadcn CSS vars — mapped to the MCP host theming system */
:root {
  --background: var(--color-background-primary, #ffffff);
  --foreground: var(--color-text-primary, #111827);
  --card: var(--app-card-bg, #ffffff);
  --card-foreground: var(--color-text-primary, #111827);
  --popover: var(--color-background-primary, #ffffff);
  --popover-foreground: var(--color-text-primary, #111827);
  --primary: var(--app-accent, #15803d);
  --primary-foreground: var(--color-text-on-accent, #ffffff);
  --secondary: var(--color-background-tertiary, #f3f4f6);
  --secondary-foreground: var(--color-text-secondary, #4b5563);
  --muted: var(--color-background-tertiary, #f3f4f6);
  --muted-foreground: var(--color-text-tertiary, #6b7280);
  --accent: var(--app-accent-bg, rgba(21, 128, 61, 0.08));
  --accent-foreground: var(--app-accent-text, #15803d);
  --destructive: var(--color-red-600, #dc2626);
  --border: var(--app-border, rgba(0, 0, 0, 0.07));
  --input: var(--app-border, rgba(0, 0, 0, 0.07));
  --ring: var(--app-accent, #15803d);
  --radius: var(--radius-card, 0.75rem);
}
```

- [ ] **Step 6: Install deps and verify build**

```bash
pnpm install
pnpm build:views
```

Expected: build succeeds, `dist/views/mcp-app.html` updated.

- [ ] **Step 7: Commit**

```bash
git add views/tsconfig.json vite.config.ts components.json views/styles.css views/shared/ui/utils.ts
git commit -m "feat: initialize shadcn/ui with new-york style, wire CSS vars to host theme"
```

---

### Task 2: Add shadcn Skeleton, Badge, Card, Separator, ScrollArea components

**Files:**

- Create: `views/shared/ui/skeleton.tsx`
- Create: `views/shared/ui/badge.tsx`
- Create: `views/shared/ui/card.tsx`
- Create: `views/shared/ui/separator.tsx`
- Create: `views/shared/ui/scroll-area.tsx`

**Interfaces:**

- Produces:
  - `Skeleton({ className })` — shimmer placeholder div
  - `Badge({ variant, className, children })` — variant: `"green"|"red"|"yellow"|"blue"|"gray"|"purple"`
  - `Card({ className, children })`, `CardContent(…)`, `CardFooter(…)` — card wrappers
  - `Separator({ orientation?, className })` — `"horizontal"|"vertical"`, default horizontal
  - `ScrollArea({ className, children, orientation? })` — scrollable container

- [ ] **Step 1: Add shadcn components via CLI**

```bash
npx shadcn@latest add skeleton badge card separator scroll-area
```

Expected: CLI creates files in `views/shared/ui/`, installs any missing `@radix-ui/*` peer deps.

- [ ] **Step 2: Verify created files**

```bash
ls views/shared/ui/
```

Expected output includes: `utils.ts skeleton.tsx badge.tsx card.tsx separator.tsx scroll-area.tsx`

- [ ] **Step 3: Patch Badge to match existing variant system**

The CLI-generated Badge uses shadcn's default variants. Replace `views/shared/ui/badge.tsx` with a version matching the codebase's existing variant names:

```tsx
import type { ReactNode } from "react";
import { cn } from "./utils.js";

type BadgeVariant = "green" | "red" | "yellow" | "blue" | "gray" | "purple";

const variantClasses: Record<BadgeVariant, string> = {
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-600",
  yellow: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  gray: "bg-gray-100 text-gray-500",
  purple: "bg-purple-50 text-purple-700",
};

export function Badge({
  variant = "gray",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Patch Card to use app design tokens (shadow-depth, not border-depth)**

Replace `views/shared/ui/card.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "./utils.js";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "bg-[var(--app-card-bg)] rounded-lg shadow-sm hover:shadow-md transition-shadow duration-150 overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("p-3", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("px-3 py-2.5 border-t border-[var(--app-border)]", className)}>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Build and verify no type errors**

```bash
pnpm build:views
```

Expected: succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add views/shared/ui/ package.json pnpm-lock.yaml
git commit -m "feat: add shadcn Skeleton, Badge, Card, Separator, ScrollArea components"
```

---

### Task 3: Product schema — add images field

**Files:**

- Modify: `src/tools/output-schemas.ts` (add `images` to `productSchema`)
- Test: `tests/tools/output-schemas.test.ts` (new file)

**Interfaces:**

- Produces: `productSchema` with `images?: Array<{ perspective?, featured?, sizes?: Array<{ id?, size?, url? }> }>` — flows through to `ProductData` type in views.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/output-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getProductDetailsOutputSchema,
  searchProductsOutputSchema,
} from "../../src/tools/output-schemas.js";

describe("productSchema images field", () => {
  it("accepts a product with images", () => {
    const payload = {
      _view: "get_product_details" as const,
      product: {
        upc: "0001234567890",
        description: "Whole Milk",
        images: [
          {
            perspective: "front",
            sizes: [
              {
                id: "medium",
                size: "medium",
                url: "https://www.kroger.com/product/images/medium/front/0001234567890",
              },
            ],
          },
        ],
        items: [],
      },
    };
    const result = getProductDetailsOutputSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.product.images?.[0]?.perspective).toBe("front");
      expect(result.data.product.images?.[0]?.sizes?.[0]?.url).toContain("kroger.com");
    }
  });

  it("accepts a product without images (backward compat)", () => {
    const payload = {
      _view: "get_product_details" as const,
      product: { upc: "0001234567890", description: "Whole Milk", items: [] },
    };
    const result = getProductDetailsOutputSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("images field flows through search results", () => {
    const payload = {
      _view: "search_products" as const,
      totalProducts: 1,
      results: [
        {
          term: "milk",
          products: [
            {
              upc: "0001234567890",
              images: [
                {
                  perspective: "front",
                  sizes: [{ id: "medium", url: "https://example.com/img.jpg" }],
                },
              ],
            },
          ],
          count: 1,
          failed: false,
        },
      ],
    };
    const result = searchProductsOutputSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results[0]?.products[0]?.images?.[0]?.sizes?.[0]?.url).toBe(
        "https://example.com/img.jpg",
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run tests/tools/output-schemas.test.ts
```

Expected: FAIL — `images` field not in schema so it gets stripped by strict parse (or the type is wrong).

- [ ] **Step 3: Add images to productSchema in output-schemas.ts**

In `src/tools/output-schemas.ts`, inside `productSchema = z.looseObject({…})`, add the `images` field after `aisleLocations`:

```ts
images: z
  .array(
    z.looseObject({
      perspective: z.string().optional(),
      featured: z.boolean().optional(),
      sizes: z
        .array(
          z.looseObject({
            id: z.string().optional(),
            size: z.string().optional(),
            url: z.string().optional(),
          }),
        )
        .optional(),
    }),
  )
  .optional(),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run tests/tools/output-schemas.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/output-schemas.ts tests/tools/output-schemas.test.ts
git commit -m "feat: add images field to productSchema output"
```

---

### Task 4: ProductCard redesign — Instacart style (image + quantity stepper)

**Files:**

- Modify: `views/shared/components.tsx`

**Interfaces:**

- Consumes: `Card`, `CardContent`, `CardFooter` from `@/shared/ui/card.js`; `ProductData` from `./types.js` (now has `images?`).
- Produces: updated `ProductCard` with image area, `QuantityStepper`, `ProductImage` helpers; `ProductActions` removed (merged in).

- [ ] **Step 1: Update ProductCard in views/shared/components.tsx**

Replace the existing `ProductActions` export and `ProductCard` export entirely. The new `ProductCard` inlines the action logic with a quantity stepper. Keep all other exports (`Badge`, `SectionHeader`, `DisplayModeToggle`, `FulfillmentTags`, `PriceDisplay`, `ActionButton`) unchanged.

Add these imports at the top of `components.tsx`:

```tsx
import { Card, CardContent, CardFooter } from "./ui/card.js";
```

Replace `ProductActions` and `ProductCard` with:

```tsx
function ProductImage({ product }: { product: ProductData }) {
  const images = (
    product as ProductData & {
      images?: Array<{
        perspective?: string;
        sizes?: Array<{ id?: string; url?: string }>;
      }>;
    }
  ).images;
  const front = images?.find((i) => i.perspective === "front") ?? images?.[0];
  const url = front?.sizes?.find((s) => s.id === "medium")?.url ?? front?.sizes?.[0]?.url;

  if (!url) {
    return (
      <div className="w-full aspect-square bg-gray-50 flex items-center justify-center">
        <svg
          aria-hidden="true"
          className="w-10 h-10 text-gray-200"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="w-full aspect-square bg-gray-50 overflow-hidden">
      <img
        src={url}
        alt={product.description ?? "Product"}
        className="w-full h-full object-contain p-2"
        loading="lazy"
      />
    </div>
  );
}

function QuantityStepper({
  qty,
  loading,
  onDecrement,
  onIncrement,
}: {
  qty: number;
  loading: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex items-center rounded-full overflow-hidden bg-[var(--app-accent)] text-white h-7 shrink-0">
      <button
        type="button"
        onClick={onDecrement}
        disabled={loading}
        aria-label="Decrease quantity"
        className="px-2.5 h-full flex items-center justify-center text-white/90 hover:bg-black/10 transition-colors bg-transparent border-0 cursor-pointer disabled:cursor-not-allowed text-sm font-medium"
      >
        −
      </button>
      <span className="px-1 text-xs font-semibold min-w-5 text-center tabular-nums">
        {loading ? (
          <svg
            aria-hidden="true"
            className="animate-spin w-3 h-3 mx-auto"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          qty
        )}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={loading}
        aria-label="Increase quantity"
        className="px-2.5 h-full flex items-center justify-center text-white/90 hover:bg-black/10 transition-colors bg-transparent border-0 cursor-pointer disabled:cursor-not-allowed text-sm font-medium"
      >
        +
      </button>
    </div>
  );
}

export function ProductCard({
  product,
  canCallTools,
  onAddToCart,
  onAddToList,
}: {
  product: ProductData;
  canCallTools: boolean;
  onAddToCart: (upc: string, qty: number) => Promise<void>;
  onAddToList: (name: string, upc: string) => Promise<void>;
}) {
  const [qty, setQty] = useState(0);
  const [cartLoading, setCartLoading] = useState(false);
  const [listState, setListState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;
  const size = product.items?.[0]?.size;

  const handleAdd = async () => {
    if (!upc) return;
    setCartLoading(true);
    setErrorMsg(null);
    try {
      await onAddToCart(upc, 1);
      setQty(1);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to add to cart");
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      setCartLoading(false);
    }
  };

  const handleIncrement = async () => {
    if (!upc) return;
    setCartLoading(true);
    try {
      await onAddToCart(upc, 1);
      setQty((q) => q + 1);
    } catch {
      // qty unchanged
    } finally {
      setCartLoading(false);
    }
  };

  const handleDecrement = () => {
    setQty((q) => Math.max(0, q - 1));
  };

  const handleAddToList = async () => {
    if (!upc) return;
    setListState("loading");
    setErrorMsg(null);
    try {
      await onAddToList(name, upc);
      setListState("done");
      setTimeout(() => setListState("idle"), 2000);
    } catch (e) {
      setListState("error");
      setErrorMsg(e instanceof Error ? e.message : "Failed to add to list");
      setTimeout(() => {
        setListState("idle");
        setErrorMsg(null);
      }, 4000);
    }
  };

  return (
    <Card className="flex flex-col">
      <ProductImage product={product} />

      <CardContent className="flex-1 flex flex-col gap-1">
        <div className="font-medium text-[13px] text-gray-900 leading-snug line-clamp-2">
          {name}
        </div>
        {(brand || size) && (
          <div className="text-[11px] text-gray-400">
            {brand}
            {brand && size && " · "}
            {size}
          </div>
        )}
        <FulfillmentTags product={product} />
        <div className="mt-auto pt-1.5 flex items-center justify-between gap-2">
          <PriceDisplay product={product} />
          {upc &&
            (qty > 0 ? (
              <QuantityStepper
                qty={qty}
                loading={cartLoading}
                onDecrement={handleDecrement}
                onIncrement={handleIncrement}
              />
            ) : (
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canCallTools || cartLoading}
                className="shrink-0 flex items-center gap-1 rounded-full bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] active:bg-[var(--app-accent-active)] text-white px-3 py-1 text-xs font-semibold transition-colors border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cartLoading ? (
                  <svg
                    aria-hidden="true"
                    className="animate-spin w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <>
                    <svg
                      aria-hidden="true"
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                    Add
                  </>
                )}
              </button>
            ))}
        </div>
      </CardContent>

      {upc && (
        <CardFooter className="flex items-center justify-between">
          <ActionButton
            state={listState}
            onClick={handleAddToList}
            disabled={!canCallTools}
            idleLabel="Save to List"
            loadingLabel="Saving…"
            doneLabel="Saved!"
            failLabel="Failed"
            variant="secondary"
            icon={
              <svg
                aria-hidden="true"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          />
          {errorMsg && (
            <span className="text-[11px] text-red-600 truncate max-w-28">{errorMsg}</span>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Update ProductSearch carousel to use ScrollArea**

In `views/app/views/ProductSearch.tsx`, add the ScrollArea import and wrap the carousel:

```tsx
import { ScrollArea } from "../../shared/ui/scroll-area.js";
```

In `ProductCarousel`, replace the inner `<div ref={scrollRef} className="flex gap-2 overflow-x-auto pb-1 scroll-smooth" …>` with:

```tsx
<ScrollArea orientation="horizontal" className="w-full">
  <div
    ref={scrollRef}
    className="flex gap-2 pb-1"
    style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
  >
    {products.map((product) => (
      <div
        key={product.upc ?? product.description}
        className="shrink-0 w-52"
        style={{ scrollSnapAlign: "start" }}
      >
        <ProductCard
          product={product}
          onAddToCart={onAddToCart}
          onAddToList={onAddToList}
          canCallTools={canCallTools}
        />
      </div>
    ))}
  </div>
</ScrollArea>
```

- [ ] **Step 3: Build views to confirm no type errors**

```bash
pnpm build:views
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add views/shared/components.tsx views/app/views/ProductSearch.tsx
git commit -m "feat: redesign ProductCard with product images and quantity stepper (Instacart style)"
```

---

### Task 5: Skeleton loading states

**Files:**

- Modify: `views/shared/status.tsx` (add skeleton exports)
- Modify: `views/app/views/ProductSearch.tsx`
- Modify: `views/app/views/WeeklyDeals.tsx`
- Modify: `views/app/views/ShoppingList.tsx`
- Modify: `views/app/views/Pantry.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `@/shared/ui/skeleton.js`
- Produces: `ProductCardSkeleton()`, `DealCardSkeleton()`, `ItemRowSkeleton()` exported from `views/shared/status.tsx`

- [ ] **Step 1: Add skeleton components to status.tsx**

Add this import at the top of `views/shared/status.tsx`:

```tsx
import { Skeleton } from "./ui/skeleton.js";
```

Add these exports at the bottom of the file:

```tsx
export function ProductCardSkeleton() {
  return (
    <div className="bg-[var(--app-card-bg)] rounded-lg shadow-sm overflow-hidden flex flex-col w-52 shrink-0">
      <Skeleton className="w-full aspect-square rounded-none" />
      <div className="p-3 flex flex-col gap-2">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
        <div className="flex items-center justify-between mt-1">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-7 w-16 rounded-full" />
        </div>
      </div>
      <div className="px-3 py-2.5 border-t border-[var(--app-border)]">
        <Skeleton className="h-6 w-24" />
      </div>
    </div>
  );
}

export function DealCardSkeleton() {
  return (
    <div className="bg-[var(--app-card-bg)] rounded-lg shadow-sm overflow-hidden p-3 flex flex-col gap-2">
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-2.5 w-full" />
      <Skeleton className="h-2.5 w-2/3" />
      <div className="flex items-center justify-between mt-1">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      <div className="flex gap-1.5 mt-2 pt-2 border-t border-[var(--app-border)]">
        <Skeleton className="h-7 w-28 rounded" />
        <Skeleton className="h-7 w-20 rounded" />
      </div>
    </div>
  );
}

export function ItemRowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <Skeleton className="shrink-0 w-3.5 h-3.5 rounded-sm" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
      <Skeleton className="w-6 h-6 rounded" />
    </div>
  );
}
```

- [ ] **Step 2: Use ProductCardSkeleton in ProductSearch**

In `views/app/views/ProductSearch.tsx`, add import:

```tsx
import { EmptyState, ProductCardSkeleton } from "../../shared/status.js";
```

In `ProductSearchView`, replace the `!hasResults` empty state block with a check that also shows skeletons when `partialArgs` exist. Add a `partialArgs` prop:

```tsx
export function ProductSearchView({
  data,
  app,
  canCallTools,
  hostContext,
}: {
  data: ProductSearchResultsContent;
  app: App | null;
  canCallTools: boolean;
  hostContext?: McpUiHostContext;
});
```

Then, before the `results.map(...)`, add a skeleton section when there are no results yet (this only shows transiently during loading, but `data` is always present when this component renders, so skeletons show via the `Loading` wrapper in `App.tsx`).

Actually, the skeletons for ProductSearch, WeeklyDeals, ShoppingList, and Pantry show _before_ data arrives — which means they show in the `Loading` state in `App.tsx`. Update `App.tsx`'s `ShoppingAppInner` to show view-specific skeletons based on `toolName`:

In `views/App.tsx`, add import:

```tsx
import {
  DealCardSkeleton,
  ItemRowSkeleton,
  Loading,
  ProductCardSkeleton,
} from "./shared/status.js";
```

Replace the `<Loading message={message} />` line in `ShoppingAppInner` with:

```tsx
if (!data) {
  switch (toolName) {
    case "search_products":
      return (
        <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in">
          <div className="mb-4 h-5 w-32 bg-gray-100 animate-pulse rounded" />
          <div className="flex gap-2 overflow-hidden pb-1">
            {[0, 1, 2].map((i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    case "get_weekly_deals":
      return (
        <div className="px-3.5 py-3 max-w-4xl mx-auto animate-view-in">
          <div className="mb-4 h-5 w-32 bg-gray-100 animate-pulse rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <DealCardSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    case "manage_shopping_list":
    case "checkout_shopping_list":
      return (
        <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
          <div className="mb-4 h-5 w-32 bg-gray-100 animate-pulse rounded" />
          <div className="divide-y divide-[var(--app-border)]">
            {[0, 1, 2, 3, 4].map((i) => (
              <ItemRowSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    case "manage_pantry":
      return (
        <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
          <div className="mb-4 h-5 w-32 bg-gray-100 animate-pulse rounded" />
          <div className="divide-y divide-[var(--app-border)]">
            {[0, 1, 2, 3].map((i) => (
              <ItemRowSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    default: {
      const message = partialArgs ? getPartialLoadingMessage(toolName, partialArgs) : undefined;
      return <Loading message={message} />;
    }
  }
}
```

- [ ] **Step 3: Build to verify**

```bash
pnpm build:views
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add views/shared/status.tsx views/App.tsx
git commit -m "feat: add skeleton loaders for product search, weekly deals, shopping list, and pantry"
```

---

### Task 6: View polish — shopping list, pantry, recipe button

**Files:**

- Modify: `views/app/views/ShoppingList.tsx`
- Modify: `views/app/views/Pantry.tsx`
- Modify: `views/app/views/RecipeResults.tsx`

**Interfaces:**

- Consumes: `Separator` from `@/shared/ui/separator.js`

- [ ] **Step 1: Shopping list — remove per-row UPC badges, add summary subtitle**

In `views/app/views/ShoppingList.tsx`, in `ShoppingItem`, remove the `<div className="flex items-center gap-1.5 …">` block that contains `<Badge variant="green">UPC</Badge>` / `<Badge variant="yellow">No UPC</Badge>`. Keep the `×{item.quantity}` and `{item.notes}` display.

New `ShoppingItem` content row (the `<div className="flex-1 min-w-0">` block):

```tsx
<div className="flex-1 min-w-0">
  <div
    className={`text-[13px] font-medium leading-snug truncate ${item.checked ? "line-through text-gray-400" : "text-gray-900"}`}
  >
    {item.productName}
  </div>
  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
    <span className="text-[11px] text-gray-400 font-mono">×{item.quantity}</span>
    {item.notes && (
      <span className="text-[11px] text-gray-400 italic truncate max-w-28">{item.notes}</span>
    )}
  </div>
</div>
```

In `ShoppingListView`, update the `SectionHeader` to show a summary subtitle instead of the badge row:

Replace `subtitle={actionDetail}` with:

```tsx
subtitle={
  actionDetail ||
  (unchecked.length > 0
    ? `${unchecked.length} item${unchecked.length !== 1 ? "s" : ""} · ${withUpc.length} ready for checkout${withoutUpc.length > 0 ? ` · ${withoutUpc.length} need UPC` : ""}`
    : undefined)
}
```

Remove the `{/* Status chips */}` section (the `<div className="flex gap-1.5 mb-3 flex-wrap">` containing the 3 `<Badge>` chips).

- [ ] **Step 2: Pantry — pin expiring section at top**

In `views/app/views/Pantry.tsx`, add import:

```tsx
import { Separator } from "../../shared/ui/separator.js";
```

In `PantryView`, replace the amber banner and the single `items.map(...)` list with a two-section layout:

```tsx
{
  /* Expiring soon section */
}
{
  expiring.length > 0 && (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5 text-amber-500 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
        <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
          Expiring Soon · {expiring.length}
        </span>
      </div>
      <div className="divide-y divide-[var(--app-border)]">
        {expiring.map((item) => (
          <PantryItemRow
            key={item.productName}
            item={item}
            canCallTools={canCallTools}
            onRemove={handleRemove}
          />
        ))}
      </div>
      <Separator className="mt-4 mb-4" />
    </div>
  );
}

{
  /* Main pantry list */
}
<div className="divide-y divide-[var(--app-border)]">
  {items
    .filter((i) => {
      if (!i.expiresAt) return true;
      const d = Math.floor((new Date(i.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
      return d > 3;
    })
    .map((item) => (
      <PantryItemRow
        key={item.productName}
        item={item}
        canCallTools={canCallTools}
        onRemove={handleRemove}
      />
    ))}
</div>;
```

Remove the old amber banner (`<div className="mb-3 bg-amber-50 …">`).

- [ ] **Step 3: Recipe "Shop Ingredients" button — use ActionButton secondary style**

In `views/app/views/RecipeResults.tsx`, in `RecipeCard`, the `RecipeCard` component receives `onShopIngredients` as a prop. Change the footer "Shop Ingredients" button from its current `rounded-full border border-[var(--app-accent-text)]` pill to an `ActionButton`:

Add import to `RecipeResults.tsx`:

```tsx
import { ActionButton, Badge, DisplayModeToggle, SectionHeader } from "../../shared/components.js";
```

(`ActionButton` is now imported; `Badge` was already imported.)

Change `RecipeCard`'s props to add a state prop:

```tsx
function RecipeCard({
  recipe,
  app,
  onShopIngredients,
}: {
  recipe: RecipeData;
  app: App | null;
  onShopIngredients: (recipe: RecipeData) => void;
});
```

Replace the "Shop Ingredients" `<button>` in the footer with:

```tsx
{
  recipe.ingredients && recipe.ingredients.length > 0 && (
    <ActionButton
      state="idle"
      onClick={() => onShopIngredients(recipe)}
      idleLabel="Shop Ingredients"
      variant="secondary"
      icon={
        <svg
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
          />
        </svg>
      }
    />
  );
}
```

- [ ] **Step 4: Build to verify**

```bash
pnpm build:views
```

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add views/app/views/ShoppingList.tsx views/app/views/Pantry.tsx views/app/views/RecipeResults.tsx
git commit -m "feat: polish shopping list badges, pin pantry expiry section, fix recipe button consistency"
```

---

### Task 7: Order history view

**Files:**

- Modify: `src/tools/output-schemas.ts`
- Modify: `src/tools/orders.ts`
- Modify: `views/shared/types.ts`
- Modify: `views/App.tsx`
- Create: `views/app/views/OrderHistory.tsx`
- Modify: `tests/tools/orders.test.ts`

**Interfaces:**

- Produces: `markOrderPlacedOutputSchema` (Zod schema), `OrderHistoryContent` type, `OrderHistoryView` React component.
- Consumes: `Card`, `CardContent`, `CardFooter` from `@/shared/ui/card.js`; `Separator` from `@/shared/ui/separator.js`.

- [ ] **Step 1: Write failing test for structuredContent on mark_order_placed**

In `tests/tools/orders.test.ts`, add a test that verifies `mark_order_placed` returns `structuredContent`. Find the existing test file and add:

```ts
it("returns structuredContent with _view mark_order_placed", async () => {
  // Use the existing test pattern in this file to call the tool handler
  // and assert on the result shape.
  // Look at the existing test setup to find how ctx / tool invocation works.
  const result = await callMarkOrderPlaced(ctx, {
    items: [{ productId: "0001111041700", productName: "Whole Milk", quantity: 2, price: 3.99 }],
    locationId: "12345678",
    notes: "test order",
  });
  expect(result.structuredContent).toBeDefined();
  expect((result.structuredContent as { _view: string })._view).toBe("mark_order_placed");
  expect((result.structuredContent as { order: { totalItems: number } }).order.totalItems).toBe(2);
});
```

(Adapt the test to use the actual helper pattern in the existing test file.)

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run tests/tools/orders.test.ts
```

Expected: FAIL — no `structuredContent` on the result.

- [ ] **Step 3: Add markOrderPlacedOutputSchema to output-schemas.ts**

In `src/tools/output-schemas.ts`, add at the bottom:

```ts
export const markOrderPlacedOutputSchema = z.object({
  _view: z.literal("mark_order_placed"),
  order: z.object({
    orderId: z.string(),
    items: z.array(
      z.object({
        productId: z.string(),
        productName: z.string(),
        quantity: z.number(),
        price: z.number().optional(),
      }),
    ),
    totalItems: z.number(),
    estimatedTotal: z.number().optional(),
    placedAt: z.string(),
    locationId: z.string().optional(),
    notes: z.string().optional(),
  }),
});
```

- [ ] **Step 4: Update orders.ts to return structuredContent**

In `src/tools/orders.ts`, add import at top:

```ts
import { markOrderPlacedOutputSchema } from "./output-schemas.js";
```

In `registerOrderTools`, add `outputSchema: markOrderPlacedOutputSchema` to the tool registration options alongside the existing fields, and update the `result` mapping to return `structuredContent`:

Replace:

```ts
const result = await safeStorage(
  () => ctx.storage.orderHistory.add(props.id, order),
  "record order",
).map(() => `Order recorded successfully:\n\n${formatOrderHistoryCompact([order])}`);

return toMcpResponse(result);
```

With:

```ts
const result = await safeStorage(
  () => ctx.storage.orderHistory.add(props.id, order),
  "record order",
).map(() => ({
  content: [
    {
      type: "text" as const,
      text: `Order recorded successfully:\n\n${formatOrderHistoryCompact([order])}`,
    },
  ],
  structuredContent: {
    _view: "mark_order_placed" as const,
    order,
  },
}));

if (result.isErr()) return toMcpError(result.error);
return result.value;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm exec vitest run tests/tools/orders.test.ts
```

Expected: PASS.

- [ ] **Step 6: Update views/shared/types.ts — add OrderHistoryContent**

Add import:

```ts
import type { markOrderPlacedOutputSchema } from "../../src/tools/output-schemas.js";
```

Add type:

```ts
export type OrderHistoryContent = z.infer<typeof markOrderPlacedOutputSchema>;
```

In `VIEW_NAMES`:

```ts
const VIEW_NAMES: Record<AppData["_view"], true> = {
  search_products: true,
  get_product_details: true,
  search_locations: true,
  get_location_details: true,
  manage_shopping_list: true,
  manage_pantry: true,
  search_recipes_from_web: true,
  get_weekly_deals: true,
  mark_order_placed: true,
};
```

In `AppData` union:

```ts
export type AppData =
  | ProductSearchResultsContent
  | ProductDetailContent
  | LocationResultsContent
  | LocationDetailContent
  | ShoppingListContent
  | PantryListContent
  | RecipeResultsContent
  | WeeklyDealsContent
  | OrderHistoryContent;
```

- [ ] **Step 7: Create OrderHistory view**

Create `views/app/views/OrderHistory.tsx`:

```tsx
import { Card, CardContent, CardFooter } from "../../shared/ui/card.js";
import { Separator } from "../../shared/ui/separator.js";
import type { OrderHistoryContent } from "../../shared/types.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderHistoryView({ data }: { data: OrderHistoryContent }) {
  const { order } = data;

  return (
    <div className="px-3.5 py-3 max-w-2xl mx-auto animate-view-in">
      <div className="mb-4">
        <h1 className="text-sm font-semibold text-gray-900 tracking-tight">Order Recorded</h1>
        <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(order.placedAt)}</p>
      </div>

      <Card>
        <CardContent>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Items · {order.totalItems}
          </p>
          <div className="space-y-2">
            {order.items.map((item, idx) => (
              <div
                key={`${item.productId}-${idx}`}
                className="flex items-baseline justify-between gap-2"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] text-gray-900 font-medium truncate block">
                    {item.productName}
                  </span>
                </div>
                <div className="shrink-0 flex items-baseline gap-2">
                  <span className="text-[11px] text-gray-400 font-mono">×{item.quantity}</span>
                  {item.price != null && (
                    <span className="text-[13px] text-emerald-600 font-mono font-medium">
                      ${(item.price * item.quantity).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>

        {(order.estimatedTotal != null || order.locationId || order.notes) && (
          <CardFooter className="flex flex-col gap-1.5 items-start">
            {order.estimatedTotal != null && (
              <div className="flex items-center justify-between w-full">
                <span className="text-[11px] text-gray-500">Estimated Total</span>
                <span className="text-sm font-semibold text-emerald-600 font-mono">
                  ${order.estimatedTotal.toFixed(2)}
                </span>
              </div>
            )}
            {order.locationId && (
              <p className="text-[11px] text-gray-400">Store: {order.locationId}</p>
            )}
            {order.notes && (
              <>
                <Separator className="my-1" />
                <p className="text-[11px] text-gray-500 italic">{order.notes}</p>
              </>
            )}
          </CardFooter>
        )}
      </Card>

      <p className="text-[10px] text-gray-300 font-mono mt-3">{order.orderId}</p>
    </div>
  );
}
```

- [ ] **Step 8: Wire OrderHistory into App.tsx**

In `views/App.tsx`, add import:

```tsx
import { OrderHistoryView } from "./app/views/OrderHistory.js";
```

Add case to the switch in `ShoppingAppInner`:

```tsx
case "mark_order_placed":
  return <OrderHistoryView data={data} />;
```

- [ ] **Step 9: Run full test suite and build**

```bash
pnpm test && pnpm build:views
```

Expected: all tests pass, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/tools/output-schemas.ts src/tools/orders.ts views/shared/types.ts views/App.tsx views/app/views/OrderHistory.tsx tests/tools/orders.test.ts
git commit -m "feat: add order history view for mark_order_placed"
```

---

### Task 8: Tool description fixes

**Files:**

- Modify: `src/tools/weekly-deals.ts`
- Modify: `src/tools/recipes.ts`
- Modify: `src/tools/location.ts`

**Interfaces:** None (text-only changes).

- [ ] **Step 1: Fix get_weekly_deals description**

In `src/tools/weekly-deals.ts`, replace:

```ts
description:
  "Fetches current QFC/Kroger weekly deals from the print ad (DACS), then augments each deal with real pricing from the Kroger Product Search API. Falls back to search-API-only deal discovery if print-ad parsing fails.",
```

With:

```ts
description:
  "Fetches this week's sale items at your QFC/Kroger store with current pricing. Returns deal titles, savings amounts, and prices.",
```

- [ ] **Step 2: Fix search_recipes_from_web description**

In `src/tools/recipes.ts`, replace:

```ts
description:
  "Searches for recipes from Janella's Cookbook API. Returns detailed recipe information including ingredients, instructions, and metadata.",
```

With:

```ts
description:
  "Searches for recipes by keyword. Returns matching recipes with ingredients, step-by-step instructions, cook time, and difficulty.",
```

- [ ] **Step 3: Fix plan_meals description**

In `src/tools/recipes.ts`, replace:

```ts
description:
  "AI-powered meal suggestions based on pantry inventory, kitchen equipment, and shopping history. Prioritizes ingredients expiring soon to reduce food waste.",
```

With:

```ts
description:
  "Suggests meals based on your current pantry, kitchen equipment, and order history. Prioritizes ingredients expiring soon to reduce food waste.",
```

- [ ] **Step 4: Fix search_locations description**

In `src/tools/location.ts`, replace:

```ts
description: "Searches for Kroger/QFC store locations by zip code and chain name.",
```

With:

```ts
description:
  "Searches for nearby Kroger or QFC stores by zip code and chain. Returns locations you can set as your preferred store for product searches and cart operations.",
```

- [ ] **Step 5: Run tests and build**

```bash
pnpm test && pnpm build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/weekly-deals.ts src/tools/recipes.ts src/tools/location.ts
git commit -m "fix: improve tool descriptions for get_weekly_deals, search_recipes_from_web, plan_meals, search_locations"
```

---

## Self-Review

**Spec coverage:**

- ✅ Section 1 (shadcn CLI setup): Tasks 1–2
- ✅ Section 2 (Instacart visual): Tasks 3–6
- ✅ Section 3 (Order history): Task 7
- ✅ Section 4 (Tool descriptions): Task 8

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:**

- `ProductData` with `images` flows from `productSchema` (Task 3) into `ProductCard` (Task 4) ✓
- `markOrderPlacedOutputSchema` defined in Task 7 Step 3, imported in Types Step 6, used in App Step 8 ✓
- `OrderHistoryContent` matches `markOrderPlacedOutputSchema` inference ✓
- `VIEW_NAMES` compile-error guard will catch any `AppData` union member without a matching key ✓
- `ProductCardSkeleton` / `DealCardSkeleton` / `ItemRowSkeleton` defined in Task 5 Step 1, used in Task 5 Step 2 ✓
