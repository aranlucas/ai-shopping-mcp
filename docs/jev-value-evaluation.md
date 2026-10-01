# JEV value evaluation — 2026-09-30

Implementation decision after these runs: JEV has been removed from the production
API. `shop_for_items` now returns up to five eligible options per item for the
calling agent to choose, and performs no list/cart writes. The findings below are
retained as the record of the comparison. The old selector lives in
`scripts/fixtures/jev-product-selector.ts` solely for evaluation reproduction.

JEV improves these difficult synthetic shortlists over blindly taking the first eligible product. Its main benefit when retrieval already ranks a match first is abstention, rather than choosing a better product. This evaluation does not establish its marginal benefit on normal Kroger searches or against a calling assistant choosing exact UPCs. Keep it provisionally; measure real retrieval before removing it or declaring it essential.

## Method

The current production selector was called live through Cloudflare AI Gateway and OpenRouter. No selector prompt, threshold, validation, or fallback was changed. Each request retained the production five-second deadline and batched up to ten items. The ephemeral Worker has only the AI binding; there were no Kroger calls or shopping-list/cart writes.

We reused the fixed 30 tuning cases and 12 holdout cases, without changing their labels. Each contains acceptable UPCs, or requires abstention. Both `no_match` and `needs_review` count as correct abstention. The paired baseline selects the first candidate satisfying the same explicit-stock, UPC, and curbside checks as the production selector. Every decision is scored against the same labels and candidate order. Errors count as incorrect for every item in the failed batch.

Three experiments:

1. **Compact challenge shortlists:** Original candidates without the unrelated filler products; original, reversed, and seeded-shuffled orders. 42 cases × 3 orders = 126 decisions in 15 calls.
2. **Ideal-retrieval control:** Compact candidates reordered using the labels to put acceptable products first. This is an oracle control, not measured Kroger relevance. 42 decisions in 5 calls. It isolates what JEV contributes when a suitable product already leads the list.
3. **Expanded stress shortlists:** The same cases expanded to 20 candidates using the existing unrelated fillers; three orders. 126 decisions in 15 calls. Reversing these lists puts irrelevant fillers first and strongly disadvantages the baseline. Treat this as a stress test, not normal-search accuracy.

The compact run completed first. The control and expanded runs were launched concurrently, so their latency measurements may be affected by overlap. Calls within each run were serial. These are single runs, without retries or repeated-sampling stability estimates. Candidate-order observations are correlated; 294 decisions represent only 42 unique cases. Combining tuning and holdout cases does not create a new independent holdout.

The existing runner had stopped supplying `requestId` after a selector interface change. We repaired that before running inference. The new reports retain ordered input candidates, paired baseline outcomes, selector source/hash, raw provider answers, confidence, and usage.

## Results

| Experiment              | JEV correct outcomes | First eligible correct | JEV wins / regressions | Wrong JEV selections | Items blocked by batch failures | Median / max batch latency |
| ----------------------- | -------------------: | ---------------------: | ---------------------: | -------------------: | ------------------------------: | -------------------------: |
| Compact challenge       |      121/126 (96.0%) |         44/126 (34.9%) |                 79 / 2 |                    3 |                               0 |             165 / 1,615 ms |
| Ideal-retrieval control |        40/42 (95.2%) |          29/42 (69.0%) |                 12 / 1 |                    1 |                               0 |               245 / 843 ms |
| Expanded stress         |      113/126 (89.7%) |          10/126 (7.9%) |                103 / 0 |                    3 |                              10 |             262 / 1,375 ms |

A win means JEV alone was correct; a regression means the baseline alone was correct. Overall outcomes include correct abstention, not just product choices.

In the ideal-retrieval control, the baseline selected correctly on **29/29 matchable requests**; JEV selected correctly on **28/29**. JEV correctly abstained on **12/13 unmatchable or ambiguous requests**, while the baseline incorrectly selected products on all 13. Thus JEV's net gain of 11 outcomes came entirely from abstention, offset by one missed valid match. This dataset deliberately contains many difficult negative cases; their proportion is not an estimate of traffic.

Selected-product precision was 85/88 (96.6%) for compact, 28/29 (96.6%) for the control, and 82/85 (96.5%) for expanded. These small synthetic counts cannot establish a production acceptance threshold.

Reported costs were $0.002096, $0.000699, and $0.008440 respectively: **about $0.01124 total** for 35 inference calls. These are response-reported charges, not billing reconciliation. Median latency describes selector calls, excluding Kroger retrieval and list/cart persistence. Baseline selection makes no model request; its CPU latency was not benchmarked.

## Failures worth acting on

- **Ambiguity:** Every run selected Heavy Whipping Cream for `cream`, although the fixed policy expects review among whipping cream, sour cream, and cream cheese. Confidence ranged from 0.39 to 0.74. This is a shopping-policy disagreement, not proof that whipping cream is universally wrong.
- **Missed valid match:** The compact run abstained on `vegan-conflict` in reversed and shuffled order; the control also abstained despite the valid vegan product being first. Conflicting ingredient evidence is appropriately difficult, but the supplied correct candidate was available.
- **Batch amplification:** One expanded batch returned `needs_review` with probability 0.34, while `no_match` had 0.35. The production highest-probability validator rejected all ten items, including nine other answers. Both disputed options map to unresolved in the application, yet the contract mismatch blocked the entire batch. This reproduces the original evaluation's integration issue. The evaluation preserves the validator; it does not silently choose another answer.

## Decision

Do not replace JEV with unconditional first-result selection based on this evidence: it removes useful abstention on explicit attributes, missing evidence, and ambiguity. Conversely, these challenge fixtures do not justify a mandatory model dependency for every ordinary item. The ideal-retrieval control supports the concern that JEV can add little positive-match value when retrieval is already good.

