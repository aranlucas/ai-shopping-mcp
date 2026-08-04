import type { McpServer, RequestStateCodec } from "@modelcontextprotocol/server";
import type { CartConfirmationState } from "../cart-confirmation.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { ProductService } from "../services/kroger/product-service.js";
import type { CatalogRegistry } from "../services/catalog/types.js";
import type { ShoppingStore } from "../utils/gateway-storage.js";
import type { CartStore } from "../utils/user-storage.js";

// Props stored in the access token and exposed through the MCP auth context.
// Only contains what's needed for runtime API calls — no refresh credentials.
export type Props = {
  id: string;
  accessToken: string;
  tokenExpiresAt: number;
};

// Full props stored in the grant for token refresh.
// Contains Kroger credentials needed by tokenExchangeCallback to refresh upstream tokens.
export type GrantProps = Props & {
  refreshToken?: string;
  krogerClientId: string;
  krogerClientSecret: string;
};

/** @deprecated Use ShoppingStore for non-cart shopping data. */
export type UserStorage = ShoppingStore;

// Shared context passed to all tool registration functions.
// Infrastructure dependencies only. Auth is accessed via getMcpAuthContext() from agents/mcp.
export type ToolContext = {
  server: McpServer;
  clients: KrogerClients;
  productService: ProductService;
  /**
   * Product catalogs available to this request, keyed by provider id. Tools
   * search through this registry rather than any one retailer's client, so a
   * new provider needs no tool changes.
   */
  catalogs: CatalogRegistry;
  storage: ShoppingStore;
  carts: CartStore;
  requestStateCodec: RequestStateCodec<CartConfirmationState>;
  getEnv: () => Env;
};

// --- Response helpers ---

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}
