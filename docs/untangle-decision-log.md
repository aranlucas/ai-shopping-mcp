# Untangle decision log

Skill: https://github.com/caldoai/skills/blob/main/skills/untangle-codebase/SKILL.md (fetched and read 2026-11-05). Both optional additions selected by user. Scope: this repository and bound isolated worktree only. Initial git status clean. User subsequently authorized commit, push, PR and merge subject to checks/protection; no deployment.

## Inventory before implementation

Inspected source tree, package scripts, lint/test/build configuration, recent Git history and independent backend, frontend and test inventories. The repository already has explicit request composition, shopping domain/storage contracts, generated Kroger clients, isolated cart journal and substantial behavior tests. Preserve those boundaries rather than reorganizing everything.

Backend: auth/composition/server; cart journal and persistence; shopping and meal-plan domain/storage; Kroger API/search/workload; weekly-deal acquisition/cache/presentation; tool registrations and results. Frontend: app protocol, routing, shared components/hooks, all feature views. Supporting scope: test harnesses, unit/integration/evaluation tests, CI/config/docs and existing scripts.

## Redesign decisions (before edits)

1. Own shared weekly-deals fetch policy in the weekly-deals service.
   - Hidden link: tools/weekly-deals owns 50/2 limits, meal-planning-deals and item-flags copy them even though they form one cache identity.
2. Own shopping identity schemas in the domain.
   - Needless link: domain/meal-plan imports UPC/store identity validation from tools/schemas; tool coercion helpers should remain tool-owned.
3. Separate stable Result adapters from request authentication and MCP presentation.
   - Needless link: Kroger services load agents auth infrastructure merely to use fromApiResponse/safeStorage from utils/result.
   - Props belongs with the auth parser, not tool transport types.
4. Remove unused barrels and compatibility exports; import actual owners.
   - Surplus weekly-deals/index and tool cache/search re-exports route tests through unrelated registrations.
5. Share location map links and preferred-store actions between location views.
   - Hidden links: duplicate address gate/join/Maps URL and repeated preferred-store state/action logic.
6. Remove only comments that narrate implementation; preserve external constraints, outage/approval/safety rationale.
7. Test cleanup last: remove self-comparison TOON assertion, replace recipe occurrence count with workflow behavior, remove unreferenced tsconfig.views.json. Preserve identity regression tests and meaningful concurrent/provider/storage coverage.

MealPlanStore's inferred type is type-only; assess an explicit interface against actual consumer needs before adding abstraction. No new libraries or scripts needed: use existing Zod, neverthrow, Vitest and native tools.

## Required special cases retained

Cart idempotency/conflict/unknown outcomes and legacy reconciliation prevent duplicate mutations. Strict receipts versus tolerant display mirrors have different safety requirements. Stale weekly-deal fallback/degraded results and best-effort flags protect useful context during outages. GET-only retries protect mutations; timeouts/cancellation constrain upstream work. Pickup search ordering and provider UPC normalization reflect real provider behavior. Meal-plan review/fulfillment and optimistic versions protect approval and concurrent edits. Miniflare isolation/cache workarounds document external runtime constraints.

## Baseline validation

- Initial commands encountered pnpm dependency installation and machine contention; incomplete attempts are not passes.
- Baseline lint failed: missing generated .cloudflare/types/index.d.ts and Tailwind design-system setup timed out after 120 seconds. Run native pnpm cf-typegen and repeat after setup; do not weaken lint.
- Baseline full suite: 62 files, 922 tests passed (846.41 seconds). Workerd emitted expected auth-unavailable and Durable Object cleanup diagnostics.
- Generated types with native pnpm cf-typegen. Interrupted typecheck attempts are not recorded as passes.

## Implementation and review outcomes

Implemented all accepted structural decisions. Stable Result adapters no longer import request auth/MCP transport; domain schemas no longer import tools. Shared weekly-deal limits now own cache identity for browsing, meal planning and flags. Removed compatibility exports, unused weekly-deals barrel and duplicate frontend tsconfig. Location views share preferred-store state/action and map URL generation. No dependencies or custom scripts added.

Retained inferred MealPlanStore type: it is type-only and mirrors the only concrete storage implementation; a separate interface would currently duplicate a contract without runtime decoupling benefit.

Independent review found duplicated credential validation between composition and request identity; both now use requestTokenSchema while retaining lazy token lookup. The stricter RPC credential contract remains separate. Recheck found no other worthwhile structural issues. Comment-only final pass removes restatements while retaining external constraints. Test cleanup came after structure: removed one TOON self-comparison, kept concrete independent wire checks, replaced prompt repetition counting with workflow assertions, strengthened resource tests to verify location query forwarding.

Validation: post-refactor typecheck passed. Lint initially caught moved-import duplication, Fast Refresh mixed exports, a boundary exemption requiring relocation, and unnecessary test assertions; fixed without weakening rules. Native oxlint --fix then passed. Final independent review, including a repeated pass after credential-schema consolidation and comment cleanup, found no worthwhile issues remaining.

Verified final behavior: pnpm typecheck passed; pnpm build:views passed; pnpm test passed 62 files / 921 tests in 89.38 seconds. Difference from baseline 922 is the single redundant TOON self-comparison; meaningful identity, concurrency, approval, storage, and independent TOON wire coverage remain. Expected Auth-service-unavailable diagnostics also appeared in the passing baseline. No introduced test failures remain.

Native oxfmt applied to changed files. Final pnpm lint and formatting check recorded with the commit/PR validation. Branch: refactor/untangle-codebase-20261106. Worktree: /home/lucas/.t3/worktrees/ai-shopping-mcp/refactor-untangle-codebase-20261106.
