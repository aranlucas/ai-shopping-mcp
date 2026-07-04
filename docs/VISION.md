# Vision and Host Integration

This document is the north star for the project and the contract between this repo and the
agent host that consumes it. `docs/ROADMAP.md` prioritizes tool-layer features; this document
explains the system those features serve, records the design decisions (including the
explicitly rejected ones), and defines how to ask for improvements so future work stays
aligned. When a request here conflicts with an assumption in `AGENTS.md`, this document says
which side wins and why.

---

## North star

Automated grocery shopping supervised through chat: the user talks to an assistant on
Telegram or a website, powered by **free-tier models**, and the assistant handles the full
loop — meal prep planning, recipe finding, deal-aware list building, pantry reconciliation,
cart filling, and routing efficiently through the physical store. The human approves and
purchases; everything else is automated.

"Free-tier models" is a hard constraint, not an aspiration. Every design decision in this
repo already bends toward it (the small-model contract in `tests/evals/README.md`), and
every future change must keep bending toward it.

## System architecture: three layers

1. **The hands — this repo.** A Cloudflare Worker MCP server: Kroger/QFC API access, OAuth,
   per-user KV storage (pantry, equipment, lists, orders, preferences), weekly-deal scraping,
   and a tool surface engineered for weak models.
2. **The brain — external, exists.** A Google ADK (`adk-python`) agent service. It connects
   to this server as an MCP client via `MCPToolset` and runs the reasoning loop on free-tier
   models through **LiteLLM**, primarily **NVIDIA NIM** plus other free providers.
3. **The face — external, exists.** **AG-UI** as the web frontend for the ADK service, with
   Telegram as a planned/parallel channel.

The division of labor is strict:

- This server does **mechanical** work: API calls, storage, deterministic enrichment
  (dedup, flags, sorting, normalization). It never reasons on the host's behalf — MCP
  Sampling was removed deliberately and stays removed.
- The ADK agent does **all planning and reasoning**: which tools to call, what to cook,
  what to substitute, when to ask the user.
- The frontend owns presentation and approval UX.

## Design principles

### 1. Composable primitives, not workflow tools

**Decision:** the tool surface stays small, single-purpose, and composable. We do **not**
add composite "uber tools" (e.g. a hypothetical `propose_weekly_cart` that fuses deals +
pantry + cadence + list creation server-side).

**Why:** the product must stay flexible across workflows we haven't fully enumerated — meal
prep, recipe finding, in-store routing, and whatever comes next. A composite tool bakes one
workflow's policy into the server and takes the decision away from the agent. The agent
orchestrates; the server provides sharp tools.

**The corollary:** since free models are poor orchestrators, the burden shifts to making
each primitive maximally orchestratable — ids extractable from text, next-tool hints,
normalizing schemas, deterministic enrichment (see the small-model contract). When a
workflow is hard for a small model, the fix is a *primitive-level* improvement (e.g. an
aisle-sorted list output) plus workflow guidance (skills), never a fused tool.

### 2. Workflows live in skills; prompts are thin wrappers

`adk-python`'s `MCPToolset` surfaces **tools only** — MCP prompts and resources are
invisible to the production host. So:

- **Canonical workflow definitions live as skills**: markdown files under `skills/`
  (`skills/<workflow>/SKILL.md`), one per end-to-end workflow (store routing, meal prep,
  deal-aware planning, weekly shop, restock check). The ADK host loads them into agent
  instructions — lazily per detected intent, since free-model context is scarce.
- **MCP prompts in `src/prompts.ts` become thin wrappers** over the same content, so
  prompt-capable hosts stay served without duplicated text.
- The server's `initialize` **instructions** field carries the golden path and core tool
  guidance; the ADK host should inject it into agent context since ADK does not do so
  automatically.

### 3. Eval-first development, on Workers AI

