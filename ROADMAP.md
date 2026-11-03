# Product priorities

A Kroger/QFC shopper should be able to turn dinner decisions into a reviewed basket without repeated searching. These are proposed priorities, not delivery commitments or measured demand.

[Saved meal plans](docs/meal-plans.md) implement the first slice: resume meals and servings, confirm pantry allocations, review products/packages and prepare one list. Release requires the additive D1 migration, Worker/app deployment and live validation.

## Pilot

Pilot five voluntary shopping sessions. Record baseline and new time from meal request to reviewed list, unresolved ingredients, manual corrections and return use the following week. Target four of five completions without developer assistance; track uncertain cart outcomes separately from success. Fixture tests do not measure adoption, time savings or revenue.

Use minimal aggregate events and voluntary feedback; do not collect recipe content or credentials as telemetry. If shoppers do not return, revisit the problem before expanding.

## After the pilot

| Priority                 | Shopper outcome                                         | Acceptance                                                                                                            |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Budget and substitutions | Compare an estimated basket with explainable swaps.     | Shopper approves individual substitutions; missing prices are explicit and estimates never appear as checkout totals. |
| Weekly templates         | Reuse last week's list with quantity and pantry review. | Preserve exclusions, refresh availability and present one change summary.                                             |
| Household coordination   | Explicitly invited members share one list.              | Concurrent edits work and removed members lose read/write access.                                                     |

Keep checkout user-controlled. Expand beyond Kroger/QFC only after repeat use is demonstrated. Pantry Pulse owns physical inventory and Janella Cookbook owns saved recipes; use explicit import/export contracts rather than duplicating those products.
