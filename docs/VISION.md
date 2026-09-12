# Vision and Host Integration

This document defines the product direction and responsibilities of the server and its
consuming hosts. [ROADMAP.md](ROADMAP.md) is the single prioritized backlog. The
[small-model efficiency plan](small-model-efficiency-plan.md) is an implementation record,
not a second queue of future work.

## North star

Grocery shopping supervised through chat: the assistant helps plan meals, use pantry stock,
find relevant deals, maintain lists, locate items in a store, and fill a supported retailer's
cart. The user approves changes and completes the purchase.

The server must remain useful to small-context models on free tiers. Tools need compact
schemas, copyable identifiers, bounded results, and recovery instructions that a host can
act on. The [MCP evals](../tests/evals/README.md) measure that contract. Live Workers AI evals
are opt-in and may incur usage charges; the free-tier product constraint is not a claim that
every model invocation is free.

## Responsibilities and storage

- **This repository:** the Cloudflare Worker MCP server, provider adapters, OAuth integration,
  deterministic household/catalog enrichment, cart operations, and MCP Apps views.
- **The agent host:** conversation state, model selection, meal planning, substitutions,
  workflow orchestration, scheduling, and user approval. Host frameworks and deployments
  live outside this checkout; compatibility claims require checking their current code.
- **The consuming interface:** presentation, user input, and approval UX. MCP Apps clients
  can render the supplied views; a separate web or messaging host can provide its own UI.

Shared household data—preferred store, pantry, equipment, recorded orders, and shopping
lists—is owned by agents-gateway/D1. The Worker accesses it through `/api/grocery/*`.
KV holds caches and cart persistence; a Durable Object journal coordinates atomic cart
operations. The MCP server is created per request and does not require persistent transport
sessions. OAuth state and credentials remain managed by the OAuth integration.

The checked-in gateway contract is [openapi/grocery-gateway.yaml](../openapi/grocery-gateway.yaml).
Coordinate shared contract changes with the gateway repository and regenerate this Worker's
client with `pnpm generate:gateway`; `pnpm api:check` checks generated-client drift.

Catalog identity is provider-neutral: `ProductReference` contains an open `provider` name
and its opaque `id`, rendered in model-facing text as `productRef=<provider>:<id>`.
UPC and SKU belong to adapters. Capabilities are explicit: Trader Joe's currently supports
browsing and lists, while Kroger supports cart writes using its native UPCs. Generic tools
must not assume that search implies support for carts, locations, aisle data, or checkout.

## Design principles

### Keep the tool surface small and composable

The server performs API calls, storage operations, normalization, deduplication, and bounded
enrichment. The host chooses what to cook, buy, or substitute. Do not embed an entire weekly
shopping policy in a new composite tool.

`shop_for_items` is an accepted convenience path: it selects one candidate per item, with a
bounded best-effort reranker, and can request a confirmed cart add. For price, brand, or
substitution decisions that require alternatives, use `search_products` followed by list
creation. Optional weekly deals in `get_meal_planning_context` supply evidence for the host;
they do not generate a meal plan.

### Put workflow guidance where the host can use it

The server exposes instructions and four workflow prompts. Hosts differ in whether they
load them. Keep the main tools usable without prompts or resources, and make next steps
clear in result text. Host-owned skills can reuse this guidance when a consuming host needs
them; creating a new `skills/` hierarchy is not a prerequisite for server work.

### Make failures and retry behavior explicit

Use typed errors for expected failures and translate them at the protocol boundary. Required
data failures must not look like empty results or a missing preference. Optional enrichment
may degrade, but it must not make an unsupported claim about freshness, inventory, or price.

State each mutation's real retry guarantee in its annotations, implementation, and tests.
Some list operations are non-idempotent; automatic replay is not universally safe. A cart
operation with a pending or unknown outcome must not be submitted again blindly. The
existing structured error and cart journal contracts are foundations to preserve.

### Pin workflows with evidence

Use deterministic MCP evals for tool sequences, identifiers, input normalization, recovery,
and token budgets. Use focused tests for storage, upstream failures, and UI actions. A
production model failure should become a reproducible fixture or transcript-derived scenario.

The live eval runner uses Workers AI. Add another inference backend only for a demonstrated
testing need; a provider-pluggable runner is not a current objective. Measure the full tool
definitions and representative text/structured payloads. Do not increase budgets simply to
make a regression pass.

## Host integration contract

This is the behavior a consuming host must verify, not an audit of an external deployment.

| Surface                   | Integration requirement                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool inputs and results   | Preserve copyable `productRef`, `storeId`, `listId`, and `itemId` values. Use concise result text as the main model-facing representation.                                                                            |
| Structured results        | Keep UI data available to the renderer without duplicating it unnecessarily in model context. Some hosts expose `structuredContent` to models, so server evals already budget representative structured payloads too. |
| Apps metadata             | App routing uses `_meta["dev.aranlucas/view"]`; render views only when the client supports MCP Apps. Unsupported UI capabilities must not block the text workflow.                                                    |
| Instructions and prompts  | Decide explicitly how the host exposes server instructions and workflow prompts. Do not assume a particular framework injects them automatically.                                                                     |
| Resources                 | Optional context for resource-capable clients. Core household context is also tool-reachable through `get_shopping_profile` and `get_meal_planning_context`.                                                          |
| Errors                    | Inspect `isError` and the structured error code/recovery fields. Preserve auth failures so the host can guide re-linking instead of inventing missing data.                                                           |
| Mutations                 | Respect confirmation, non-idempotent operations, and unresolved cart outcomes. Preserve user isolation across sessions and scheduled calls.                                                                           |
| Cancellation and progress | Forward cancellation where supported and handle progress without assuming it will be rendered.                                                                                                                        |

The current MCP-to-gateway bearer forwarding is documented in [GATEWAY_AUTH.md](GATEWAY_AUTH.md).
Its token audience and upstream credential boundary is an unresolved design item in the
[roadmap](ROADMAP.md#1-resolve-the-gateway-token-boundary). Host integration must not be used
as a reason to trust caller-supplied user identity headers.

## Outside the server's role

- Meal-plan generation, MCP Sampling, internal agent loops, and a recipe database. The
  bounded fallback-safe product reranker does not expand this responsibility.
- Scheduled shopping proposals, push notifications, and account-linking UX; these belong
  to the host and must use the server's existing user and retry boundaries.
- Payment and final order placement; the user completes purchase with the retailer.
- New tools that only repeat workflow instructions or duplicate existing context tools.

## Working on improvements

Choose a concrete outcome from the roadmap and include the scenario that proves it works.
For host-driven issues, inspect the caller's current parsing and orchestration code rather
than assuming a framework's behavior. Auth, shared-storage, and protocol changes need a
design before implementation and coordinated checks where they cross repositories. Update
the roadmap when work lands so completed features do not return as new proposals.
