import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SELF, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLIENT_REDIRECT_URI = "https://client.example/callback";
const MCP_BASE_URL = "https://example.com";
const MCP_URL = `${MCP_BASE_URL}/mcp`;
const SCOPES = "profile.compact cart.basic:write product.compact";

type RegisteredClient = {
  client_id: string;
  client_secret: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
};

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

function cookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`Missing ${name} cookie`);
  return match[1];
}

function hiddenInputValue(html: string, name: string): string {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  if (!match) throw new Error(`Missing ${name} input`);
  return match[1];
}

function fetchThroughSelf(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  return SELF.fetch(request);
}

async function registerClient(): Promise<RegisteredClient> {
  const response = await SELF.fetch(
    new Request(`${MCP_BASE_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [CLIENT_REDIRECT_URI],
        client_name: "Vitest MCP client",
        token_endpoint_auth_method: "client_secret_basic",
      }),
    }),
  );

  expect(response.status).toBe(201);
  return (await response.json()) as RegisteredClient;
}

async function authorizeClient(client: RegisteredClient): Promise<{
  authorizationCode: string;
  codeVerifier: string;
}> {
  const codeVerifier = "vitest-code-verifier-with-enough-entropy";
  const authUrl = new URL(`${MCP_BASE_URL}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", CLIENT_REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", "client-state");
  authUrl.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
  authUrl.searchParams.set("code_challenge_method", "S256");

  const approvalResponse = await SELF.fetch(new Request(authUrl, { redirect: "manual" }));

  expect(approvalResponse.status).toBe(200);
  const approvalHtml = await approvalResponse.text();
  const approvalState = hiddenInputValue(approvalHtml, "state");
  const csrfToken = hiddenInputValue(approvalHtml, "csrf_token");
  const csrfCookie = cookieValue(
    approvalResponse.headers.get("Set-Cookie") ?? "",
    "__Host-CSRF_TOKEN",
  );

  const authorizeResponse = await SELF.fetch(
    new Request(`${MCP_BASE_URL}/authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `__Host-CSRF_TOKEN=${csrfCookie}`,
      },
      body: new URLSearchParams({
        state: approvalState,
        csrf_token: csrfToken,
      }),
      redirect: "manual",
    }),
  );

  expect(authorizeResponse.status).toBe(302);
  const krogerRedirect = new URL(authorizeResponse.headers.get("Location") ?? "");
  const krogerState = krogerRedirect.searchParams.get("state");
  expect(krogerState).toBeTruthy();

  const oauthCookie = cookieValue(
    authorizeResponse.headers.get("Set-Cookie") ?? "",
    "kroger_oauth_state",
  );

  const callbackResponse = await SELF.fetch(
    new Request(`${MCP_BASE_URL}/callback?code=kroger-code&state=${krogerState}`, {
      headers: { Cookie: `kroger_oauth_state=${oauthCookie}` },
      redirect: "manual",
    }),
  );

  expect(callbackResponse.status).toBe(302);
  const clientRedirect = new URL(callbackResponse.headers.get("Location") ?? "");
  expect(clientRedirect.origin + clientRedirect.pathname).toBe(CLIENT_REDIRECT_URI);

  const authorizationCode = clientRedirect.searchParams.get("code");
  expect(authorizationCode).toBeTruthy();
  return { authorizationCode: authorizationCode as string, codeVerifier };
}

async function exchangeCodeForToken(
  client: RegisteredClient,
  authorizationCode: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const response = await SELF.fetch(
    new Request(`${MCP_BASE_URL}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: CLIENT_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    }),
  );

  expect(response.status).toBe(200);
  return (await response.json()) as TokenResponse;
}

