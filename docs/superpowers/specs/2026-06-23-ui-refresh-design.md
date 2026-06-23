# UI Refresh + shadcn + Instacart Visual Language

**Date:** 2026-06-23  
**Scope:** Approach B — UI polish, new capabilities, shadcn primitives, Instacart-inspired visual language

---

## Goals

1. Introduce shadcn component primitives (manually, not via CLI) for Skeleton, Badge, Card, ScrollArea, Separator.
2. Adopt an Instacart-inspired visual language: image-first product cards, shadow-depth, quantity steppers.
3. Add an order history view for `mark_order_placed`.
4. Polish four existing views: shopping list badges, pantry expiry section, recipe button consistency, loading states.
5. Fix four tool descriptions that leak implementation details or are misleading.

---

## Section 1 — shadcn Setup

### Approach

Manual copy (not CLI) because:

- Tailwind v4 via `@tailwindcss/vite` with no `tailwind.config.ts` — the CLI assumes a config file.
- `vite-plugin-singlefile` bundles everything into one HTML file; the CLI's path assumptions break.
- The existing `--app-*` / `--color-*` CSS variable system must be preserved.

### New dependencies

- `clsx` — conditional classname utility
- `tailwind-merge` — merge Tailwind classes without conflicts
- `@radix-ui/react-scroll-area` — used by shadcn ScrollArea

### New files

- `views/shared/ui/utils.ts` — exports `cn()`
- `views/shared/ui/skeleton.tsx` — shimmer placeholder
- `views/shared/ui/badge.tsx` — replaces custom `Badge` in `components.tsx`
- `views/shared/ui/card.tsx` — `Card`, `CardHeader`, `CardContent`, `CardFooter`
- `views/shared/ui/scroll-area.tsx` — wraps Radix ScrollArea
- `views/shared/ui/separator.tsx` — wraps Radix (or pure CSS) Separator

### CSS variable mapping in `styles.css`

Add a `@theme inline` block mapping shadcn's expected tokens to the existing system:

```css
@theme inline {
  --radius: var(--radius-card);
  --background: var(--color-background-primary);
  --foreground: var(--color-text-primary);
  --border: var(--app-border);
  --muted: var(--color-background-tertiary);
  --muted-foreground: var(--color-text-tertiary);
}
```

### What stays custom

- `ActionButton` — has a 4-state machine (idle/loading/done/error); too domain-specific for shadcn Button.
- `ProductCard`, `ProductActions` — complex state logic; use shadcn `Card` as the structural wrapper only.
- `SectionHeader`, `FulfillmentTags`, `PriceDisplay` — remain in `components.tsx` unchanged.

---

## Section 2 — Instacart Visual Language

### Product cards (`ProductCard` in `components.tsx`)

**Image area:**

- Source: `product.images?.[0]?.sizes?.find(s => s.id === "medium")?.url ?? product.images?.[0]?.sizes?.[0]?.url`
- Rendered as a square `<img>` (aspect-ratio: 1) at the top of the card, covering full width, with `object-fit: contain` on a light gray background (`bg-gray-50`).
- Falls back to a gray placeholder with a shopping bag icon if no image URL.
- The `productSchema` in `output-schemas.ts` needs `images` added: `z.array(z.looseObject({ perspective: z.string().optional(), sizes: z.array(z.looseObject({ id: z.string().optional(), url: z.string().optional() })).optional() })).optional()`.

**Card styling shift:**

- Remove `border border-[var(--app-border)]` → add `shadow-sm hover:shadow-md` (shadow-depth over border-depth).
- Keep `rounded-lg` and `bg-[var(--app-card-bg)]`.
- Use shadcn `Card` as the wrapper with `CardContent` for the text section.

**Quantity stepper (Instacart signature):**

- First click on "Add to Cart": adds 1, button transforms to `− qty +` stepper in-card.
- State lives in `ProductCard` (per-card, not global). Shape: `{ qty: number; cartState: "idle"|"loading"|"done"|"error" }`.
- `−` button decrements qty; at 0, reverts to the "Add" pill.
- `+` button increments and calls `add_to_cart` with the new qty delta.
- Visual: pill row `[−] [qty] [+]`, green accent background, white text.

**Product cards in `ProductSearchView`:**

- Cards in the carousel are now taller (~180px) to accommodate the image.
- Carousel scroll snap and horizontal overflow unchanged; shadcn `ScrollArea` wraps the scroll container for better cross-platform scrollbar behavior.

### Skeleton loaders

Replace the generic `<Loading message="…">` spinner in view-level loading states with shaped skeletons using shadcn `Skeleton`.

Affected:

- `ProductSearchView`: show 3 shimmer `ProductCard`-shaped skeletons while `!hasResults && partialArgs`.
- `WeeklyDealsView`: 4 deal card skeletons.
- `ShoppingListView`: 5 item-row skeletons.
- `PantryView`: 4 item-row skeletons.

