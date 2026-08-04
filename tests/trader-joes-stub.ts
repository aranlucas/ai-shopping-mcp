import { okAsync } from "neverthrow";

import type {
  TraderJoesClient,
  TraderJoesSearchResult,
} from "../src/services/traderjoes/client.js";

/**
 * Trader Joe's catalog stub for tests that never touch the catalog.
 *
 * It resolves to no matches rather than throwing, so a tool that reaches the
 * catalog incidentally still behaves, while tests that actually exercise
 * Trader Joe's build a client over a stub fetcher instead.
 */
export function stubTraderJoesClient(
  result: TraderJoesSearchResult = { storeCode: "701", products: [] },
): TraderJoesClient {
  return { searchProducts: () => okAsync(result) };
}
