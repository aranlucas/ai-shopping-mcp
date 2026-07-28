import { createRequestStateCodec } from "@modelcontextprotocol/server";

import type { CartConfirmationState } from "../src/cart-confirmation.js";

export const testCartConfirmationCodec = createRequestStateCodec<CartConfirmationState>({
  key: "test-cart-confirmation-state-key-32-bytes",
});
