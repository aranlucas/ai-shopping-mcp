import OAuthProvider, { GrantType } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent, createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { KrogerTokenInfo } from "./services/kroger/client.js";
import type { GrantProps, Props, ToolContext } from "./tools/types.js";

import { KrogerHandler } from "./kroger-handler.js";
import { registerPrompts } from "./prompts.js";
import {
  createKrogerClients,
  isKrogerTokenExpiring,
  refreshKrogerToken,
} from "./services/kroger/client.js";
import { registerCartTools } from "./tools/cart.js";
import { registerEquipmentTools } from "./tools/equipment.js";
import { registerLocationTools } from "./tools/location.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerPantryTools } from "./tools/pantry.js";
import { registerProductTools } from "./tools/product.js";
import { registerRecipeTools } from "./tools/recipes.js";
import { registerResources } from "./tools/resources.js";
import { registerShoppingListTools } from "./tools/shopping-list.js";
import { registerWeeklyDealsTools } from "./tools/weekly-deals.js";
import { createUserStorage } from "./utils/user-storage.js";
import { APP_VIEW_URI, registerViewResource } from "./utils/view-resource.js";

/**
 * Tool/resource registrars, each invoked with the shared ToolContext.
 * Add a new tool module here — registration order is not significant.
 */
const TOOL_REGISTRARS: Array<(ctx: ToolContext) => void> = [
  registerCartTools,
  registerLocationTools,
  registerProductTools,
  registerPantryTools,
  registerEquipmentTools,
  registerOrderTools,
  registerRecipeTools,
  registerShoppingListTools,
  registerWeeklyDealsTools,
  registerResources,
];

const SERVER_INFO = { name: "kroger-ai-assistant", version: "1.0.0" } as const;
const SERVER_OPTIONS = {
  instructions:
    "AI shopping assistant for Kroger/QFC stores. Search stores and products, manage pantry and kitchen equipment, create shopping lists, add shopping lists to the Kroger cart, record completed orders, and gather meal-planning context. Read MCP resources such as shopping://user/pantry, shopping://user/kitchen-equipment, shopping://user/preferred-store, and shopping://user/order-history before making personalized suggestions. Create shopping lists with create_shopping_list and pass the returned shopping_list_id to add_shopping_list_to_cart.",
} as const;

/**
 * Builds a fresh `McpServer` with all tools/resources/prompts registered.
 *
 * `createMcpHandler` is stateless: a new server is created per request so
 * responses cannot leak between clients. Auth `Props` are read lazily from
 * `getMcpAuthContext()` (populated by `OAuthProvider` and wrapped in the
 * handler's AsyncLocalStorage), so registration itself needs no auth context.
 * `sessionId` is the per-request MCP session used to scope user storage.
 */
function buildServer(env: Env, sessionId: string): McpServer {
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);

  const clients = createKrogerClients((): KrogerTokenInfo | null => {
    const props = getMcpAuthContext()?.props;
    if (
      !props ||
      typeof props.accessToken !== "string" ||
      typeof props.tokenExpiresAt !== "number"
    ) {
      return null;
    }
    return { accessToken: props.accessToken, tokenExpiresAt: props.tokenExpiresAt };
  });

  const storage = createUserStorage(env.USER_DATA_KV);

  const ctx: ToolContext = {
    server,
    clients,
    storage,
    getEnv: () => env,
    getSessionId: () => sessionId,
  };

  // Register the single unified View resource (all app tools share this one UI)
  registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

  // Register all MCP features
  registerPrompts(server);
  for (const register of TOOL_REGISTRARS) register(ctx);

  return server;
}

/**
 * Stateless MCP API handler.
 *
 * The MCP session id is carried by the client in the `Mcp-Session-Id` header
 * after the server issues it on `initialize`. Because each request spins up a
 * fresh `WorkerTransport`, we hand the transport a `storage` shim that rebuilds
 * the minimal `TransportState` from that header — restoring `initialized`/
 * `sessionId` so non-initialize requests validate, with no server-side state.
 * The session id only namespaces the authenticated user's KV data (the user id
 * comes from OAuth, not the header), so a client-supplied id is safe.
 */
