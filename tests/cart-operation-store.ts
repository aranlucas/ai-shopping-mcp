import { exports } from "cloudflare:workers";
import type { CartOperationStore } from "../src/cart-operations.js";

/** Real isolated journal, including atomic storage semantics in tool tests. */
export function cartOperationStore(): CartOperationStore {
  return exports.CartOperations.getByName(crypto.randomUUID());
}
