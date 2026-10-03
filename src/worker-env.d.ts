import type { CartOperations } from "./server";

// cf infers a same-Worker Durable Object binding as an untyped namespace
// because cloudflare.config.ts names the Worker by string.
declare global {
  namespace Cloudflare {
    interface Env {
      CART_OPERATIONS: DurableObjectNamespace<CartOperations>;
    }
  }
}
