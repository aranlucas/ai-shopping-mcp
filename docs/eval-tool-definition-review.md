# Eval-driven tool definition review

Reviewed the two most recent completed Agent Eval runs on 2026-09-30
(Pacific time). Workflow success alone is not the task pass rate: the eval
step uses `continue-on-error`.

| Run                                                                                  | Model             | Train | Held-out | Average calls | Tool errors |
| ------------------------------------------------------------------------------------ | ----------------- | ----- | -------- | ------------- | ----------- |
| [36796412935](https://github.com/aranlucas/ai-shopping-mcp/actions/runs/36796412935) | Qwen 3.8 27B      | 10/10 | 5/5      | 2.0           | 0           |
| 36796412935                                                                          | Space Bunny Alpha | 10/10 | 5/5      | 2.8           | 0           |
| [36796833143](https://github.com/aranlucas/ai-shopping-mcp/actions/runs/36796833143) | Qwen 3.8 27B      | 9/10  | 4/5      | 2.0           | 0           |
| 36796833143                                                                          | Space Bunny Alpha | 10/10 | 5/5      | 2.7           | 0           |

These are historical baselines, not measurements of the changes below.

## Evidence and changes

- Both models repeatedly expected `view_cart` to discover a live cart ID or
  provide prices and totals. Its default result is assistant add history.
  The description, `cartId` parameter, and fallback response now explain
  those limits and direct budget estimates to product prices and quantities.
- Shopping tools needed a clearer choice rule. `shop_for_items` creates a
  new list with automatic matches; `search_products` is the comparison path;
  `get_shopping_list` followed by `update_shopping_list` edits an existing
  list. Descriptions and server instructions now state this distinction.
- Train-task purchase feedback called “3 items” confusing when two lines
  contained three packages. `record_order` now echoes product names and
  quantities, labels line and package counts, returns `orderId` and
  `storeId`, and identifies how many lines contribute to a price estimate.
  Its definition also explains that names alone suffice and a store name
  with an unknown ID can go in notes.
- Product search results are candidates, so the definition now tells the
  agent to check pickup and stock status and avoids implying catalog-wide
  cheapest selection or exact matching.

## Interpreting failures and feedback

The latest `missing-item` failure is a grading false negative. Qwen added
bread and said “No Kroger results came back” for the missing item, but the
checker only accepts contiguous “no results” or other narrow phrases.
Do not tune descriptions to force the checker’s exact wording. The checker
is unchanged in this tool-definition revision.

The latest held-out `no-store-yet` task also failed its clarification check.
It remains validation evidence; no descriptions were tuned to its answer.

Other feedback describes fixture limits: identical milk results for
several queries, sparse product choices, Monday/Tuesday-only store hours,
and a weekly-deals circular fetch warning. Those observations do not prove
production tool failures and do not justify inventing extra capabilities.

## Validation

Run `pnpm build:views`, `pnpm eval:mcp`, the cart and order tool tests,
`pnpm lint`, and `pnpm typecheck`. Token caps remain unchanged. A new model
comparison requires `OPENROUTER_API_KEY`; this worktree had neither an
exported key nor `.dev.vars` at review time.
