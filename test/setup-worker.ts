import { env, reset } from "cloudflare:test";
import { afterAll, vi } from "vitest";

// Reused runtimes need both native binding cleanup and our Auth stub's reset.
afterAll(async () => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await reset();
  await env.AUTH.fetch("https://auth-stub/reset");
});
