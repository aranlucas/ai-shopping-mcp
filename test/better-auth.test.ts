import { SELF, env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import * as composition from "@/composition.js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { authIdentity, validateAccessToken } from "@/services/better-auth.js";
import { fixtureJwks, fixtureToken, seedKrogerConnection } from "@test/better-auth-fixture.js";
import { ensureShoppingSchema } from "@test/d1-schema.js";

const appOrigin = new URL(env.MCP_RESOURCE_URL).origin;

function mcpRequest(token?: string) {
  return new Request(env.MCP_RESOURCE_URL, {
    method: "POST",
    headers: {
      Host: new URL(env.MCP_RESOURCE_URL).host,
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
    new StreamableHTTPClientTransport(new URL(env.MCP_RESOURCE_URL), {
      fetch: (input, init) => SELF.fetch(new Request(input, init)),
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
          Host: new URL(env.MCP_RESOURCE_URL).host,
        },
      },
    }),
  );

  return client;
}

describe("Better Auth resource server", () => {
  beforeEach(async () => {
    await reset();
    await env.AUTH.fetch("https://auth-stub/reset");
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
    const metadata = await SELF.fetch(`${appOrigin}/.well-known/oauth-protected-resource`);

    expect(metadata.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");

    expect(await metadata.json()).toMatchObject({
      resource: env.MCP_RESOURCE_URL,
      authorization_servers: [env.BETTER_AUTH_ISSUER],
      scopes_supported: ["mcp:tools"],
    });
    const response = await SELF.fetch(mcpRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${appOrigin}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("WWW-Authenticate");
    expect(
      await (await SELF.fetch(`${appOrigin}/.well-known/oauth-protected-resource/mcp`)).json(),
    ).toEqual(await (await SELF.fetch(`${appOrigin}/.well-known/oauth-protected-resource`)).json());
  });

  it("allows browser preflight without requiring a token", async () => {
    const response = await SELF.fetch(
      new Request(env.MCP_RESOURCE_URL, {
        method: "OPTIONS",
        headers: {
          Host: new URL(env.MCP_RESOURCE_URL).host,
          Origin: "https://client.example",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://client.example");
  });

  it.each([
    "https://attacker.example",
    "http://client.example",
    "https://client.example:8443",
    "null",
  ])(
    "rejects untrusted browser origin %s before authentication and on preflight",
    async (origin) => {
      const responses = await Promise.all(
        ["POST", "OPTIONS"].map((method) =>
          SELF.fetch(
            new Request(env.MCP_RESOURCE_URL, {
              method,
              headers: { Origin: origin },
            }),
          ),
        ),
      );

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      }
    },
  );

  it.each([appOrigin, "https://client.example"])(
    "allows approved browser origin %s through the authenticated MCP transport",
    async (origin) => {
      await seedKrogerConnection();
      const request = mcpRequest(await fixtureToken());
      request.headers.set("Origin", origin);
      const response = await SELF.fetch(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Vary")).toContain("Origin");
    },
  );

  it("rejects host mismatches before authentication", async () => {
    const request = new Request("https://attacker.example/mcp", {
      method: "POST",
      headers: { Host: "attacker.example" },
    });

    expect((await SELF.fetch(request)).status).toBe(403);
  });

  it("rejects legacy initialization instead of accepting a compatibility session", async () => {
    await seedKrogerConnection();

    const response = await SELF.fetch(
      new Request(env.MCP_RESOURCE_URL, {
        method: "POST",
        headers: {
          Host: new URL(env.MCP_RESOURCE_URL).host,
          Authorization: `Bearer ${await fixtureToken()}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "legacy-client", version: "1" },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Mcp-Session-Id")).toBeNull();
  });

  it.each([
    "/connect/kroger",
    "/auth/callback",
    "/callback",
    "/authorize",
    "/register",
    "/token",
    "/userinfo",
    "/.well-known/oauth-authorization-server",
  ])("does not expose the old issuer route %s", async (path) => {
    expect((await SELF.fetch(`${appOrigin}${path}`)).status).toBe(404);
  });

  it.each([
    { iss: "https://attacker.example" },
    { aud: "https://another-api.example" },
    { aud: "https://example.com" },
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
    expect((await SELF.fetch(mcpRequest("old-user:old-grant:old-secret"))).status).toBe(401);

    const response = await SELF.fetch(mcpRequest(await fixtureToken("user", { scope: "openid" })));

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
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

    const validated = await validateAccessToken(env, env.MCP_RESOURCE_URL, token);

    expect(validated).toMatchObject({
      props: authIdentity(env.BETTER_AUTH_ISSUER, "subject-a"),
      clientId: "client-a",
      scope: ["mcp:tools"],
    });
    expect(JSON.stringify(validated)).not.toContain("refreshToken");
    expect(JSON.stringify(validated)).not.toContain("kroger-access-token");
  });

  it("challenges users to sign in again when Kroger is not linked", async () => {
    const response = await SELF.fetch(mcpRequest(await fixtureToken()));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });

  it("returns a service error without a re-login challenge when Auth RPC is unavailable", async () => {
    await env.AUTH.fetch("https://auth-stub/fail");
    const response = await SELF.fetch(mcpRequest(await fixtureToken()));
    expect(response.status).toBe(503);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("requires re-login after an existing Kroger link is removed", async () => {
    await seedKrogerConnection();
    const token = await fixtureToken();
    expect((await SELF.fetch(mcpRequest(token))).status).toBe(200);
    await env.AUTH.fetch("https://auth-stub/seed", {
      method: "POST",
      body: JSON.stringify({ userId: "auth-user", token: null }),
    });
    const response = await SELF.fetch(mcpRequest(token));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata");
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

    const client = await connectClient(await fixtureToken("subject-a", { client_id: "client-a" }));

    try {
      expect(await client.callTool({ name: "probe", arguments: {} })).toMatchObject({
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
      (await client.callTool({ name: "get_shopping_profile", arguments: {} })).isError,
    ).toBeFalsy();
    await client.close();
    const other = await SELF.fetch(mcpRequest(await fixtureToken("subject-b")));
    expect(other.status).toBe(401);
    expect(
      await exports.KrogerConnections.getByName(
        authIdentity(env.BETTER_AUTH_ISSUER, "subject-b").id,
      ).getToken("subject-b"),
    ).toEqual({ status: "not_connected" });
  });
});
