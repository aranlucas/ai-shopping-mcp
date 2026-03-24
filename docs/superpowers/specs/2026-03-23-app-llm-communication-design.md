# App ↔ LLM Communication Design

**Date:** 2026-03-23
**Status:** Approved

## Overview

Add bidirectional communication from `RecipeShoppingView` to the LLM host using two MCP Apps SDK methods:

- `app.sendMessage()` — visible user message that triggers an LLM response
- `app.updateModelContext()` — silent structured context update for future LLM turns

## Triggers and Methods

| Event                           | Method               | When                                                     |
| ------------------------------- | -------------------- | -------------------------------------------------------- |
| Shopping view opens             | `updateModelContext` | `useEffect` on mount                                     |
| Individual item added to cart   | `updateModelContext` | After `onAddToCart` resolves successfully                |
| Pantry staples checkbox toggled | `updateModelContext` | In `onChange` handler with new value                     |
| "Add All to Cart" succeeds      | `sendMessage`        | After `callTool` for `add_to_cart` returns without error |

## Payload Shapes

### `updateModelContext` — Shopping view opened

```json
{
  "event": "recipe_shopping_started",
  "recipe": "Sheet Pan Apple, Chicken and Sweet Potato",
  "ingredientCount": 9,
  "stapleCount": 2,
  "estimatedTotal": 62.99
}
```

`estimatedTotal` is the computed `total` from the existing price calculation (omitted if `!anyPriced`).

### `updateModelContext` — Individual item added to cart

```json
{
  "event": "ingredient_added_to_cart",
  "recipe": "Sheet Pan Apple, Chicken and Sweet Potato",
  "ingredient": "1 lb boneless skinless chicken breasts",
  "product": "Simple Truth Natural Chicken Breasts"
}
```

`ingredient` is the full formatted label (quantity+unit+name); `product` is `product.description`.

### `updateModelContext` — Pantry staples toggled

```json
{
  "event": "pantry_staples_toggled",
  "recipe": "Sheet Pan Apple, Chicken and Sweet Potato",
  "includeStaples": false
}
```

### `sendMessage` — Add All to Cart succeeded

Role: `"user"`. Content: one `{ type: "text", text: "..." }` block.

Message format:

> "I just added [N] ingredients for [Recipe Title] to my Kroger cart: [Product 1], [Product 2], and [N more / final product]."

`N` = count of items actually added (those with UPCs, respecting `includeStaples` state). Product names listed are `product.description` for each added item. If all fit on one line (≤3 products), list them all by name. If more than 3, list the first 3 then "and N more."

## Implementation

### Location

All changes are in `views/app/views/RecipeShoppingView.tsx`. `app` is already a prop — no new wiring needed.

### SDK Call Signatures

```ts
// updateModelContext
app?.updateModelContext({
  structuredContent: { event: "...", ... },
});

// sendMessage
app?.sendMessage({
  role: "user",
  content: [{ type: "text", text: "..." }],
});
```

Both return promises. Fire-and-forget (no `await`, no error handling) — these are best-effort telemetry/notifications. A failure to notify the LLM should never block the UI action or surface an error to the user.

### Mount Effect

```ts
useEffect(() => {
  app?.updateModelContext({
    structuredContent: {
      event: "recipe_shopping_started",
      recipe: recipe.title,
      ingredientCount: ingredients.length,
      stapleCount,
      ...(anyPriced ? { estimatedTotal: parseFloat(total.toFixed(2)) } : {}),
    },
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // run once on mount
```

`stapleCount`, `anyPriced`, and `total` are derived synchronously from `results` (a prop, not async state), so they are available at mount time.

### Individual Add to Cart

In `RecipeShoppingView`, `handleAddToCart` and `handleAddToList` are passed to `IngredientCard` as callbacks but are defined in the parent. The `updateModelContext` call for individual cart adds must be made in `handleAddToCart` in `RecipeShoppingView`. However, `handleAddToCart` currently only receives `upc` and `qty` — it doesn't know the ingredient label or product name.

**Solution:** Augment the `IngredientCard` props with an `onAdded` callback. After `onAddToCart` resolves, `IngredientCard` calls `onAdded({ ingredient: label, product: name })`. `RecipeShoppingView` defines `onAdded` and fires `updateModelContext` there.

```ts
// In IngredientCard (after successful add to cart):
onAdded?.({ ingredient: label, product: name });

// In RecipeShoppingView:
const handleIngredientAdded = ({
  ingredient,
  product,
}: {
  ingredient: string;
  product: string;
}) => {
  app?.updateModelContext({
    structuredContent: {
      event: "ingredient_added_to_cart",
      recipe: recipe.title,
      ingredient,
      product,
    },
  });
};
```

### Staples Toggle

```ts
onChange={(e) => {
  const next = e.target.checked;
  setIncludeStaples(next);
  app?.updateModelContext({
    structuredContent: {
      event: "pantry_staples_toggled",
      recipe: recipe.title,
      includeStaples: next,
    },
  });
}}
```

### Add All to Cart

After the successful `callTool` call in `handleAddAll`, build the message and send:

```ts
const addedNames = items
  .map(
    (item) =>
      classified.find((e) => e.result.products[0]?.upc === item.upc)?.result.products[0]
        ?.description,
  )
  .filter(Boolean);

const nameList =
  addedNames.length <= 3
    ? addedNames.join(", ")
    : `${addedNames.slice(0, 3).join(", ")}, and ${addedNames.length - 3} more`;

app?.sendMessage({
  role: "user",
  content: [
    {
      type: "text",
      text: `I just added ${addedNames.length} ingredients for ${recipe.title} to my Kroger cart: ${nameList}.`,
    },
  ],
});
```

## Files Changed

| File                                     | Change                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `views/app/views/RecipeShoppingView.tsx` | Add mount effect, augment `IngredientCard` with `onAdded`, add `updateModelContext` calls, add `sendMessage` after Add All |

## Out of Scope

- `onAddToList` (Save) does not trigger a context update — only cart additions
- Error states for `sendMessage`/`updateModelContext` are not surfaced to the user
- No changes to `RecipeResults.tsx` or `App.tsx`
