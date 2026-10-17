export type EvalEnvironment = Cloudflare.Env;

declare global {
  namespace Cloudflare {
    /** Optional bindings supplied by the deterministic MCP test configuration. */
    interface Env {
      EVAL_LOG?: string;
    }
  }
}