The generic `<Loading>` spinner in `status.tsx` stays for the app-level connection wait and for views without a known shape (LocationResults, RecipeResults).

### Shopping list (`ShoppingListView`)

**Badge simplification:**

- Remove per-row `<Badge variant="green">UPC</Badge>` / `<Badge variant="yellow">No UPC</Badge>`.
- Add a single summary line in `SectionHeader`'s `subtitle`: `"12 items · 8 ready for checkout · 4 need UPC"`.
- The existing quick-action buttons ("Check out N items", "Find missing UPCs") stay.

### Pantry (`PantryView`)

**Expiring section pinned at top:**

- If any items are expiring in ≤3 days, render them in their own titled section above the main list.
- Section label: `"Expiring Soon · {count}"` in amber, with a shadcn `Separator` below it.
- Items in this section show `ExpiryBadge` as before; items NOT expiring hide their expiry display (they still have it, just less prominent).
- The amber banner (`bg-amber-50 border border-amber-100`) is removed (the pinned section replaces it).

### Recipe footer button (`RecipeCard` in `RecipeResults.tsx`)

- Change "Shop Ingredients" from `rounded-full border border-[var(--app-accent-text)]` pill to a standard `ActionButton` with `variant="secondary"` — consistent with all other secondary actions.

---

## Section 3 — Order History View

### Server changes

**`src/tools/output-schemas.ts`:**

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

**`src/tools/orders.ts`:**

- Add `outputSchema: markOrderPlacedOutputSchema` to the tool registration.
- Return `structuredContent: { _view: "mark_order_placed", order }` alongside the existing text content.

**`src/tools/types.ts` / `views/shared/types.ts`:**

- Add `markOrderPlacedOutputSchema` to `VIEW_NAMES`, `AppData` union, and the `case` in `App.tsx`.

### Client changes

**`views/app/views/OrderHistory.tsx`** — new file:

- Header: order ID (truncated), formatted timestamp (`placedAt`), optional store name from `locationId`.
- Item list: each row shows productName, qty (`×N`), price if available.
- Footer: estimated total badge (if present), optional `notes`.
- shadcn `Card` wrapper, shadcn `Separator` between items and footer.
- No interactive actions on this view (it's a receipt).

---

## Section 4 — Tool Description Fixes

| Tool                      | Current                                                                                                                                                                                                                   | Updated                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_weekly_deals`        | "Fetches current QFC/Kroger weekly deals from the print ad (DACS), then augments each deal with real pricing from the Kroger Product Search API. Falls back to search-API-only deal discovery if print-ad parsing fails." | "Fetches this week's sale items at your QFC/Kroger store with current pricing. Returns deal titles, savings amounts, and prices."                                 |
| `search_recipes_from_web` | "Searches for recipes from Janella's Cookbook API. Returns detailed recipe information including ingredients, instructions, and metadata."                                                                                | "Searches for recipes by keyword. Returns matching recipes with ingredients, step-by-step instructions, cook time, and difficulty."                               |
| `search_locations`        | "Searches for Kroger/QFC store locations by zip code and chain name."                                                                                                                                                     | "Searches for nearby Kroger or QFC stores by zip code and chain. Returns locations you can set as your preferred store for product searches and cart operations." |
| `plan_meals`              | "AI-powered meal suggestions based on pantry inventory, kitchen equipment, and shopping history. Prioritizes ingredients expiring soon to reduce food waste."                                                             | "Suggests meals based on your current pantry, kitchen equipment, and order history. Prioritizes ingredients expiring soon to reduce food waste."                  |

---

## Architecture Notes

- **`views/shared/ui/`** is the new home for shadcn-sourced components. `views/shared/components.tsx` keeps domain-specific shared components.
- **`productSchema` in `output-schemas.ts`** gains an `images` field — the schema is already `z.looseObject` so this is additive and won't break existing tests.
- **`AppData` union** gains `markOrderPlacedOutputSchema`; `VIEW_NAMES` must be updated in lockstep (compile-error guard is already in place).
- The `OrderRecord` server type and the new output schema are structurally the same — use `OrderRecord` fields directly in the schema rather than duplicating.
- All new view components follow the existing `animate-view-in` entrance animation.

---

## Testing

- Add/update tests in `tests/tools/orders.test.ts` for the new `structuredContent` output.
- `tests/tools/resources.test.ts` or a new `tests/tools/output-schemas.test.ts` for the updated `productSchema` images field.
- Existing shopping list / pantry tests are unaffected (server-side schema is unchanged).
- Run `pnpm build:views` to confirm the view bundle compiles after every client-side change.
- Run `pnpm test` before handback.

---

## Out of Scope

- Estimated cart total (requires storing price on `ShoppingListItem` — data model change deferred).
- Deal match indicators on shopping list (requires cross-referencing deal data at view time — deferred).
- Dark mode image handling (Kroger images are already on white backgrounds; no special treatment needed).
