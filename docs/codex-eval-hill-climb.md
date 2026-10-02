# Codex eval hill climbing — 2026-10-02

The current Codex session drove the shopping MCP against the existing task
suite. The retained candidate passes all ten training tasks when the original
Codex decisions are replayed, and all five held-out tasks with live Codex
decisions. The training score increase fixes a grader false negative; it does
not represent improved model performance.

| Phase              | Decisions                     | Task passes | Average tool calls | Tool errors |
| ------------------ | ----------------------------- | ----------- | ------------------ | ----------- |
| Training baseline  | Live Codex                    | 9/10        | 2.1                | 0           |
| Training candidate | Paired replay of the baseline | 10/10       | 2.1                | 0           |
| Held-out candidate | Live Codex                    | 5/5         | 1.4                | 0           |

Base revision: `51baddb29fa7b20b13d657809fffdcc7040dc2d9`. The
[comparison JSON](codex-eval-hill-climb.json) retains task scores, answers,
feedback, call counts, source hashes, and the before/after cart confirmation.
Full reports and transcripts remain in the workspace:

- Baseline: `eval-results/codex-O2w9rj/`.
- Candidate: `eval-results/codex-IihuSD/`; `replay.json` identifies the ten
  replayed training tasks. Generated list/item IDs were mapped to the fresh
  fixture state, while choices, quantities, final answers, and feedback were
  preserved.
- Driver guard verification: `eval-results/codex-2vn6Er/`.

## Retained changes

The `missing-item` baseline correctly added bread and answered:

> Added bread to your pickup cart. Kroger returned no products for zzzfrobnut sauce, so I left it out.

The grader scored this 0.5 because it only accepted a narrow set of phrases.
It now accepts ordinary missing-product wording, requires the unavailable
item and explanation in the same sentence, and rejects tested negations and
explanations about a different item. Nineteen wording cases cover accepted
and rejected answers. This remains a deterministic wording heuristic.

The read-only check now follows the current tool contract: `shop_for_items`
discovers options without writes, while `set_preferred_store` changes saved
state. A regression check distinguishes discovery from cart and store writes.

The `cheaper-milk` training transcript exposed an ambiguous cart confirmation.
Two gallons were described as “1 item.” Confirmations now distinguish lines
and packages, state fulfillment, and expose copyable store IDs and UPCs:

```text
Before: Added 1 item(s) to cart at QFC - University Village:
          - 0001111041700 x2

After:  Added 1 line item(s), 2 package(s) to cart at QFC - University Village for PICKUP (storeId=70500847):
          - upc=0001111041700 x2
```

List-backed confirmations and retry messages use the same quantity wording.
The held-out delivery task independently returned two lines, three packages,
and `DELIVERY`. Cart writes retain their existing retry behavior.

## Running subsequent iterations

Use `pnpm eval:agent:codex` to expose the real fixture-backed MCP to the
current Codex session. The driver creates a fresh run directory and preserves
the transcript, standard vitest-evals report, run metadata, and relevant source
snapshots. It uses the same task setup and end-state judge as the OpenRouter
harness. The [eval README](../tests/evals/README.md#using-the-current-codex-session-as-the-llm)
documents the turn protocol and `EVAL_TASKS` filtering.

Retain a training baseline before editing. Choose changes from its tool
results and inspect grading failures before attributing them to the model.
Validate the candidate on held-out tasks after tuning. Clearly mark any
replayed decisions; the candidate training feedback above was copied from the
baseline and therefore still describes the old confirmations.

Codex had repository context, so these runs are developer diagnostics rather
than a blind small-model benchmark. No OpenRouter models were run. Interactive
token usage is unknown and the summary displays `-`.

## Validation

- Initial deterministic baseline: 58 checks passed.
- Candidate eval and cart suites: 127 checks passed, including 20 grader
  regression cases; the 60 OpenRouter cases skipped without opting in.
- `pnpm lint` and `pnpm typecheck` passed.
- The driver rejected a stale turn ID with HTTP 409. Two simultaneous actions
  for the same turn produced one acceptance and one HTTP 409, followed by one
  observed MCP call and a passing task.
