import { env } from "cloudflare:test";
import type { CartOperationStore } from "../src/cart-operations.js";

/** Real isolated journal, including atomic storage semantics in tool tests. */
export function cartOperationStore(): CartOperationStore {
  return env.CART_OPERATIONS.getByName(crypto.randomUUID());
}
