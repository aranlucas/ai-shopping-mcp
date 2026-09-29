# Cloudflare CLI migration

This project uses `cf` (currently the Cloudflare CLI open beta) for deployment.
`cloudflare.config.ts` defines Worker settings and bindings. Where present,
`wrangler.config.ts` retains esbuild and local development settings. The
configuration was generated with `cf migrate` and reviewed for lifecycle and
environment settings.

Use the package deployment scripts so required frontend builds run first.
After building the Worker, run `cf deploy --prebuilt --dry-run` in its directory
to validate without uploading. Named environments
use `--mode` instead of Wrangler's `--env`.

The existing `wrangler.jsonc` files remain as compatibility inputs for
Wrangler type generation, Vitest/getPlatformProxy, framework adapters, and
legacy resource-management commands. Keep their bindings in sync with
`cloudflare.config.ts` while those integrations still consume Wrangler config.
Wrangler remains a dependency for these tools and for cf's esbuild backend.

For Cloudflare Workers Builds, update dashboard deploy commands from
`wrangler deploy` to the package deployment script after merging. Dashboard
settings and production deployments are not changed by this PR.

`build:worker` explicitly selects the Wrangler build backend where frontend-only
Vite builds, workspace roots, or OpenNext would otherwise bypass Worker packaging.
This produces cf’s Build Output Specification for `cf deploy --prebuilt`.
D1 migration directories remain configured in the retained Wrangler inputs used
by the existing database scripts.
