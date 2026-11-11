# Deterministic MCP regression tests

These suites drive the real Worker through `SELF` with an MCP HTTP client, signed test JWTs and fixture Kroger responses. They test the wire contract a host sees, without live provider credentials or model calls.

```sh
pnpm build:views
pnpm eval:mcp
EVAL_LOG=1 pnpm eval:mcp  # print token measurements for recalibration
```

`pnpm test` also runs these suites in CI. Live agent/selector runners are retired. Historical evaluation JSON, kept in git history and linked from the selector rationale, contains synthetic inputs, model outputs and provenance; its embedded source paths describe the evaluated revision, not runnable current modules. [Selector rationale](../../docs/jev-value-evaluation.md) explains the limitations. The [Codex comparison](https://github.com/aranlucas/ai-shopping-mcp/blob/5c5547297d3cfa75f410857edc98f1db8047c46b/docs/codex-eval-hill-climb.json) records a grader correction using paired replay, not a model-performance gain.

## Contract

- IDs needed by later tools appear in `content[0].text` as `key=value`, extractable without parsing JSON. Responses name next steps; errors identify recovery.
- App routing metadata stays in `_meta`; concise text is the primary model-facing reasoning payload.
- Recoverable input variations are normalized; invalid input errors explain the fix.
- The cold-start path is five calls: `search_stores` → `set_preferred_store` → `shop_for_items` → `create_shopping_list` → `add_shopping_list_to_cart`. Search is read-only; retrying the saved-list add is safe.
- Saved-plan suites cover explicit pantry units, reviewed package counts, stale edits, preparation retries, shopper isolation and retained fulfillment.

Token budgets use `estimateTokens()` (roughly four characters per token), not a billing tokenizer. Recalibrate deliberately with `EVAL_LOG=1`; a format change that breaks text-only chaining needs an explicit contract decision, not a higher budget to make tests pass.

## Limits

The end-to-end suites do not fixture the QFC circular endpoints. Deal behavior is covered separately in [tool tests](../tools/weekly-deals.test.ts) and [service tests](../services/qfc-weekly-deals.test.ts). Unknown fixture search terms synthesize generic products and fixture store hours are sparse; neither establishes real catalog behavior. Live login, provider refresh and real cart outcomes require separate authorized release validation.
