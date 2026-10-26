# Shopping MCP feature roadmap

Updated 2026-10-26. Proposed release order, not delivery dates or evidence of customer demand. Targets below are pilot decision gates, not measured results.

## User and outcome

A Kroger/QFC shopper who wants to turn dinner decisions into a reviewed basket with less repeated searching.

## Current baseline

The current product already provides OAuth, store/product/deal search, pantry and list tools, recipe ingredient matching, reviewed cart additions and an MCP App. The next releases should complete shopping journeys rather than add more disconnected search tools.

Planning evidence: [README](README.md) and [tool composition](src/composition.ts) at `14599929db3a`. This focused product pass does not claim a complete new code audit or live-provider validation.

## Prioritized releases

| Order | Feature                               | User value and scope                                                                                                                                                                    | Release acceptance                                                                                                                                        |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Now   | One reviewed dinner-to-basket journey | Carry servings, pantry deductions, selected store, product choices and unresolved ingredients through one resumable plan. Show what still needs a shopper decision before adding items. | A shopper completes a three-dinner plan, edits one meal, and prepares the basket without rebuilding the other meals or duplicating additions.             |
| Next  | Budget and substitution review        | Show an estimated basket total with missing prices called out, then offer explainable swaps that preserve the shopper’s stated preferences.                                             | A shopper sets a budget, compares the original and proposed basket, and approves individual substitutions; estimates never masquerade as checkout totals. |
| Next  | A repeatable weekly shop              | Turn a completed list into a reusable weekly template with quantity edits, pantry reconciliation and a review of changed availability.                                                  | Reusing last week’s list preserves deliberate exclusions, refreshes product information and presents a single change summary.                             |
| Later | Household coordination                | Allow explicitly invited household members to contribute to one list and see which items another person has already handled.                                                            | Two members can edit/check items concurrently; removing access prevents further reads and writes.                                                         |

## Measure value before expanding

Pilot five real shopping sessions: record time from meal request to reviewed basket, unmatched ingredients, manual corrections and repeat use the following week. Initial target: four of five complete without developer assistance. Track cart ambiguity separately from confirmed success.

Collect the baseline before building the first slice. Use voluntary pilot feedback and minimal aggregate events; do not log private content or credentials to measure adoption. If the first workflow is not used again, revisit the problem before adding the later features. Revenue impact is unvalidated.

## Next shippable slice

The resumable plan summary and unresolved-ingredient queue are implemented for review, using existing list, product and cart capabilities. Saved plans retain meals/servings, explicit pantry allocations, product/package decisions, store and fulfillment choice. Preparing is atomic and retry-safe; cart addition remains a separate approval. Prepared plans are immutable in this first slice.

Release gates: apply the additive D1 migration, deploy the Worker and bundled app, then run the five-session pilot above. Local fixture tests are implementation evidence, not measured adoption or a live Kroger result. [Feature contract and rollout](docs/meal-plans.md).

After the pilot, prioritize budget/substitution review only if shoppers complete and return to this workflow. Weekly templates and household coordination remain later work.

## Dependencies and deliberate limits

Keep checkout user-controlled. Expand beyond Kroger/QFC only after the first workflow demonstrates repeat use. Let Pantry Pulse own physical inventory and Janella Cookbook own saved recipes; connect through explicit import/export contracts rather than duplicate those products.

Engineering work belongs in the milestone only when it enables that acceptance criterion. Prefer existing native libraries and test runners. Update this roadmap when a user-visible increment ships, recording the outcome and remaining limits rather than checking off implementation activity alone.
