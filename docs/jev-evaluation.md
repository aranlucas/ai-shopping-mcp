# Jev grocery evaluation — 2026-09-18

The live model is strong at distinguishing explicit grocery matches, but missing evidence and ambiguous requests still cause false selections. The original easy smoke test did not expose these weaknesses. A short evidence rule improved selection precision; a long rubric caused excessive abstention. Keep this a prototype pending real-catalog evaluation.

## Method

- All requests used the production selector through Cloudflare's `default` gateway, the stored OpenRouter key, and `typesafe/jev-1.13`. Recorded responses identify `typesafe/jev-1.13-20260917`, provider `TypeSafe`.
- Tuning set: 30 synthetic, hand-labeled grocery scenarios, each with 20 candidates. Each scenario ran in original, reversed, and seeded-shuffled candidate order: 90 decisions in nine calls per prompt variant.
- Fresh check: 12 additional cases authored after freezing the short rubric, in the same three orders: 36 decisions in six calls. These are separate examples from the same author and categories, not an independently curated benchmark.
- Cases cover category, brand, size/count, qualifiers, declared dietary attributes, missing evidence, ambiguity, eligibility, malicious catalog text, and one unit-conversion stress case. Labels were fixed before inference. Multiple acceptable products are allowed where appropriate. Both `no_match` and `needs_review` count as unresolved.
- The test Worker records responses, distributions, confidence, input tokens, provider-reported cost, and wall-clock selection latency. The five-second production deadline and response validator remain active. It has only an AI binding: no shopping-list, cart, or catalog credentials and no write access to those systems.
- Transport/validation errors count as unsuccessful decisions for every item in their batch. No retry or fallback hides them. Candidate-order variants are correlated observations, not 90 independent grocery examples.

## Results

| Variant | Correct end-to-end outcomes | Correct among selected products | Correct abstentions | Items blocked by batch errors | Median batch latency |
|---|---:|---:|---:|---:|---:|
| Original rubric, tuning set | 77/90 (85.6%) | 66/79 (83.5%) | 11/24 | 0 | 348 ms |
| Long explicit rubric, tuning set — discarded | 23/90 (25.6%) | 1/1 | 22/24 | 10 | 360 ms |
| Short evidence rule, tuning set — retained locally | 77/90 (85.6%) | 59/62 (95.2%) | 18/24 | 10 | 286 ms |
| Short evidence rule, fresh cases | 25/36 (69.4%) | 16/17 (94.1%) | 9/15 | 10 | 277 ms |

The shorter prompt did **not** improve total end-to-end accuracy on the tuning run: fewer false selections were offset by a rejected batch. In its successful tuning batches, it produced 77 correct outcomes out of 80; on the fresh check, 25 out of 26. Those conditional rates exclude failures and must not replace the totals above.

Across the retained short-prompt runs, successful batches took 188–1,541 ms; the nine ten-item tuning batches took 263–934 ms. Prompt experiments were sequential, with no controlled cold/warm comparison, so the latency differences are descriptive rather than causal. The discarded long-rubric run had one 5,003 ms timeout.

Provider-reported costs: original $0.005808; long rubric $0.005598 for returned calls; short rubric $0.006004; fresh check $0.002436. Total observed cost was about **$0.01985**. The timed-out request has no returned usage and may have additional charges; these are response-reported amounts, not a billing reconciliation.

## What failed

**Missing evidence.** The original rubric selected yogurt without a package size for an exact 32 oz request, rice pasta without gluten-free certification for a certified request, granola without a peanut-free label, and protein powder with no stated flavor for vanilla. Every original semantic error was a false accept; it chose all 66 expected positive matches correctly.

The retained prompt adds three short instructions: require evidence for requested attributes; review if no candidate confirms a requested size/flavor/brand/certification/free-from label; do not infer certifications or free-from labels from ingredients. Missing-evidence cases improved substantially. The fresh `decaffeinated black tea` case still selected plain Black Tea with no decaf evidence in the shuffled order (confidence 0.50). The short wording enumerates examples without solving all unspecified attributes.