async function createAuthorizedMcpClient(accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: fetchThroughSelf,
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  const client = new Client({ name: "vitest-client", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

describe("MCP client over Worker OAuth integration", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());

        if (url.href === "https://api.kroger.com/v1/connect/oauth2/token") {
          return Response.json({
            access_token: "kroger-access-token",
            refresh_token: "kroger-refresh-token",
            expires_in: 1800,
          });
        }

        if (url.href === "https://api.kroger.com/v1/identity/profile") {
          return Response.json({ data: { id: "real-oauth-user" } });
        }

        if (url.href.startsWith("https://api.kroger.com/v1/products")) {
          return Response.json({
            data: [
              {
                upc: "0000000000001",
                description: "Whole Milk",
                brand: "Kroger",
                items: [
                  {
                    itemId: "0000000000001",
                    size: "1 gal",
                    price: { regular: 3.99 },
                    fulfillment: {
                      curbside: true,
                      delivery: true,
                      instore: true,
                      shiptohome: false,
                    },
                    inventory: { stockLevel: "IN_STOCK" },
                  },
                ],
              },
            ],
          });
        }

        throw new Error(`Unexpected external fetch: ${url.href}`);
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await reset();
  });

  it("authorizes through OAuth and calls app tools through the MCP client", async () => {
    const registeredClient = await registerClient();
    const { authorizationCode, codeVerifier } = await authorizeClient(registeredClient);
    const token = await exchangeCodeForToken(registeredClient, authorizationCode, codeVerifier);
    const client = await createAuthorizedMcpClient(token.access_token);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    expect(toolNames).toContain("search_products");
    expect(toolNames).toContain("get_meal_planning_context");
    for (const tool of tools.tools) {
      if (
        tool.name === "get_meal_planning_context" ||
        tool.name === "get_shopping_profile" ||
        tool.name === "view_cart"
      ) {
        expect(tool._meta?.ui).toBeUndefined();
      } else {
        expect(tool._meta?.ui).toBeDefined();
      }
    }
    expect(client.getInstructions()).toContain("create_shopping_list");
    expect(client.getInstructions()).toContain("add_shopping_list_to_cart");
    expect(client.getInstructions()).toContain("listId");
    expect(client.getInstructions()).toContain("get_shopping_profile");
    expect(client.getInstructions()).not.toContain(
      "pantry, equipment, shopping list, preferred location",
    );
    expect(client.getInstructions()).not.toContain("add_to_cart");

    const result = await client.callTool({
      name: "search_products",
      arguments: { terms: ["milk"], storeId: "70500847" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      totalProducts: 1,
    });
  });

  // Regression: exercises the auth-props path (`getProps()`) through the real
  // MCP handler. Tool calls that omit storeId and resource reads both call
  // `getProps()`, which reads `getMcpAuthContext()`. That context is only
  // populated by `createMcpHandler` — under the old `McpAgent.serve()` wiring it
  // was empty, so these threw "getProps() called outside an authenticated MCP
  // request". The earlier test always passed an explicit storeId, so it never
  // hit this path and the bug shipped.
  it("resolves auth props for tool calls and resource reads (getProps path)", async () => {
    const registeredClient = await registerClient();
    const { authorizationCode, codeVerifier } = await authorizeClient(registeredClient);
    const token = await exchangeCodeForToken(registeredClient, authorizationCode, codeVerifier);
    const client = await createAuthorizedMcpClient(token.access_token);

    // No storeId → handler falls back to getProps().id to resolve the
    // preferred location. This must not throw an auth error.
    const toolResult = await client.callTool({
      name: "search_products",
      arguments: { terms: ["milk"] },
    });

    expect(toolResult.isError).toBeFalsy();
    expect(toolResult.structuredContent).toMatchObject({
      totalProducts: 1,
    });

    // Resource reads call getProps() to scope the user's stored data.
    const resourceResult = await client.readResource({
      uri: "shopping://user/pantry",
    });

    expect(resourceResult.contents).toBeDefined();
    expect(resourceResult.contents.length).toBeGreaterThan(0);
    const pantryText = resourceResult.contents
      .map((entry) => ("text" in entry && typeof entry.text === "string" ? entry.text : ""))
      .join("");
    expect(pantryText).not.toContain("outside an authenticated MCP request");
  });
});
