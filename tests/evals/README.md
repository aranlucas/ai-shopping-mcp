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
```

The agent eval (`agent.eval.test.ts`) is separate and opt-in:

```bash
pnpm eval:agent                                   # 4 free OpenRouter models × all tasks
EVAL_MODELS=qwen/qwen3.8-27b:free pnpm eval:agent # one model
EVAL_TASKS=budget-basket,no-store-yet pnpm eval:agent
EVAL_CONCURRENCY=1 pnpm eval:agent                # fewer parallel models
pnpm eval:agent:summary                           # Markdown table of eval-results/
pnpm eval:agent:report                            # browse eval-results/ in the UI
```

It needs `OPENROUTER_API_KEY` (exported or in `.dev.vars`). The default
models are free, so a key with a $0 credit limit works. Each model runs in
its own vitest process; `EVAL_CONCURRENCY` (default 2) caps how many run at
once, because OpenRouter's free tier allows about 20 requests a minute and
1000 a day per account. A full run is roughly 300 requests.

The deterministic suites run in CI as part of `pnpm test`. The agent eval
runs in the `Agent Eval` GitHub workflow on demand and on PRs that touch the
tools.

## What each suite measures

| Suite                              | Question it answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp-agent-contract.test.ts`       | Is the tool surface the designed workflow-first set, with correct annotations and view metadata?                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `token-budget.eval.test.ts`        | How many tokens do the tool list, instructions, and representative responses cost — and did they regress? Budgets are calibrated against `estimateTokens()` (~4 chars/token) at ~1.3–2× measured baselines; recalibrate deliberately with `EVAL_LOG=1`, never bump-to-green.                                                                                                                                                                                                                                                  |
| `golden-path.eval.test.ts`         | Can a "scripted small model" that only reads `content[0].text` and extracts ids with trivial regexes (`storeId=…`, `upc=…`, `listId=…`) finish the golden paths within the documented call budget? Also covers idempotent cart retry and partial no-result searches.                                                                                                                                                                                                                                                          |
| `input-forgiveness.eval.test.ts`   | Are typical small-model input mistakes (unpadded UPCs, string numbers, lowercase enums, stray whitespace, extra keys) normalized instead of rejected — and when rejection is right, does the error name the fix?                                                                                                                                                                                                                                                                                                              |
| `error-actionability.eval.test.ts` | Does every error name the concrete recovery tool, and does following that advice actually work?                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `agent.eval.test.ts`               | Following Anthropic's [writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents): can real models finish realistic multi-step tasks (`agent/tasks.ts`) through the MCP server? Built on [vitest-evals](https://github.com/getsentry/vitest-evals): an AI SDK tool loop on an OpenRouter model is the harness, `TaskChecksJudge` grades end state (cart, lists, pantry, recorded orders), and the report keeps tool calls, usage, and each model's TOOL FEEDBACK. `[test]` tasks are held out. |

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
explicitly.

## Adding an agent task

Append to `AGENT_TASKS` in `agent/tasks.ts`: a prompt phrased the way a user
would say it, optional `setup` (seeded through real tool calls), and `checks`
over the end-state snapshot. Check outcomes, not a fixed tool path, so any
valid strategy passes. Mark a task `split: "test"` to hold it out from tool
tuning.

## Known limitations

- `get_weekly_deals` is only covered for its no-store error path; the QFC
  circular endpoints aren't fixture-backed here (unit tests in
  `tests/tools/weekly-deals.test.ts` cover the caching logic).
- `estimateTokens()` is a chars/4 heuristic, not a real tokenizer. Budgets
  are for regression detection, not billing.
- Free OpenRouter models vary run to run, and providers sometimes return
  502s. Read a failing transcript before treating it as a tool regression,
  and check model TOOL FEEDBACK against the transcript: models misreport.
- Fixture artifacts look like tool bugs to models: unknown search terms
  synthesize a generic product, and fixture stores only list some hours.
