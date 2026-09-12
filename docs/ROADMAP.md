# Roadmap

Reviewed against the code on September 12, 2026. This is the single prioritized backlog for
the MCP server. [VISION.md](VISION.md) describes the architecture and host contract;
[the efficiency plan](small-model-efficiency-plan.md) records earlier implementation work.

## Constraints

- Keep planning, substitutions, scheduling, and purchase approval in the host. This server
  supplies catalog data, household context, deterministic enrichment, and cart operations.
- Use open provider registration and `productRef=<provider>:<id>` at shared boundaries.
  Kroger supports cart writes; Trader Joe's currently supports browsing and lists. Do not
  assume every provider supports stores, prices, aisle data, or carts.
- Shared household data belongs in agents-gateway/D1. New persistent profile fields need a
  gateway contract and migration, not another Worker KV storage class. KV remains appropriate
  for caches and cart state; atomic cart operations use the existing Durable Object journal.

## Next: MCP and error-handling correctness

### 1. Resolve the gateway token boundary

The [current gateway authentication design](GATEWAY_AUTH.md) forwards the incoming MCP OAuth
bearer token to agents-gateway, which verifies it through the MCP `/userinfo` endpoint and
resolves the canonical shopper. That design needs review against the
[MCP authorization rules for token audience and upstream credentials](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

Design the resource boundaries and a separate gateway credential or token-exchange flow with
the gateway owner before changing either service. Preserve verified shopper resolution and
fail-closed ownership checks; do not restore trusted caller-supplied user headers.

**Done when:** the documented design addresses upstream token forwarding, and coordinated
implementation/tests prove audience separation, user isolation, expired-token handling, and
migration behavior. This is a cross-repository change, not a local auth-header patch.

### 2. Enforce consumption of synchronous Results

Promise handling is enforced by the regular lint/build path, including floated `ResultAsync`
values. A Promise settling successfully does not prove its `Err` was handled: discarded
synchronous `Result` values and ignored results after `await` still need compatible enforcement.

Oxlint's JavaScript plugin API currently lacks the type-aware APIs required by
`eslint-plugin-neverthrow`. Revisit when a supported integration exists; do not introduce a
second legacy lint stack or a syntax-only rule that mistakes a returned error for handled work.

**Done when:** the normal lint command rejects discarded Results, while valid propagation and
explicit recovery pass. Add a failing fixture to demonstrate the integration before adopting it.

### 3. Validate structured tool outputs

[App results](../src/app-results.ts) have TypeScript types, but the UI parser only checks the
view name before casting the payload. Tools also do not advertise `outputSchema`.
Define shared runtime schemas for structured results, validate incoming view data, and expose
the corresponding [MCP output contracts](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

**Done when:** valid success payloads match their advertised schemas, malformed payloads fail
gracefully in the app, and error/text-only branches remain valid. Measure schema and response
token costs before changing budgets. Text-only context tools can stay text-only; MCP output
schemas are optional, so this is a contract improvement rather than a missing protocol requirement.

## Then: focused product improvements

### Interactive list editing

Wire the [shopping-list view](../views/app/views/shopping-list.tsx) to the existing editing
tools. Carry durable `itemId` and `checked` state through the app payload and typed action
bridge; provide quantity, check-off, and removal controls with visible failure handling and
state refresh. Reuse the runtime output schemas above. No new editing tools are needed.

### Aisle-aware lists

Add optional aisle enrichment and ordering for a selected store, reusing product lookup's
existing `includeLocation` support. Keep items with missing aisle data visible, bound lookups,
and preserve the original list order unless routing is requested. Validate with a fixture
workflow that produces a route and identifies items with unknown locations.

### Conservative pantry reconciliation

Build on existing pantry flags and meal context with an explicit “already have / need to buy”
review. Today's pantry records contain names and quantities, without product references or
units. Fuzzy name matching cannot justify automatic quantity subtraction. Start with
user-reviewed suggestions; reliable arithmetic depends on a shared identity/unit contract
and must account for expired stock. Never silently remove a requested purchase.

### Read-only list cost estimate

Estimate a saved list using exact product references, selected-store prices, and quantities
before a cart write. Report priced-item coverage, unknown prices, availability, conditional
promotions, and excluded taxes/fees. Free-text or unmatched items remain explicitly unpriced.
A missing price is not zero. This feature does not require collecting price history, and an
estimate request must never mutate the cart.

### Persistent household preferences

Persist dietary preferences, dislikes, and household size in agents-gateway/D1, then include
them in meal context. Per-call `dietaryPreferences` already exists. The gateway API, migration,
and shared-client updates are prerequisites; avoid a second Worker-only household profile.
Treat preferences as planning constraints, not verified product allergen or nutrition data.

## Deferred or outside scope

- **Price history:** no demonstrated need for per-search snapshot writes yet. Revisit with a
  concrete price-trend workflow, retention/write budget, and provider/store/currency identity.
- **Multi-store comparison:** follow a trustworthy single-store estimate. Compare exact
  products and pack sizes across a small bounded set of stores; name matches alone do not
  establish comparable baskets, especially across providers.
- **Standalone sale-substitution or workflow-guide tools:** the host can compose existing
  search, deals, context, and list tools. Improve guidance and add a failing workflow eval
  before expanding the tool surface.
- **A new skills hierarchy or host-framework migration:** no demonstrated requirement in
  this repo. Validate a consuming host's actual prompt, instruction, and result handling
  before planning host-specific changes; see the [host contract](VISION.md#host-integration-contract).
- **Universal automatic mutation retries:** document and test each operation's actual retry
  semantics. Preserve pending/unknown cart outcomes and avoid retrying non-idempotent writes.
- **Coupon clipping, pickup-slot booking, and nutrition integrations:** outside the currently
  supported integrations. Revisit only with a verified supported data source and a concrete
  workflow; do not expand scraping speculatively.
- **Server-side meal-plan generation, MCP Sampling, and a recipe database:** the host owns
  planning and recipe selection. The existing bounded product reranker remains an exception.
- **Order placement and payment:** the assistant fills the cart; the user completes purchase.

## Delivery gates

Each change needs focused behavior tests plus the applicable repository gates: `pnpm build`,
`pnpm test`, formatting, and `git diff --check`. Tool changes must preserve the
[small-model contract](../tests/evals/README.md), including copyable identifiers, actionable
errors, and bounded text and structured payloads. New workflow behavior needs a deterministic
MCP eval; live-model runs remain opt-in. Gateway changes also require generated-client checks
and verification in the gateway repository. Record deployment verification separately from
implementation status.