Every workflow the product supports gets pinned by an eval. The live suites run on
**Cloudflare Workers AI** (`EVAL_LIVE=1`) — free tier, already wired in, and a fair proxy
for the NIM-class models the host runs. We deliberately do **not** build a
provider-pluggable eval harness; if a specific NIM model misbehaves in production, convert
the transcript into a deterministic eval case instead.

The eval phrasing template for new workflow asks:

> Add an eval scenario: a Haiku-class model, given [starting state], accomplishes
> [workflow] in ≤ N tool calls. Make whatever primitive-level changes are needed for it to
> pass — no new composite tools.

### 4. Built for unattended, rate-limited callers

The agent will eventually run on schedules (weekly shop proposals pushed to Telegram) with
nobody watching, over flaky free tiers. That imposes:

- **Idempotency** on every mutation (cart add already is; make it universal).
- **Structured, detectable auth errors**: when a scheduled run hits an expired grant, the
  host must be able to recognize it programmatically and DM the user a re-link button
  rather than let the model hallucinate around it.
- **Degrade shorter, never truncated**: a small model fed a truncated blob is how carts
  get 40 bananas.

Proactivity (cron scheduling, push, approval flows) lives in the ADK/host layer, not here.
This repo's job is to make scheduled calls safe and legible.

## Host-channel audit

What this server exposes vs. what the ADK host actually sees. Verified against the code as
of this writing.

| Surface | ADK visibility | Status |
| --- | --- | --- |
| Tools (16) | ✅ Visible | The entire effective contract. |
| Prompts (3, incl. store-routing) | ❌ Invisible | Content migrates to `skills/` (principle 2). |
| Resources (5, TOON-formatted) | ❌ Invisible | Data is tool-reachable (see below); TOON is small-model-hostile if ever wired up. |
| MCP Apps views / `_meta.ui` | ❌ Not rendered | AG-UI has its own generative UI. Harmless if the host strips it. |
| `structuredContent` | ⚠️ Depends on host | **Token landmine** — see below. |
| Progress notifications | ❌ Ignored | Harmless. |
| `initialize` instructions | ⚠️ Not auto-injected | Host should inject manually. |

Key findings:

- **Resource data is not trapped.** `get_shopping_profile` reads preferred store, pantry,
  equipment, and the last 50 orders, and computes frequently-purchased items and restock
  suggestions — so the invisible resources cost the host little.
- **`structuredContent` is the most likely silent misalignment.** The token budgets in
  `tests/evals/token-budget.eval.test.ts` govern `content[0].text` only. If the ADK/LiteLLM
  pipeline serializes the full tool result — including the view-feed `structuredContent`
  JSON — into model context, those budgets are fiction for the production stack. The host
  must extract `content[0].text` only. (Host-side fix first; a server-side capability-gated
  opt-out for `structuredContent` is a candidate backlog item if needed.)
- **`shop_for_items` embeds a selection policy.** Embedding re-rank plus a pickup-first
  heuristic pick one winner per term; the agent never sees alternatives or their prices.
  This is an accepted opinionated shortcut, not a violation of principle 1, because the
  full-control path (`search_products` → `create_shopping_list`) exists. Skills should
  steer the agent to the primitive path for budget- or brand-sensitive workflows.
- **Aisle data already flows.** Product responses carry `aisleLocations` (including
  `sequence`, the store walk order) and the markdown formatters print `aisle: N` — but
  shopping-list output does not carry or sort by aisle, which is the store-routing gap.

## Improvement backlog

Prioritized. Each entry is phrased so it can be handed to a session as-is, one per PR.

1. **Host-side (not this repo): verify tool-result extraction.** Confirm the ADK/LiteLLM
   pipeline feeds the model `content[0].text` only — no `structuredContent`, no `_meta`.
   Everything else assumes this is true.
