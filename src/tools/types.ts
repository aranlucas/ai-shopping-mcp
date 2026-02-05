import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { createUserStorage } from "../utils/user-storage.js";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export type Props = {
  id: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  // Kroger credentials stored for token refresh in tokenExchangeCallback
  krogerClientId: string;
  krogerClientSecret: string;
};

// Shared context passed to all tool registration functions
export type ToolContext = {
  server: McpServer;
  getProps: () => Props | undefined;
  getEnv: () => Env;
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
