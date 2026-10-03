# Anti-slop integration

The upstream source is vendored from dmmulroy/anti-slop at
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`; see
`tools/oxlint/anti-slop/UPSTREAM.md` and its licenses. All upstream `src/`
files, including generic/Effect rule tests, are retained unchanged. There is
no official npm package dependency. Oxlint and `@oxlint/plugins` are pinned
together to 1.86.0; the existing pnpm 12.6.0 package manager is retained.

All 18 generic rules and native `oxc/no-accumulating-spread` run in the existing
CI lint job, alongside the existing type-aware lint, formatting, typecheck,
view build, and test jobs. Effect rules are not enabled because this project
has no direct Effect dependency. The vendored implementation is excluded
from application lint/type discovery; its RuleTester suites are checked
separately. Application Vitest discovery remains under `tests/`, with a Node
project for real cross-realm function checks and the existing Worker project
for application tests.

## Generated files

Only these additional generated declarations are excluded from lint:
`src/services/kroger/cart.d.ts`, `location.d.ts`, `product.d.ts`, and
`identity.d.ts`. Their openapi-typescript generator markers and original bytes
are preserved. The `kroger/*.json` inputs and pinned 7.13.0 generation commands
are unchanged. The hand-maintained `weekly-deals.d.ts` remains linted.

## Boundary exceptions

Narrow next-line exceptions retain established contracts rather than hiding
untrusted values in aliases or replacing them with `any`:

- `src/errors.ts`: opaque error context and object/array identity, including
  runtime primitive/object discrimination.
- `src/workers-oauth-utils.ts`: opaque OAuth extension state in both public
  form helpers. Envelope and AuthRequest fields are validated separately;
  original extension keys and JSON encoding order are retained. The provider
  grant boundary in `src/server.ts` likewise validates known fields while
  preserving extensions and excluding refresh credentials from access props.
- `src/utils/result.ts`: raw authenticated-props parser input and cross-realm
  callable overload dispatch.
- `src/utils/user-storage.ts`: cross-realm value/provider overload dispatch.
- `src/utils/toon.ts`: arbitrary values are forwarded to the native encoder.
- `src/utils/json.ts`: syntax-only JSON output stays explicitly untrusted.
- `src/tools/location.ts`: deliberately permissive location input is validated
  before consumption, preserving misspelled zip-key compatibility.
- `src/services/kroger/weekly-deals.d.ts`: undocumented upstream metadata stays
  opaque and is not consumed as a normalized application contract.
- `tests/v2-tool-handler.ts`: raw SDK output is checked by the native SDK schema.
- `tests/evals/harness.ts`: token estimation delegates arbitrary values to
  JSON.stringify without claiming application validation.

Documented assertions preserve actual owner contracts: generated SDK success
responses (including no-content `undefined`), finite schema/discriminator
correlation, finite category keys, D1 ordered batch results, native MCP JSON
schema interoperability, SDK overloaded registration spy types, caller-owned
KV JSON decoding, and checked strict capability adapters. The latter throws
on missing capabilities rather than inventing results; its `typeof` override
is limited to genuine type guards in `tests/strict-fake.ts`.

Module-level mocks were replaced with actual MCP/Agents auth contexts, real
McpServer registration/input validation, real openapi-fetch clients with local
fetch fixtures, SDK-owned App capabilities, and narrowly scoped method spies.
Tests cover omission versus undefined, error identity, arbitrary TOON values,
OAuth special own keys/encoding, CSRF and malformed token rejection, callback
missing-clientId behavior, cross-realm dispatch, and strict adapter failures.

`fromApiResponse` retains the existing generated-SDK success typing contract:
it does not runtime-validate generic T and manually supplied missing data is
still returned unchanged. This is documented and regression tested.

## Verification and limits

Verified locally: production view and Worker builds, application/view
typechecks, full lint including existing type-aware lint, formatting, frozen
pnpm 12.6.0 install, and 865 passing offline application tests (60 opt-in
evaluation cases skipped). All 23 vendored generic and
Effect RuleTester suites pass separately; the upstream CLI harness is not
counted as passed. Hosted CI must pass on the exact PR head before merging.

Live agent/provider evaluations stay opt-in and are not run against real data
or APIs. Rendered browser verification was unavailable because the supported
cloud browser route was blocked (`ERR_BLOCKED_BY_CLIENT`); no alternate
hostname or security bypass was used. UI confidence is limited to verified
component tests, types, and the production view build.