const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const headerSessionId = request.headers.get("mcp-session-id") ?? undefined;
    const sessionId = headerSessionId ?? crypto.randomUUID();

    const handler = createMcpHandler(buildServer(env, sessionId), {
      route: "/mcp",
      sessionIdGenerator: () => sessionId,
      storage: {
        get: () =>
          headerSessionId ? { sessionId: headerSessionId, initialized: true } : undefined,
        set: () => {},
      },
    });

    return handler(request, env, ctx);
  },
};

/**
 * Retained only to satisfy the `MCP_OBJECT` Durable Object binding. `/mcp` now
 * routes through `mcpApiHandler` (stateless `createMcpHandler`), so this agent
 * is never addressed. Removing it requires a `deleted_classes` migration that
 * drops the live DO's stored data, which is deferred to a dedicated infra PR so
 * the deletion can be validated against the deployed Worker.
 */
export class MyMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer(SERVER_INFO, SERVER_OPTIONS);

  async init() {}
}

class UserInfoHandler extends WorkerEntrypoint<Env, Props> {
  fetch() {
    return Response.json({
      sub: this.ctx.props.id,
      id: this.ctx.props.id,
    });
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": mcpApiHandler,
    "/userinfo": UserInfoHandler,
  },
  // biome-ignore lint/suspicious/noExplicitAny: Hono app type incompatible with OAuthProvider's ExportedHandler type
  defaultHandler: KrogerHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  allowPlainPKCE: false,
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["profile.compact", "cart.basic:write", "product.compact"],

  // Syncs Kroger tokens with MCP token lifecycle using accessTokenProps/newProps separation:
  // - accessTokenProps: only what middleware needs (id, accessToken, tokenExpiresAt)
  // - newProps: full grant including Kroger refresh token + credentials (stays server-side)
  // CRITICAL: Kroger single-use refresh tokens — only refreshed here to persist to grant.
  tokenExchangeCallback: async ({ grantType, props }) => {
    // Destructure grant-only fields; rest is exactly the access token props (Props type)
    const { refreshToken, krogerClientId, krogerClientSecret, ...accessTokenProps } =
      props as GrantProps;

    if (grantType === GrantType.AUTHORIZATION_CODE) {
      const ttl = accessTokenProps.tokenExpiresAt
        ? Math.max(Math.floor((accessTokenProps.tokenExpiresAt - Date.now()) / 1000), 60)
        : 1800;
      return { accessTokenProps, accessTokenTTL: ttl };
    }

    if (grantType !== GrantType.REFRESH_TOKEN) return {};

    if (!refreshToken || !krogerClientId || !krogerClientSecret) {
      return { accessTokenTTL: 1 }; // Force re-auth
    }

    if (!isKrogerTokenExpiring(accessTokenProps.tokenExpiresAt)) {
      return { accessTokenProps };
    }

    return (
      await refreshKrogerToken(refreshToken, krogerClientId, krogerClientSecret).orTee((error) =>
        console.error("Kroger token refresh failed:", error.message),
      )
    ).match(
      (result) => {
        if (!result.refreshToken) {
          console.error("Kroger refresh missing new refresh token (single-use). Re-auth required.");
          return { accessTokenTTL: 1 };
        }

        return {
          accessTokenProps: {
            ...accessTokenProps,
            accessToken: result.accessToken,
            tokenExpiresAt: result.tokenExpiresAt,
          },
          newProps: {
            ...accessTokenProps,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            tokenExpiresAt: result.tokenExpiresAt,
            krogerClientId,
            krogerClientSecret,
          },
          accessTokenTTL: result.expiresIn,
        };
      },
      () => ({ accessTokenTTL: 1 }),
    );
  },
});