**Ambiguity.** All three retained-prompt errors on successful tuning batches were `cream` → Heavy Whipping Cream, despite our label requiring review among whipping cream, sour cream, and cream cheese. That label encodes a conservative product policy; choosing whipping cream could be acceptable under a different shopping policy. Treat this as a policy-sensitive error, not a universally wrong semantic answer.

**Returned choice disagreed with its distribution.** Two short-prompt batches were rejected by the existing highest-probability validation:

- Tuning `brand-unavailable`: `choice=needs_review`, probability 0.43, while `no_match=0.44`.
- Fresh `decaf-missing`: a product was chosen at 0.41 while another option had 0.42.

Both returned complete distributions summing to 1. The validator was preserved and the entire batch failed before mutation. We did not choose the argmax ourselves, relax validation, or add a fallback. TypeSafe documents Choice as the highest-probability option, so this observed mismatch should be understood as a provider/model integration issue to investigate, not assumed away. [Choice reference](https://docs.typesafe.ai/primitives/choice)

**Prompt length and complexity.** The long explicit rubric accepted only one product across 80 returned decisions. It combined more rules and moved the requested item into instructions, so this experiment does not isolate which change caused the regression. It was discarded rather than shipped.

## Best practices supported by the experiment

1. Use direct, short rules and explicit missing-evidence behavior. More instructions can make the task worse. TypeSafe warns about literal reading, indirection, and conflicting criteria. [Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
2. Keep stock, fulfillment, arithmetic, identity mapping, and response validation in code. The eligibility cases pass partly because code removes invalid candidates. The one successful unit-conversion case does not establish numerical reliability.
3. Keep independent Choice questions batched, with bounded, relevant candidate fields. This evaluation supports feasibility at ten items and twenty candidates, not a bound for long real ingredient lists. See the separate [best-practices note](jev-best-practices.md) for route-specific token limits.
4. Do not confuse the winning probability with confidence or assume either guarantees correctness. Original ambiguous-cream mistakes reached confidence 0.93. Retrospectively, a 0.80 short-prompt threshold would have retained 50 correct tuning selections and rejected its three cream errors, but this is selected on observed data, discards valid choices, and is **not** a calibrated production threshold. [Confidence guidance](https://docs.typesafe.ai/confidence)
5. A Choice selects relatively among options; Noul evaluates an absolute proposition and can reject every candidate. A useful next comparison is a same-model Noul eligibility/reranking design, with thresholds selected on a held-out real-catalog set. It was **not** tested here. [Reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)

The small synthetic injection set passed with the retained rubric, but that is not an injection-resistance guarantee. Likewise, food-related labels here test whether a catalog claim is present; they do not verify certifications or actual allergy safety.

## Reproduce and inspect

- `pnpm eval:selector:live docs/jev-evaluation-latest.json` — rerun the tuning set against the current selector.
- `pnpm eval:selector:live docs/jev-evaluation-fresh.json --holdout` — rerun the fixed fresh set.
- [Synthetic fixtures](../scripts/fixtures/jev-grocery-cases.mjs), [evaluation runner](../scripts/eval-selector-live.mjs).
- Raw results: [baseline](jev-evaluation-baseline.json), [discarded long rubric](jev-evaluation-explicit-evidence.json), [retained short rubric](jev-evaluation-concise-evidence.json), [fresh cases](jev-evaluation-holdout.json). Artifacts include provider responses and selector hashes; baseline, short, and fresh artifacts include the source snapshot. The discarded long variant retains its hash and policy summary but not its full source.

No deployment or shopping-list/cart mutation was performed. The local prototype retains the three short evidence instructions, keeps no fallback, and adds no confidence threshold. Before enabling unattended cart writes, evaluate real retrieved shortlists, settle ambiguity policy, investigate near-tie response inconsistencies, and calibrate precision/coverage on independent labels.
