import { describe, expect, it } from "vitest";

import serverSource from "../src/server.ts?raw";
import generatedTypes from "../worker-configuration.d.ts?raw";
import wranglerConfig from "../wrangler.jsonc?raw";

describe("Worker configuration", () => {
  it("does not expose the retired MyMCP Durable Object database binding", () => {
    expect(wranglerConfig).not.toContain('"durable_objects"');
    expect(wranglerConfig).not.toContain('"MCP_OBJECT"');
    expect(wranglerConfig).toContain('"deleted_classes": ["MyMCP"]');
    expect(serverSource).not.toContain("class MyMCP");
    expect(generatedTypes).not.toContain("MCP_OBJECT");
  });

  it("runs daily OAuth KV cleanup without changing Worker bindings", () => {
    expect(wranglerConfig).toContain('"crons": ["0 2 * * *"]');
    expect(serverSource).toContain("oauthProvider.purgeExpiredData");
  });

  it("configures secretless bearer authentication for the gateway", () => {
    expect(wranglerConfig).toContain('"GATEWAY_URL": "https://agents-gateway.up.railway.app"');
    expect(generatedTypes).toContain("GATEWAY_URL");
    expect(serverSource).toContain("createGatewayShoppingStore");
    expect(serverSource).toContain("requestBearerToken(requestContext)");
    expect(serverSource).not.toContain("SHOPPING_SERVICE_SECRET");
    expect(wranglerConfig).not.toContain("SHOPPING_SERVICE_SECRET");
  });
});
