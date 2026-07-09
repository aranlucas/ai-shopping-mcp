# Reranker Live Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a direct, opt-in production smoke test for the BGE reranker.

**Architecture:** A Node ESM script owns credential resolution, account selection, inference, and response assertions. It has no runtime dependencies and is exposed through one `package.json` script.

**Tech Stack:** Node.js 24+, pnpm, native `fetch`, Cloudflare Workers AI REST API.

## Global Constraints

- Do not run the live test through Vitest or include it in `pnpm test`.
- Prefer explicit CI credentials; use Wrangler OAuth only for local convenience.
- Never print tokens or secrets.
- Fail non-zero on all validation failures.

---

### Task 1: Add the direct live smoke test

**Files:**

- Create: `scripts/test-reranker-live.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: optional `CLOUDFLARE_API_TOKEN`, optional `CLOUDFLARE_ACCOUNT_ID`, or Wrangler OAuth config.
- Produces: process exit code 0 only for a valid live ranking with Whole Milk first.

- [ ] Write the script contract first by invoking the missing command; it must fail because the command does not exist.
- [ ] Add the Node script with credential resolution, direct `ai/run/@cf/baai/bge-reranker-base` invocation, and response assertions.
- [ ] Add `test:reranker:live` to `package.json`.
- [ ] Run the command against Workers AI and verify success.
- [ ] Run `pnpm build` and `pnpm test` to confirm the normal suite remains separate.
