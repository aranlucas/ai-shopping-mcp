import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "@/server.js";

const appOrigin = new URL(env.MCP_RESOURCE_URL).origin;

const metadataPaths = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
];

describe("Worker HTTP routing", () => {
  it("serves the landing page and supports bodyless HEAD requests", async () => {
    const response = await SELF.fetch(appOrigin);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("connect your AI client to /mcp");

    const head = await SELF.fetch(appOrigin, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it.each(metadataPaths)("supports discovery, HEAD and public preflight at %s", async (path) => {
    const response = await SELF.fetch(`${appOrigin}${path}?client=browser`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toMatchObject({ resource: env.MCP_RESOURCE_URL });

    const head = await SELF.fetch(`${appOrigin}${path}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toContain("application/json");
    expect(await head.text()).toBe("");

    const preflight = await SELF.fetch(`${appOrigin}${path}`, {
      method: "OPTIONS",
      headers: { Origin: "https://discovery.example" },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET,HEAD,OPTIONS");
  });

  it.each([
    { path: "/", method: "POST", allow: "GET, HEAD" },
    ...metadataPaths.map((path) => ({ path, method: "POST", allow: "GET, HEAD, OPTIONS" })),
    ...["GET", "HEAD", "PUT", "PATCH", "DELETE"].map((method) => ({
      path: "/mcp",
      method,
      allow: "POST, OPTIONS",
    })),
  ])("returns the route's Allow header for $method $path", async ({ path, method, allow }) => {
    const response = await SELF.fetch(`${appOrigin}${path}`, {
      method,
      headers: { Host: new URL(appOrigin).host },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allow);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("preserves CORS on method rejections without challenging for authentication", async () => {
    const response = await SELF.fetch(env.MCP_RESOURCE_URL, {
      method: "GET",
      headers: { Host: new URL(appOrigin).host, Origin: "https://client.example" },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://client.example");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("WWW-Authenticate");
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it.each([
    "/mcp/",
    "/mcp/tools",
    "/mcp-other",
    "/MCP",
    "/%6dcp",
    "/mcp%2f",
    "/.well-known/oauth-protected-resource/",
    "/.well-known/oauth-protected-resource/mcp/",
    "/.well-known/oauth-protected-resource/other",
    "/.well-known/oauth-protected-resource/%6dcp",
  ])("keeps %s outside the MCP and discovery routes", async (path) => {
    await Promise.all(
      ["GET", "POST", "OPTIONS"].map(async (method) => {
        const response = await SELF.fetch(`${appOrigin}${path}`, { method });
        expect(response.status).toBe(404);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("WWW-Authenticate")).toBeNull();
      }),
    );
  });

  it("routes query strings to MCP without reading an unauthenticated body", async () => {
    const response = await SELF.fetch(`${env.MCP_RESOURCE_URL}?client=browser`, {
      method: "POST",
      headers: {
        Host: new URL(appOrigin).host,
        "Content-Type": "application/json",
        Origin: "https://client.example",
      },
      body: "invalid JSON",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://client.example");
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("uses the request's bindings for discovery and MCP host and CORS policy", async () => {
    await Promise.all(
      ["first", "second"].map(async (name) => {
        const origin = `https://${name}.example`;

        const bindings = {
          ...env,
          MCP_RESOURCE_URL: `${origin}/mcp`,
          BETTER_AUTH_ISSUER: `https://auth.${name}.example/api/auth`,
          MCP_ALLOWED_ORIGINS: JSON.stringify([`https://client.${name}.example`]),
        };

        const metadata = await app.request(metadataPaths[0], undefined, bindings);
        expect(await metadata.json()).toMatchObject({
          resource: bindings.MCP_RESOURCE_URL,
          authorization_servers: [bindings.BETTER_AUTH_ISSUER],
        });

        const preflight = await app.request(
          `${origin}/mcp`,
          {
            method: "OPTIONS",
            headers: { Host: `${name}.example`, Origin: `https://client.${name}.example` },
          },
          bindings,
        );

        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
          `https://client.${name}.example`,
        );

        const wrongHost = await app.request(
          `${origin}/mcp`,
          { method: "OPTIONS", headers: { Host: "example.com" } },
          bindings,
        );

        expect(wrongHost.status).toBe(403);
        expect(wrongHost.headers.get("Access-Control-Allow-Origin")).toBeNull();
      }),
    );
  });

  it("keeps configuration failures as service-unavailable responses", async () => {
    const response = await app.request(
      "/mcp",
      { method: "OPTIONS" },
      {
        ...env,
        MCP_ALLOWED_ORIGINS: "invalid JSON",
      },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_unavailable" });
  });
});
