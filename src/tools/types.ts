import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { KrogerClients } from "../services/kroger/client.js";
import type { ProductService } from "../services/kroger/product-service.js";
import type { createUserStorage } from "../utils/user-storage.js";

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

/** Storage instance type, created once and shared via ToolContext */
export type UserStorage = ReturnType<typeof createUserStorage>;

// Shared context passed to all tool registration functions.
// Infrastructure dependencies only. Auth is accessed via getMcpAuthContext() from agents/mcp.
export type ToolContext = {
  server: McpServer;
  clients: KrogerClients;
  productService: ProductService;
  storage: UserStorage;
  getEnv: () => Env;
  getSessionId: () => string;
};

// --- Response helpers ---

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

/**
 * Returns a session-scoped storage key for shopping list isolation.
 * Each MCP session (chat) gets its own shopping list.
 */
export function getSessionScopedUserId(userId: string, sessionId: string): string {
  return `${userId}:session:${sessionId}`;
}
