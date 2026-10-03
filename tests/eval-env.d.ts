export type EvalEnvironment = Cloudflare.Env;

declare global {
  namespace Cloudflare {
    /** Optional bindings supplied by this repository's opt-in Vitest eval configuration. */
    interface Env {
      COOKIE_ENCRYPTION_KEY: string;
      KROGER_CLIENT_ID: string;
      KROGER_CLIENT_SECRET: string;
      EVAL_AGENT?: string;
      EVAL_LOG?: string;
      EVAL_MODELS?: string;
      EVAL_TASKS?: string;
      OPENROUTER_API_KEY?: string;
      EVAL_CODEX_DRIVER?: Fetcher;
    }
  }
}
