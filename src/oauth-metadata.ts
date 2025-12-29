import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Kroger OAuth 2.0 Authorization Server Metadata
 * This metadata tells MCP clients how to authenticate with Kroger directly
 */
export const krogerOAuthMetadata = {
  issuer: "https://api.kroger.com",
  authorization_endpoint: new URL(
    "https://api.kroger.com/v1/connect/oauth2/authorize",
  ),
  token_endpoint: new URL("https://api.kroger.com/v1/connect/oauth2/token"),
  // Kroger supports authorization code flow
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  // PKCE support (recommended for public clients)
  code_challenge_methods_supported: ["S256"],
  // Scopes that our MCP server uses
  scopes_supported: ["profile.compact", "cart.basic:write", "product.compact"],
  // Token endpoint authentication methods
  token_endpoint_auth_methods_supported: ["client_secret_basic"],
} as const;

/**
 * OAuth Protected Resource Metadata for this MCP server
 * This advertises that we use Kroger as our authorization server
 */
export function createProtectedResourceMetadata(resourceServerUrl: string) {
  return {
    resource: resourceServerUrl,
    // Point to Kroger's authorization server
    authorization_servers: [new URL("https://api.kroger.com")],
    // Scopes required to access this resource server
    scopes_supported: [
      "profile.compact",
      "cart.basic:write",
      "product.compact",
    ],
    // OAuth 2.0 Bearer token authentication
    bearer_methods_supported: ["header"],
    resource_name: "Kroger Shopping List API",
    resource_documentation: resourceServerUrl,
  };
}