2. **Skills as canonical workflows.** Add `skills/` with `SKILL.md` per workflow
   (store-routing, meal-prep, deal-planning, weekly-shop, restock-check); rewrite
   `src/prompts.ts` as thin wrappers over the same content; add an eval scenario per
   workflow using the template in principle 3.
3. **Aisle-aware shopping lists.** Optional aisle-sorted ordering of shopping-list output
   using `aisleLocations[].sequence`, with an ` | aisle N` line suffix (same best-effort
   contract as `item-flags.ts`). Pin with a store-routing eval: model produces an
   aisle-ordered route for a 12-item list. Unblocks the store-routing skill.
4. **Roadmap #1, #2, #5** (deal-aware planning, pantry-aware lists, preferences). These are
   the grounding for recipe finding: recipe *knowledge* stays in the host model's weights —
   we do not build a recipe database — but deals/pantry/preferences context is what turns
   generic recipes into this household's plan. Add a recipe-finding eval on top.
5. **Headless OAuth design doc.** Design (doc before code) the auth story for a multi-user
   Python host: per-user Kroger account linking via link-out URL, MCP token storage and
   refresh from the ADK service, and behavior when a scheduled run hits an expired grant —
   under the constraint that Kroger refresh tokens are single-use (see `AGENTS.md`), so the
   host and server must never race on a refresh.
6. **Structured error contract for unattended runs.** Auth-expired and other terminal
   errors detectable programmatically by the host (stable code in the response), not just
   prose. Extends `tests/evals/error-actionability.eval.test.ts`.
7. **Universal idempotency on mutations.** Audit every non-read tool; document and test the
   retry-safety guarantee for each.
8. **`HOST_CONTRACT.md`.** Once 2–7 settle, write the versioned promise this server makes
   to any host: id extraction format, token budgets, error taxonomy, idempotency,
   auth flow. Host-side work then builds against a document instead of reverse-engineering
   tool outputs.
9. **Roadmap #7, #3, #4, #6** (deals cron, restock suggestions, price history, store
   comparison) in roadmap order, as capacity allows.

## Explicitly rejected

Recorded so future sessions don't re-propose them:

- **Composite workflow tools** (`propose_weekly_cart` and kin) — see principle 1.
- **Provider-pluggable live eval harness** (LiteLLM/OpenAI-compatible endpoint) — Workers
  AI is free, wired in, and close enough; production failures become deterministic evals
  instead.
- **Server-side LLM calls / MCP Sampling** — the host model reasons; the server stays
  mechanical. (Best-effort embedding re-ranking in `match-ranker.ts` is the one sanctioned
  exception: deterministic in effect, never blocking, never load-bearing.)
- **A recipe database or recipe-search API integration** — recipe knowledge lives in the
  host model; this server supplies grounding context only.
- **A `get_workflow_guide` tool** (workflow guidance over the tool channel) — costs a tool
  slot and a round trip on models where both are scarce; skills solve it host-side.

## How to ask for improvements

The playbook that produced this document, kept for reuse:

1. **One backlog/roadmap item per session, referenced by number.** The entries above are
   phrased to be handed over verbatim.
2. **New workflows are asked for eval-first** using the principle-3 template. The eval is
   the spec; "no composite tools" is the standing constraint.
3. **Production failures become evals.** When the ADK agent fumbles, bring the transcript:
   "my agent, running model X over LiteLLM, failed to do Y — here's the transcript" is
   worth ten speculative feature requests, and converts directly into a test case.
4. **Design docs before architectural code.** Anything touching auth, caching scope, or
   the host contract gets a doc in `docs/` first (this repo's existing culture).
5. **Cross-repo context.** When a change is motivated by host behavior, add the ADK service
   repo to the session so the agent can see how tool output is actually parsed — half of
   good tool design is seeing the caller's code.
6. **License deviations explicitly.** `AGENTS.md` constraints exist for the MCP server;
   if an ask intentionally crosses them (or this document), say so in the request and
   update the relevant doc in the same PR — never silently.
