# Jev 1.13 best practices for grocery selection

Updated 2026-09-18. This note compares the current selector in `src/services/product-selector.ts` with TypeSafe and OpenRouter primary documentation. Statements marked **Inference for this prototype** are design conclusions from those sources and the current code, rather than claims made by TypeSafe.

## What Jev is good at

Jev is a System One decision model: it evaluates supplied state and returns typed answers and probabilities instead of generated text. TypeSafe describes it as suitable for fast, focused judgments, routing, and classification. Jev accepts text, JSON objects, and arrays of text; it does not accept images, audio, or video. [System One](https://docs.typesafe.ai/concepts/system-one), [state](https://docs.typesafe.ai/concepts/state.md)

`Choice` is the native primitive for selecting one member of a fixed option set. Its response contains the selected option, a probability for every option, and confidence. The selected `choice` is the highest-probability option, and the probabilities sum to one. [Choice](https://docs.typesafe.ai/primitives/choice), [API reference](https://docs.typesafe.ai/api.md)

**Inference for this prototype:** A grocery shortlist is a reasonable Choice use case when the application needs one product identity. The current selector’s one Choice per requested item, with candidate IDs plus `no_match` and `needs_review`, matches that shape. This does not establish that Choice is more accurate than a candidate-by-candidate Noul reranker; that should be measured.

## Keep the question literal and narrow

TypeSafe says Jev answers the question that was written. It recommends exact conditions, explicit boundary cases, direct references to relevant state, and splitting a multi-factor judgment into smaller questions that code combines. It warns about literal reading, indirection, contradictory instructions and criteria, arithmetic, dates, and generation. [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [primitives](https://docs.typesafe.ai/primitives.md)

The current instruction now asks for positive evidence of product type and every explicitly requested attribute, treats missing evidence as unknown, distinguishes `needs_review` from explicit conflict, and states that ingredients do not establish certifications or free-from labels. This is closer to TypeSafe's literal-reading guidance than a generic “best match” instruction.

**Actionable gap:** Make the rubric describe the exact match conditions and rejection conditions that matter to the product policy. For example, state what counts as a product-type match, what a missing brand/size/dietary field means, and which requested qualifiers are hard constraints. Keep price arithmetic, quantity handling, stock checks, and fulfillment checks in code. Do not ask Jev to calculate totals or infer a value that code can read directly.

## Candidate data belongs in structured criteria, but it is still untrusted input

TypeSafe recommends object state with descriptive names and says structured instructions and Choice option descriptions can be strings, objects, or arrays. Its structured-criteria examples use fields such as `what`, `not_for`, and examples to clarify option boundaries. The Choice documentation also says that option names and descriptions are sent to the model, while the question ID is only an application key. [state](https://docs.typesafe.ai/concepts/state.md), [advanced structure](https://docs.typesafe.ai/primitives/advanced.md), [Choice request structure](https://docs.typesafe.ai/primitives/choice)

The current selector already sends each product as a structured Choice criterion containing name, brand, size, categories, declarations, allergens, and ingredients. That is preferable to embedding JSON in a long string and allows the model to see field names. Stable `item_N` and `candidate_N` IDs also make response mapping deterministic; TypeSafe guarantees that answers return under the question IDs supplied by the caller.

TypeSafe also warns that Jev does not treat state as hostile by default: adversarial content can steer an answer. It recommends precise criteria and testing edge cases. The current sentence saying that catalog fields are data rather than instructions is useful defense in depth, but it is not a security boundary.

**Actionable gaps:**

- Treat product descriptions, declarations, ingredient statements, and user queries as untrusted catalog text. Allowlist the fields needed for matching, normalize them, and cap their lengths before building the request.
- Prefer factual fields and explicit names over raw free-form blobs. If a field is missing, preserve it as unknown rather than synthesizing a value.
- Add structured boundaries to candidate descriptions where useful, such as a factual `match_evidence` or `conflicts` field produced by deterministic code. Do not claim a conflict that the catalog does not establish.
- Test candidate text containing instruction-like phrases, contradictory marketing copy, and unusually long ingredients/declarations. A prompt sentence cannot replace validation and test coverage.

These recommendations are an application of TypeSafe’s state and adversarial-content guidance; TypeSafe does not promise that the literal “catalog data” sentence neutralizes injection.

## Batching is recommended, but questions remain independent

TypeSafe recommends sending questions that use the same state in one request. Questions are evaluated in parallel, so adding questions generally adds little latency, while the extra question text and options still consume tokens. TypeSafe's Jev 1.13 model page specifies 64K tokens for state plus all questions, with a 32K limit for state plus the longest individual question. [multiple questions](https://docs.typesafe.ai/primitives.md#ask-multiple-questions-together), [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md), [TypeSafe model limits](https://docs.typesafe.ai/models.md)

The current implementation follows this guidance by issuing one request for the whole list and one Choice question per nonempty item. It preserves original positions and duplicate queries. It should be understood as parallel independent selections, not a joint basket decision: Jev does not enforce a shared budget, deduplicate products, or optimize substitutions across items. Such policy belongs in code or a separate explicitly designed decision.

There is a context-quality tradeoff in the current batch. Every question sees the shared `state`, and the current state contains all requested item strings, while each question also carries its own candidates in `criteria`. TypeSafe warns that unrelated state distracts Jev and recommends filtering first and sending only what the question needs. [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13#large-state-full-of-irrelevant-detail)

**Actionable gaps:**

- Keep each question’s requested item and candidates self-contained where possible, using structured instructions/criteria. Avoid putting unrelated list items into shared state merely for ID lookup.
- Budget the serialized request, not only the number of candidates. Twenty candidates across ten items can exceed the 64K total or the 32K state-plus-longest-question limit when ingredient or declaration text is long. Truncate or omit low-value fields deterministically, and fail clearly if the bounded request cannot be built.
- Retain the 20-candidate retrieval cap as a product policy only after measuring recall. Jev cannot select a product that retrieval omitted.

The last two points are **Inference for this prototype** from the documented context limit and context-rot guidance. OpenRouter's Jev 1.13 listing currently displays a 32K context window, while TypeSafe's model page gives the more detailed 64K-total/32K-state-plus-longest-question limits. Treat 32K as the conservative OpenRouter route budget until the deployed route is measured. [OpenRouter Jev 1.13](https://openrouter.ai/typesafe/jev-1.13), [Decisions endpoint](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request.md)

## Use confidence, not just the winning probability

TypeSafe defines `confidence` from the shape of the full Choice probability distribution. A concentrated distribution gives high confidence; a flat distribution gives low confidence. TypeSafe explicitly distinguishes confidence from the winning option’s probability: a winner at 0.45 with a runner-up at 0.44 is different from a winner at 0.45 with the remainder spread thinly. Confidence is calibrated across groups of predictions, but that does not guarantee that an individual answer is correct. [confidence](https://docs.typesafe.ai/confidence.md), [System One](https://docs.typesafe.ai/concepts/system-one)

The current response validation correctly checks that the returned choice is an allowed option and is a highest-probability option. It logs confidence and does not use an arbitrary acceptance threshold, which is appropriate for an uncalibrated prototype. It should not treat `probabilities[choice]` as a substitute for confidence.

**Actionable gap:** Build a labeled grocery set before gating automatic selection on confidence. Calibrate thresholds by outcome and action risk: accepted-choice precision at a threshold, coverage (fraction auto-selected), abstention rate, wrong-category rate, and hard-constraint violation rate. Keep the full distribution for evaluation. Choose thresholds from held-out examples; TypeSafe’s examples illustrate thresholds such as 0.9 for one domain, but do not establish a grocery threshold. [confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing.md), [classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence.md)

For this shopping flow, `needs_review` is a useful application-level abstention option. It is not a special Jev output type; it is one criterion that the application defines. `no_match` should mean that every candidate conflicts with the request, while `needs_review` should mean that the request is ambiguous or required evidence is missing. Keeping those meanings explicit makes abstention auditable.

## Choice versus Noul reranking

TypeSafe’s reranking cookbook first narrows a large corpus with fast retrieval, then asks one Noul question per query-candidate pair and sorts by the returned yes probability. It uses Noul because each candidate receives an independent “does this candidate fit?” score. A Choice is relative: it settles which supplied option wins against the other options. A Noul is absolute: every candidate can receive a low fit probability, including all candidates in a shortlist. [reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md), [Jev structural invariants](https://docs.typesafe.ai/model-jaggedness/jev-1.13#common-sense-structural-invariants)

The current Choice design instead compares the full shortlist inside one question and includes explicit abstention options. That is simpler and is supported by Choice’s documented option limit (up to 255). It may be the better fit when exactly one candidate should win from a bounded set, but this is a hypothesis. A Noul design makes an absolute fit gate possible, but its values are not interchangeable with Choice probabilities or confidence.

**Evaluation recommendation:** Compare the current one-Choice approach with a Noul-per-candidate design on the same frozen shortlists. For both, randomize candidate order, include wrong-category near matches, vary brand/size/dietary constraints, remove evidence fields, and include true no-match cases. Report acceptable-set hit rate, exact identity accuracy, abstention precision/recall, hard-constraint violations, confidence calibration, latency, and input tokens/cost. Do not compare Noul values to Choice probabilities or carry a threshold from one primitive to the other; TypeSafe warns that the two questions have different semantics. [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13#common-sense-structural-invariants)

## Evaluation protocol for “how it does”

The most useful test set is a frozen collection of real or realistically redacted Kroger shortlists with a human label for each requested item. Include:

- exact matches, near matches, wrong categories, and no valid candidate;
- explicit brand, size, package-count, dietary, and product-form requirements;
- missing or conflicting catalog fields;
- out-of-stock and pickup-ineligible products, with those deterministic filters labeled separately;
- duplicated requests and multi-item batches;
- candidate lists with the same products in different orders;
- adversarial or instruction-like catalog text.

Record the request, model version/provider, question rubric, candidate order, answer distribution, confidence, latency, token usage, and final policy outcome. Split tuning examples from held-out examples. Evaluate both per-item behavior and batch behavior; a batch passing does not show that it jointly optimized the basket.

The TypeSafe consistency cookbook notes that a near-threshold result can move between a concrete label and an uncertain outcome, even when abstention maps both to review. Re-run a small repeated sample when measuring stability, and report raw agreement separately from the abstention policy. [Choice consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md)

## Current assessment

The current prototype has the right high-level shape for a Jev experiment: bounded retrieval happens first, one typed Choice is issued per item, the whole list is batched, and candidate IDs are validated. `no_match`/`needs_review` leave an item unresolved when Jev returns them, but they do not guarantee that a selected candidate is valid; positive-evidence errors still require confidence gating and evaluation. The highest-value next measurements are confidence-gated precision/coverage, order sensitivity, and context-size behavior with real catalog text.

The main unresolved design questions are empirical: whether one Choice or Noul-per-candidate reranking gives better grocery accuracy, how much candidate text can fit in the 32K budget, and what confidence threshold provides acceptable precision for automatic cart/list actions. The primary docs support the measurement plan but do not answer those grocery-specific questions.
