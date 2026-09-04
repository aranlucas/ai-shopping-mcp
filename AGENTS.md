# Shopping MCP instructions

Read `docs/VISION.md` before architecture changes.

- Preserve the small-model contract: required IDs appear in `content[0].text` as `key=value`, responses name the next or recovery tool, and token budgets are not raised just to pass.
- Preserve Kroger's single-use refresh flow in `tokenExchangeCallback`; never refresh in auth middleware or expose refresh tokens and credentials through runtime `Props`.
- Use generated Kroger OpenAPI types directly, avoid `any`, and validate external JSON from `unknown` with Zod.
- Cache only product and location responses. Never put cart or identity responses in the shared cache. Kroger cart retry state stays in user-scoped Cloudflare KV; all non-Kroger persistence lives in agents-gateway/D1 behind `openapi/grocery-gateway.yaml`.
- After changing the gateway contract, regenerate and verify the Worker client with `pnpm generate:gateway` and `pnpm api:check`.
- Best-effort enrichment must fail open and remain fast.
- Add tests for behavior changes. Before handoff, run `pnpm build && pnpm test`; also run `pnpm eval:mcp` for response/schema changes and `pnpm build:views` for view changes.
