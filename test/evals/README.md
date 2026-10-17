# Deterministic MCP Regression Tests

Regression tests for keeping this server usable by small-context models
(Haiku-class). It drives the **real Worker end-to-end** — OAuth through
`SELF`, a real MCP client over `StreamableHTTPClientTransport` — with the
Kroger API served from deterministic fixtures (`harness.ts`), so every suite
measures the actual wire payloads a host model sees.

## Running

```bash
pnpm eval:mcp                 # all deterministic suites (also run by pnpm test)
EVAL_LOG=1 pnpm eval:mcp      # print measured token tables for recalibration
```

These deterministic suites run in CI as part of `pnpm test`. Live agent and
selector runners, their report tools, and the Agent Eval workflow have been retired.
Historical findings and JSON reports remain under `docs/`.

## What each suite measures

| Suite                              | Question it answers                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp-agent-contract.test.ts`       | Is the tool surface the designed workflow-first set, with correct annotations and view metadata?                                                                                                                                                                             |
| `token-budget.eval.test.ts`        | How many tokens do the tool list, instructions, and representative responses cost — and did they regress? Budgets are calibrated against `estimateTokens()` (~4 chars/token) at ~1.3–2× measured baselines; recalibrate deliberately with `EVAL_LOG=1`, never bump-to-green. |
| `golden-path.eval.test.ts`         | Can a "scripted small model" that only reads `content[0].text` and extracts ids with trivial regexes (`storeId=…`, `upc=…`, `listId=…`) finish the golden paths within the documented call budget? Also covers idempotent cart retry and partial no-result searches.         |
| `input-forgiveness.eval.test.ts`   | Are typical small-model input mistakes (unpadded UPCs, string numbers, lowercase enums, stray whitespace, extra keys) normalized instead of rejected — and when rejection is right, does the error name the fix?                                                             |
| `error-actionability.eval.test.ts` | Does every error name the concrete recovery tool, and does following that advice actually work?                                                                                                                                                                              |

## The small-model contract

These suites pin down the implicit contract the server offers to weak models:

1. Every id a later tool needs is printed in `content[0].text` as
   `key=value` (`storeId=70500847`, `upc=0001111041700`,
   `listId=list_a1b2c3d8`) — extractable with a regex, no JSON parsing.
2. Response text names the next tool to call; error text names the recovery
   tool.
3. Schemas normalize recoverable input instead of rejecting it.
4. The golden path (`search_stores` → `set_preferred_store` →
   `shop_for_items` → choose UPCs → `create_shopping_list` →
   `add_shopping_list_to_cart`) completes in 5 calls. Product discovery is
   read-only and returns up to five options per requested item;
   retrying the saved-list cart add is safe.

If you change a response format and one of these fails, the format change
broke small-model interop — fix the format or renegotiate the contract here
explicitly.

## Known limitations

- `get_weekly_deals` is only covered for its no-store error path; the QFC
  circular endpoints aren't fixture-backed here (unit tests in
  `tests/tools/weekly-deals.test.ts` cover the caching logic).
- `estimateTokens()` is a chars/4 heuristic, not a real tokenizer. Budgets
  are for regression detection, not billing.
- Fixture artifacts look like tool bugs to models: unknown search terms
  synthesize a generic product, and fixture stores only list some hours.
