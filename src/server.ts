import OAuthProvider, { GrantType } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { WorkerEntrypoint } from "cloudflare:workers";

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
import { withMcpOriginProtection } from "./utils/mcp-security.js";
import { createUserStorage } from "./utils/user-storage.js";
import { APP_VIEW_URI, registerViewResource } from "./utils/view-resource.js";

function createServer(env: Env) {
  const server = new McpServer(
    { name: "kroger-ai-assistant", version: "1.0.0" },
    {
      instructions:
        "AI shopping assistant for Kroger/QFC stores. Manage shopping lists, search products, find store locations, track pantry inventory, and plan meals. Use MCP Resources to read user context (pantry, equipment, shopping list, preferred location) before making suggestions.",
    },
  );

  const storage = createUserStorage(env.USER_DATA_KV);
  const getTokenInfo = () => (getMcpAuthContext()?.props as Props | undefined) ?? null;

  const ctx: ToolContext = {
    server,
    clients: createKrogerClients(getTokenInfo),
    storage,
    getEnv: () => env,
  };

  registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");
  registerPrompts(server);
  registerCartTools(ctx);
  registerLocationTools(ctx);
  registerProductTools(ctx);
  registerPantryTools(ctx);
  registerEquipmentTools(ctx);
  registerOrderTools(ctx);
  registerRecipeTools(ctx);
  registerShoppingListTools(ctx);
  registerWeeklyDealsTools(ctx);
  registerResources(ctx);

  return server;
}

const mcpHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(createServer(env))(request, env, ctx);
  },
};

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
    "/mcp": withMcpOriginProtection(mcpHandler),
    "/userinfo": UserInfoHandler,
  },
  defaultHandler: KrogerHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  allowPlainPKCE: false,
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["profile.compact", "cart.basic:write", "product.compact"],

  tokenExchangeCallback: async ({ grantType, props }) => {
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
      return { accessTokenTTL: 1 };
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
