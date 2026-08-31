# AI Shopping List

An MCP server that uses the Kroger API to search QFC/Kroger products and manage shopping lists.

## Run locally

Requires Node.js 24.18+ and pnpm.

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
# Add the Kroger credentials to .dev.vars.
pnpm dev
```

The server exposes the MCP endpoint configured by the Worker project. Keep credentials in Worker secrets or ignored local files.

## Verify

```bash
pnpm lint
pnpm test
pnpm build
```

The server is designed for MCP clients such as Codex and Claude Code. See [`wrangler.jsonc`](wrangler.jsonc) for deployment configuration.
