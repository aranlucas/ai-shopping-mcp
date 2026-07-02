# Small-Model MCP Evals

Evaluation framework for keeping this server usable by small-context models
(Haiku-class). It drives the **real Worker end-to-end** — OAuth through
`SELF`, a real MCP client over `StreamableHTTPClientTransport` — with the
Kroger API served from deterministic fixtures (`harness.ts`), so every suite
measures the actual wire payloads a host model sees.

## Running

```bash
pnpm eval:mcp                 # all deterministic suites (also run by pnpm test)
EVAL_LOG=1 pnpm eval:mcp      # print measured token tables for recalibration
EVAL_LIVE=1 pnpm eval:mcp     # + live small-model runs via the Workers AI binding
EVAL_LIVE=1 EVAL_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast pnpm eval:mcp
```

The deterministic suites run in CI as part of `pnpm test`. The live-model
suite only runs with `EVAL_LIVE=1`: it uses the Worker's own Cloudflare AI
binding (`env.AI`), which miniflare proxies to **remote** Workers AI — it
needs Cloudflare credentials (`wrangler login` or
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`) and can incur usage charges,
which is why it never runs implicitly.

## What each suite measures

| Suite                              | Question it answers                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp-agent-contract.test.ts`       | Is the tool surface the designed workflow-first set, with correct annotations and view metadata?                                                                                                                                                                             |
| `token-budget.eval.test.ts`        | How many tokens do the tool list, instructions, and representative responses cost — and did they regress? Budgets are calibrated against `estimateTokens()` (~4 chars/token) at ~1.3–2× measured baselines; recalibrate deliberately with `EVAL_LOG=1`, never bump-to-green. |
| `golden-path.eval.test.ts`         | Can a "scripted small model" that only reads `content[0].text` and extracts ids with trivial regexes (`storeId=…`, `upc=…`, `listId=…`) finish the golden paths within the documented call budget? Also covers idempotent cart retry and partial no-result searches.         |
| `input-forgiveness.eval.test.ts`   | Are typical small-model input mistakes (unpadded UPCs, string numbers, lowercase enums, stray whitespace, extra keys) normalized instead of rejected — and when rejection is right, does the error name the fix?                                                             |
| `error-actionability.eval.test.ts` | Does every error name the concrete recovery tool, and does following that advice actually work?                                                                                                                                                                              |
| `live-model.eval.test.ts`          | Can a real small model (default `@cf/meta/llama-3.1-8b-instruct` on Workers AI, via the Worker's own `env.AI` binding) complete the `scenarios.ts` shopping tasks against the live tool surface? Reports tool-call count and schema rejections per scenario.                 |

## The small-model contract

These suites pin down the implicit contract the server offers to weak models:

1. Every id a later tool needs is printed in `content[0].text` as
   `key=value` (`storeId=70500847`, `upc=0001111041700`,
   `listId=list_a1b2c3d8`) — extractable with a regex, no JSON parsing.
2. Response text names the next tool to call; error text names the recovery
   tool.
3. Schemas normalize recoverable input instead of rejecting it.
4. The golden path (`search_stores` → `set_preferred_store` →
   `shop_for_items` → `add_shopping_list_to_cart`) completes in 4 calls, and
   retrying the cart add is safe.

If you change a response format and one of these fails, the format change
broke small-model interop — fix the format or renegotiate the contract here
(and in `docs/small-model-efficiency-plan.md`) explicitly.

## Adding a scenario

Add fixture products to `FIXTURE_CATALOG` in `harness.ts` (terms starting
with `zzz` intentionally return no results), then append to `SCENARIOS` in
`scenarios.ts` with the user phrasing that failed in the wild, a tool-call
budget, and the expected cart contents (`anyOf` UPC sets, since any fixture
match for a term is a legitimate model pick).

## Known limitations

- `get_weekly_deals` is only covered for its no-store error path; the QFC
  circular endpoints aren't fixture-backed here (unit tests in
  `tests/tools/weekly-deals.test.ts` cover the caching logic).
- `estimateTokens()` is a chars/4 heuristic, not a real tokenizer. Budgets
  are for regression detection, not billing.
- The live runner's `env.AI` binding is remote-proxied by miniflare (real
  Workers AI inference, real charges); everything else stays fixture-backed.
  Tool-calling reliability varies by Workers AI model — a failure at the
  default 8B model is signal about the tool surface, but confirm against a
  larger model (`EVAL_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast`) before
  treating it as a regression.
