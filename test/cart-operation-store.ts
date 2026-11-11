import { exports } from "cloudflare:workers";
import type { CartJournal } from "@/cart-operations.js";

/** Real isolated journal, including atomic storage semantics in tool tests. */
export function cartOperationStore(): CartJournal {
  return exports.CartOperations.getByName(crypto.randomUUID());
}
