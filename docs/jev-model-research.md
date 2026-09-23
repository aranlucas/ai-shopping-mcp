# Jev research and prototype

Updated 2026-09-18. Jev is now the default and sole selector in `shop_for_items`, using Cloudflare AI Gateway and OpenRouter BYOK. There is no BGE fallback, heuristic fallback, or feature flag. This follows the requested prototype scope.

## Implemented behavior

- `src/services/product-selector.ts` calls `env.AI.gateway("default").run()` with provider `openrouter`, endpoint `../alpha/decisions`, and query `{ model: "typesafe/jev-1.13", state, questions }`. The stored OpenRouter key under alias `default` is injected by the gateway. The Worker binding authenticates automatically.
- The expanded 20-result Kroger shortlist is filtered for explicit out-of-stock inventory. Pickup cart requests additionally require a UPC and actual curbside support.
- One inference request handles the entire list, with one independent Choice question per nonempty eligible shortlist. Stable positional question IDs preserve duplicate requests and response order independence. Each Choice selects a local candidate ID, `no_match`, or `needs_review`. Candidate evidence includes name, brand, size, category, and supplied declarations, allergen text, and ingredients. Missing attributes remain unknown.
- A valid selected ID maps back to the original product. There is no subsequent pickup-first picker that could override Jev.
- Zod validates the response. Code also checks candidate membership, a complete probability distribution, approximate normalization, and that the choice is a highest-probability option. Confidence is logged but no uncalibrated numeric acceptance threshold is imposed for this prototype.
- No-match/review outcomes remain unresolved. Successful items can form a partial list, with unresolved requests named in the result. All-unresolved requests return guidance to use `search_products`.
- A single five-second deadline for the whole batch aborts the request and rejects even if a test binding ignores cancellation. Any model/validation failure returns an MCP error before creating a list or writing a cart. No fallback or application retry runs.
- Wrangler was updated from 4.133.0 to 4.135.0 (latest at implementation time), and `worker-configuration.d.ts` was regenerated. No AI SDK dependency was added.

The earlier baseline used Workers AI BGE (`@cf/baai/bge-reranker-base`) plus a pickup/in-store-first heuristic. That service, its tests, and its live-check script have been replaced. Shopping data now lives in the Worker's D1 database; Cloudflare AI Gateway remains the inference route.

## Cloudflare route and account setup

The configured path is Worker → Cloudflare `default` gateway → OpenRouter Decisions → TypeSafe Jev. A live check verified the OpenRouter key on this gateway under alias `default`, and separately verified the TypeSafe key entry is unconfigured. No new credential was created or copied into the application.

Cloudflare's native `env.AI.run("typesafe/jev", ...)` route returned HTTP 402 because it did not use the stored OpenRouter key. The provider-specific gateway binding does use that key. [Binding reference](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/), [OpenRouter provider](https://developers.cloudflare.com/ai-gateway/usage/providers/openrouter/)

OpenRouter Decisions lives at `/api/alpha/decisions`, outside the normal `/api/v1` provider base. Live checks verified that relative endpoint `../alpha/decisions` reaches it through the gateway binding; `alpha/decisions` returned 404. This relative-path behavior is empirically verified, not an explicitly documented Cloudflare Decisions integration. The `gateway.run()` universal transport is deprecated by Cloudflare but currently works; this is a prototype limitation worth revisiting before production. The suggested chat-completions replacement is not Jev's Decisions API. [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request.md), [Universal endpoint status](https://developers.cloudflare.com/ai-gateway/usage/universal/)

Each call sets `cf-aig-max-attempts: 1`. There is no fallback array or application retry. Live responses include probabilities and confidence, which this prototype requires and validates. OpenRouter's schema marks those fields optional, so their absence fails explicitly. The model context window is 32,000 tokens. [OpenRouter model](https://openrouter.ai/typesafe/jev-1.13)

## AI SDK alternative

Vercel AI SDK 7 supports `experimental_evaluate` with typed Choice, Boolean, and Score questions. Vercel AI Gateway's live catalog lists `typesafe-ai/jev` as an evaluation model. An explicit provider can be created using `createGateway` from `ai`, then `gateway.evaluationModel("typesafe-ai/jev")`. This is a valid alternative, but is not used in this prototype. [Evaluation documentation](https://vercel.com/docs/ai-gateway/modalities/evaluation), [Gateway catalog](https://ai-gateway.vercel.sh/v1/models), [provider configuration](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)

