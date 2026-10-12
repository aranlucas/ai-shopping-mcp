import { SELF, env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import * as composition from "../src/composition.js";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  authIdentity,
  validateAccessToken,
} from "../src/services/better-auth.js";
import {
  fixtureJwks,
  fixtureToken,
  seedKrogerConnection,
} from "./better-auth-fixture.js";
import { ensureShoppingSchema } from "./d1-schema.js";

function mcpRequest(token?: string) {
  return new Request(`${env.MCP_RESOURCE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "Mcp-Method": "tools/list",
      ...(token ? { Authorization: `Bearer ${token}` } : undefined),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

async function connectClient(token: string) {
  const client = new Client(
    { name: "better-auth-integration", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );

  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${env.MCP_RESOURCE_URL}/mcp`), {
      fetch: (input, init) => SELF.fetch(new Request(input, init)),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );

  return client;
}

describe("Better Auth resource server", () => {
  beforeEach(async () => {
    await reset();
    const jwks = await fixtureJwks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(jwks)),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes the external issuer and scopes and challenges unauthenticated requests", async () => {
    const metadata = await SELF.fetch(
      `${env.MCP_RESOURCE_URL}/.well-known/oauth-protected-resource`,
    );

    expect(await metadata.json()).toMatchObject({
      resource: env.MCP_RESOURCE_URL,
      authorization_servers: [env.BETTER_AUTH_ISSUER],
      scopes_supported: ["mcp:tools"],
    });
    const response = await SELF.fetch(mcpRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "resource_metadata=",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "WWW-Authenticate",
    );
    expect(
      await (
        await SELF.fetch(
          `${env.MCP_RESOURCE_URL}/.well-known/oauth-protected-resource/mcp`,
        )
      ).json(),
    ).toEqual(
      await (
        await SELF.fetch(
          `${env.MCP_RESOURCE_URL}/.well-known/oauth-protected-resource`,
        )
      ).json(),
    );
  });

  it("allows browser preflight without requiring a token", async () => {
    const response = await SELF.fetch(
      new Request(`${env.MCP_RESOURCE_URL}/mcp`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://client.example",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization",
    );
  });

  it.each([
    "/authorize",
    "/register",
    "/token",
    "/userinfo",
    "/.well-known/oauth-authorization-server",
  ])("does not expose the old issuer route %s", async (path) => {
    expect((await SELF.fetch(`${env.MCP_RESOURCE_URL}${path}`)).status).toBe(
      404,
    );
  });

  it.each([
    { iss: "https://attacker.example" },
    { aud: "https://another-api.example" },
    { exp: Math.floor(Date.now() / 1000) - 10 },
    { sub: undefined },
    { client_id: undefined },
    { scope: undefined },
    { iat: Math.floor(Date.now() / 1000) + 300 },
    { cnf: { jkt: "unverified-proof" } },
  ])("rejects invalid JWT claims %j", async (claims) => {
    const token = await fixtureToken("user", claims);
    expect((await SELF.fetch(mcpRequest(token))).status).toBe(401);
  });

  it("rejects opaque credentials and insufficient scopes", async () => {
    expect(
      (await SELF.fetch(mcpRequest("old-user:old-grant:old-secret"))).status,
    ).toBe(401);

    const response = await SELF.fetch(
      mcpRequest(await fixtureToken("user", { scope: "openid" })),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "insufficient_scope",
    );
  });

  it("rejects a token with a modified signature", async () => {
    const token = await fixtureToken();
    const [header, payload, signature] = token.split(".");
    const tampered = `${header}.${payload}.${signature?.startsWith("A") ? "B" : "A"}${signature?.slice(1)}`;

    expect((await SELF.fetch(mcpRequest(tampered))).status).toBe(401);
  });

  it("rejects ID tokens even when their audience and scopes match the resource", async () => {
    const token = await fixtureToken("user", {}, "JWT");

    expect((await SELF.fetch(mcpRequest(token))).status).toBe(401);
  });

  it("distinguishes a signing-key service outage from invalid credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("key service unavailable");
      }),
    );

    await expect(
      validateAccessToken(
        { ...env, BETTER_AUTH_JWKS_URL: "https://unavailable.example/jwks" },
        env.MCP_RESOURCE_URL,
        await fixtureToken(),
      ),
    ).rejects.toThrow("key service unavailable");

    const response = await SELF.fetch(
      mcpRequest(await fixtureToken("user", {}, "at+jwt", "uncached-key")),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("keeps the verified subject and OAuth client separate from Kroger credentials", async () => {
    const token = await fixtureToken("subject-a", { client_id: "client-a" });

    const validated = await validateAccessToken(
      env,
      env.MCP_RESOURCE_URL,
      token,
    );

    expect(validated).toMatchObject({
      props: authIdentity(env.BETTER_AUTH_ISSUER, "subject-a"),
      clientId: "client-a",
      scope: ["mcp:tools"],
    });
    expect(JSON.stringify(validated)).not.toContain("refreshToken");
    expect(JSON.stringify(validated)).not.toContain("kroger-access-token");
  });

  it("only exposes the connection tool before Kroger is linked", async () => {
    const response = await SELF.fetch(mcpRequest(await fixtureToken()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { tools: [{ name: "connect_kroger" }] },
    });
  });

  it("passes the verified OAuth client and shopping user into the MCP context", async () => {
    await seedKrogerConnection("subject-a");
    vi.spyOn(composition, "buildServer").mockImplementation((_env, context) => {
      const server = new McpServer({
        name: "auth-context-probe",
        version: "1",
      });

      server.registerTool("probe", {}, async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              userId: getMcpAuthContext()?.props.id,
              clientId: context.authInfo?.clientId,
            }),
          },
        ],
      }));

      return server;
    });

    const client = await connectClient(
      await fixtureToken("subject-a", { client_id: "client-a" }),
    );

    try {
      expect(
        await client.callTool({ name: "probe", arguments: {} }),
      ).toMatchObject({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              userId: authIdentity(env.BETTER_AUTH_ISSUER, "subject-a").id,
              clientId: "client-a",
            }),
          },
        ],
      });
    } finally {
      await client.close();
    }
  });

  it("serves shopping over a real MCP client after linking and isolates auth subjects", async () => {
    await ensureShoppingSchema();
    await seedKrogerConnection("subject-a");
    const token = await fixtureToken("subject-a");

    const client = await connectClient(token);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("get_shopping_profile");
    expect(
      (await client.callTool({ name: "get_shopping_profile", arguments: {} }))
        .isError,
    ).toBeFalsy();
    await client.close();
    const other = await SELF.fetch(mcpRequest(await fixtureToken("subject-b")));
    expect(await other.json()).toMatchObject({
      result: { tools: [{ name: "connect_kroger" }] },
    });
    expect(
      await exports.KrogerConnections.getByName(
        authIdentity(env.BETTER_AUTH_ISSUER, "subject-b").id,
      ).getToken(),
    ).toEqual({ status: "not_connected" });
  });
});