Before a retain/remove decision, capture a representative sample of real Kroger search shortlists, preserving the actual search ordering and production pickup sorting, request wording, and metadata completeness. Fix independent labels before inference, and score first-eligible, JEV, and caller-led exact-UPC selection on identical catalogs. Report matchable and unmatchable requests separately, accepted-choice errors, abstention/coverage, hard-attribute violations, list-level failures, complete flow latency, and tool calls. Choose acceptance criteria before running the comparison. Caller-led selection was not evaluated here.

Two changes merit separate implementation review regardless of the model decision: explicit ambiguity/review outcomes, and reducing whole-list failure amplification while preserving validation before writes. No production behavior was changed in this evaluation.

## Reproduce

```sh
pnpm eval:selector:live docs/jev-evaluation-comparison-compact.json --all --compact
pnpm eval:selector:live docs/jev-evaluation-comparison-ranked.json --all --compact --ranked-control
pnpm eval:selector:live docs/jev-evaluation-comparison-expanded.json --all
```

Requires Wrangler/Cloudflare access and the existing OpenRouter BYOK gateway. These commands incur inference usage. Run serially for isolated latency comparisons.

Raw reports: [compact](jev-evaluation-comparison-compact.json), [ideal-retrieval control](jev-evaluation-comparison-ranked.json), [expanded](jev-evaluation-comparison-expanded.json). Fixtures: [fixed grocery cases](../scripts/fixtures/jev-grocery-cases.mjs). Runner: [live evaluation](../scripts/eval-selector-live.mjs).

## Agent shortlist comparison — 2026-09-30

We subsequently tested the actual selection alternative: give a generative model the whole shortlist and let it choose via a `select_products` tool call. The model was `openai/gpt-5.4-mini`, with low reasoning effort, forced strict tool output, a 4,096-token output limit, and no retries. It saw the same ordered candidates, projected catalog fields, eligibility filters, and conservative matching rules as JEV. Expected labels and prior JEV answers were never sent to the model. Inputs were replayed directly from the paired reports, rather than regenerated.

This isolates the calling agent's selection step. It does **not** run an end-to-end MCP agent, provide conversation preferences, or test whether the agent could search again or ask the user. The agent had a 60-second deadline versus JEV's five seconds; all completed agent calls took less than five seconds. JEV was not rerun alongside the agent, so these are matched input comparisons with earlier live results, not simultaneous trials.

| Metric                                     | JEV, 1–3 candidates | GPT-5.4 Mini, 1–3 candidates | JEV, 20 candidates | GPT-5.4 Mini, 20 candidates |
| ------------------------------------------ | ------------------: | ---------------------------: | -----------------: | --------------------------: |
| Correct outcomes                           |     121/126 (96.0%) |              116/126 (92.1%) |    113/126 (89.7%) |             109/126 (86.5%) |
| Correct selected products / all selections |               85/88 |                        85/93 |              82/85 |                      85/100 |
| Wrong selections                           |                   3 |                            8 |                  3 |                          15 |
| Valid matches rejected                     |                   2 |                            2 |                  0 |                           2 |
| Correct abstentions                        |               36/39 |                        31/39 |              31/39 |                       24/39 |
| Items blocked by errors                    |                   0 |                            0 |                 10 |                           0 |
| Median batch latency                       |              165 ms |                     1,132 ms |             262 ms |                    1,518 ms |
| Reported cost                              |           $0.002096 |                    $0.019229 |          $0.008440 |                   $0.060717 |

On compact shortlists the agent improved two JEV outcomes and regressed seven. On expanded shortlists it improved nine and regressed thirteen. The agent selected the same number of correct products (85) with both shortlist sizes; extra options increased wrong selections from eight to fifteen and reduced correct abstentions from 31 to 24. The extra products remain unrelated synthetic fillers, so this does not measure better retrieval coverage.

Compact failures included the ambiguous cream case, catalog instruction text on the sole unsuitable product, missing sesame-free evidence, and unit equivalence. These are examples from a small challenge set, not a general robustness ranking of the models. The agent comparison does not establish that every calling model would underperform JEV.

The two completed agent runs cost approximately $0.07995 in reported usage. An initial expanded run was interrupted after five completed batches by a local Worker restart following a package-file edit; it has no complete score and was excluded. Its completed calls reported another $0.03103, bringing observed agent-evaluation usage to approximately $0.11097, with possible unreturned usage on the interrupted request. The full expanded run was restarted from the beginning; no outputs from the interrupted run were selected for inclusion.

**Updated decision:** Giving this model the shortlist is substantially better than the first-result baseline on the challenge set, but did not outperform JEV. Increasing shortlist size without improving relevance made its results worse. These data support keeping useful candidate evidence available to the calling agent, but do not support removing JEV on the claim that more options alone improve selection. A real-search comparison with the actual calling model remains needed for that decision. Agent latency here is a standalone model call, not measured incremental latency in an existing agent turn.

Reproduce:

```sh
pnpm eval:agent-selector:live docs/jev-evaluation-comparison-compact.json docs/jev-evaluation-comparison-expanded.json
```

Set `EVAL_SELECTOR_MODEL` to test a different OpenRouter model. Reports are written beside the input files with an `-agent.json` suffix; copy them before rerunning a different model. Requires the same Cloudflare/OpenRouter gateway credentials and incurs usage.

Raw agent reports: [compact](jev-evaluation-comparison-compact-agent.json), [expanded](jev-evaluation-comparison-expanded-agent.json). Runner: [agent comparison](../scripts/eval-agent-selector-live.mjs). Worker: [selection tool call](../scripts/agent-selector-live-worker.ts).
