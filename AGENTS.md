After making changes, run `pnpm lint` and fix all errors.

The views use `@shadcn/lint` in `.oxlintrc.json`. Use component variants and
badge tones for appearance; keep `className` for layout. The config documents
the spacing, carousel gutter, and skeleton rounding contracts. Shared UI
implementations in `views/shared/ui/` own their styles and retain their existing
lint exclusion. Tailwind utility checks come from the shared Oxforge Tailwind preset in `.oxlintrc.json`.

## Scripts: native first

Before adding a script file (`scripts/`, `bin/`, `tools/`, root `*.sh|*.py|*.mjs`) or a package script that runs one, take the first rung that works:

1. A flag or subcommand of a tool the repo already uses (`<tool> --help`).
2. Declarative config for that tool (`cloudflare.config.ts`, `vite.views.config.ts`, `drizzle.config.ts`, `oxfmt.config.ts`, `pnpm-workspace.yaml`, `vitest.config.ts`).
3. A maintained plugin for that tool.
4. A one-line package.json script that calls a native command.
5. A test in the existing runner (Vitest), for anything that asserts.
6. A custom script, only for behavior specific to this repo. Its first comment names the native rung it couldn't use and why. It has a test in the existing runner, and the PR that adds it quotes that comment.

## Code: libraries first

Before hand-writing general-purpose code, use a well-maintained library: actively released, widely adopted, typed, and a fit for this stack. Reach for one already in the dependencies first. Write custom code for domain logic and for the glue no library covers. A PR that adds a dependency says why it was picked; a PR that hand-writes something a library covers names the library and why it didn't fit.

- Runtime validation → zod.
- Typed Kroger HTTP clients → openapi-fetch with the generated API types.
- D1 queries and schema definitions → drizzle-orm.

## Tests worth maintaining

- Before adding a test, identify the specific behavior, a credible mistake it should catch, and an independently justified expected result.
- Prefer small, fast, reliable tests whose failures identify the broken behavior. Use integration/E2E tests for interactions isolated tests cannot establish.
- Do not reproduce implementation logic in assertions or mocks.
- Protect contracts, not incidental internal structure.
- Distinguish temporary development scaffolding from checks worth maintaining.
- Never delete or weaken a failing test just to make the suite pass.
