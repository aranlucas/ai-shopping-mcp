import { SELF, env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

async function register(redirectUris: string[]): Promise<Response> {
  return SELF.fetch(
    new Request(`${env.MCP_RESOURCE_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "MCP redirect policy test",
        redirect_uris: redirectUris,
        token_endpoint_auth_method: "none",
      }),
    }),
  );
}

describe("OAuth redirect policy", () => {
  beforeEach(async () => {
    await reset();
  });

  it.each([
    ["https://client.example/callback"],
    ["http://127.0.0.1:49152/callback"],
    ["claude://oauth/callback"],
    [
      "cursor://anysphere.cursor-mcp/oauth/callback",
      "http://127.0.0.1:49152/callback",
    ],
  ])("registers supported MCP callbacks: %j", async (...redirectUris) => {
    const response = await register(redirectUris);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      redirect_uris: redirectUris,
    });
  });

  it.each([
    "http://remote.example/callback",
    "javascript:alert(1)",
    "https://client.example/callback#fragment",
    "https://user:password@client.example/callback",
  ])("rejects unsafe MCP callbacks: %s", async (redirectUri) => {
    const response = await register([redirectUri]);
    expect(response.status).toBe(400);
  });
});
