import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { createUserStorage } from "../utils/user-storage.js";

// Props stored in the access token and provided to McpAgent as this.props.
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

// Shared context passed to all tool registration functions
export type ToolContext = {
  server: McpServer;
  clients: KrogerClients;
  getProps: () => Props | undefined;
  getEnv: () => Env;
  keepAliveWhile: <T>(fn: () => Promise<T>) => Promise<T>;
};

/**
 * Validates that the user is authenticated and returns typed props.
 * Throws if not authenticated.
 */
export function requireAuth(ctx: ToolContext): Props {
  const props = ctx.getProps();
  if (!props?.id) {
    throw new Error("User not authenticated");
  }
  return props;
}

/**
 * Resolves a location ID, falling back to the user's preferred location.
 * Throws if no location is available.
 */
export async function resolveLocationId(
  storage: ReturnType<typeof createUserStorage>,
  userId: string,
  locationId?: string,
): Promise<{ locationId: string; locationName?: string }> {
  if (locationId) {
    return { locationId };
  }

  const preferredLocation = await storage.preferredLocation.get(userId);
  if (!preferredLocation) {
    throw new Error(
      "No location specified and no preferred location set. Please provide a locationId or set your preferred location using set_preferred_location.",
    );
  }

  return {
    locationId: preferredLocation.locationId,
    locationName: preferredLocation.locationName,
  };
}