The earlier example was typechecked against `ai@7.0.105` in an isolated temporary directory. Its Choice answer exposes optional probabilities and no separate public confidence field; Boolean exposes `probability`, whereas native TypeSafe/Cloudflare use `noul`. Its default retry count is two, so a bounded no-retry integration would use `maxRetries: 0`. [Result types](https://github.com/vercel/ai/blob/main/packages/ai/src/evaluate/evaluation-result.ts), [evaluate implementation](https://github.com/vercel/ai/blob/main/packages/ai/src/evaluate/evaluate.ts)

A custom AI SDK evaluation adapter around the Cloudflare binding could be added if a shared SDK interface becomes useful. No built-in Cloudflare Jev evaluation adapter was verified during this research.

## Other primary-source findings

| Topic               | Evidence                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What Jev does       | Typed decisions over supplied state, including Choice, Noul, and Score; it does not generate free-form reasoning. [TypeSafe System One](https://docs.typesafe.ai/concepts/system-one)                                                                              |
| Candidate selection | Choice evaluates a named set of options and can include none-of-the-above. [Choice](https://docs.typesafe.ai/primitives/choice)                                                                                                                                    |
| Limitations         | Arithmetic, indirect instructions, irrelevant context, and adversarial state can cause errors. Keep exact price/quantity calculations and structural checks in code. [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)                    |
| Native API          | `POST https://api.typesafe.ai/v1/systemone` accepts model, state, and questions. [API](https://docs.typesafe.ai/api)                                                                                                                                               |
| OpenRouter          | Dedicated alpha Decisions API, rather than assuming chat completions; `typesafe/jev-1.13` is the documented example. [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request.md)              |
| Moving aliases      | OpenRouter's `~typesafe/jev-latest` currently points at Jev 1.13. Cloudflare's `typesafe/jev` and Vercel's `typesafe-ai/jev` are different routing IDs, not proof of immutable versions. [Latest](https://openrouter.ai/~typesafe/jev-latest)                      |
| Published cost      | OpenRouter lists $0.042/M input and zero output. Vercel's public catalog reports the same rate; Cloudflare pricing was not independently verified. [OpenRouter](https://openrouter.ai/typesafe/jev-1.13), [Vercel catalog](https://ai-gateway.vercel.sh/v1/models) |

An unauthenticated OpenRouter routing check found `/api/alpha/decisions` returned 401, while paths containing `/api/v1` returned 404 despite confusing OpenAPI base-path metadata. The configured relative endpoint above accounts for that base-path mismatch.

## Harder evaluation follow-up

The easy smoke test was followed by 30 synthetic challenge cases in three candidate orders and 12 fresh cases. Missing required attributes caused false selections; a short positive-evidence rule improved selected-product precision but did not remove ambiguity errors or occasional choice/probability inconsistencies. See the [complete measured results](jev-evaluation.md) and [primary-source best practices](jev-best-practices.md). The local selector retains that short rule, with no confidence gate or fallback.

## Verification and remaining evaluation

`pnpm test:selector:live` starts an ephemeral local Worker with only a remote AI binding and exercises the production selector, including its deadline and response validation. It uses Wrangler login or Cloudflare environment credentials. It sends ten requested items with twenty candidates each in one inference request, checks nine expected selections, and checks abstention for the candy-only shortlist. Expected matches are placed twentieth. It does not create shopping lists or cart entries, and it stops the Worker and removes temporary configuration afterward.

Both live batches passed through OpenRouter BYOK: the initial two-item milk/candy check and the full ten-item × twenty-candidate check (nine correct selections, one abstention). A separate minimal live request reported model `typesafe/jev-1.13-20260917`, provider `TypeSafe`, and chose milk with probability/confidence 1. An OpenRouter `gpt-4o-mini` hello request also succeeded through the stored key, solely as a connectivity check; it is not a selector or fallback. No credits were purchased or keys changed.

Focused tests cover a single call for ten items with twenty candidates each, reordered/missing/extra answers, empty shortlists, selection identity, default routing, abstention, fulfillment/stock filtering, malformed responses, failure propagation, timeout cancellation, and preventing mutations after failure or abstention. Deterministic MCP evals inject a Jev inference fixture while exercising the real selector and tool workflow. Live host-model evals preserve their separate Workers AI binding calls.

For broader quality evaluation, label realistic grocery shortlists with acceptable candidates or no match. Include wrong-category near matches, requested size/brand/dietary attributes, missing evidence, stock/fulfillment differences, and shuffled candidate order. Measure accepted-choice precision, abstention, constraint errors, latency, and cost. Keep retrieval failures separate: Jev cannot pick a product outside the 20 candidates. The prototype does not establish superiority over the former BGE baseline.

Batching answers independent product-selection questions; it does not jointly optimize the basket for a total budget or other cross-item constraints. Those require separate deterministic policy or host reasoning.
