# Reranker Live Test Design

Add an opt-in command, `pnpm test:reranker:live`, that calls the production Workers AI reranker REST endpoint directly. It is intentionally outside Vitest and never runs under `pnpm test`.

The script uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` when both are provided, which is suitable for CI. For local use it reads Wrangler's OAuth token from its standard config locations, asks the Cloudflare Accounts API for accessible accounts, and requires an explicit account id if the token can access more than one account.

It submits a fixed Whole Milk versus Chocolate Milk Bar ranking request and validates a successful response, two unique complete ranking ids, numeric scores, and that Whole Milk ranks first. Authentication, API, malformed-response, and ranking failures exit non-zero with an actionable message. No secrets are logged.
