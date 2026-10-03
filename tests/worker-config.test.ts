import { describe, expect, it } from "vitest";

import cloudflareConfig from "../cloudflare.config.ts?raw";
import serverSource from "../src/server.ts?raw";

describe("Worker configuration", () => {
  it("does not expose the retired MyMCP Durable Object database binding", () => {
    expect(cloudflareConfig).toContain(
      'CartOperations: exports.durableObject({ storage: "sqlite" })',
    );
    expect(cloudflareConfig).toContain(
      'MyMCP: exports.durableObject({ state: "deleted" })',
    );
    expect(cloudflareConfig).not.toContain("MCP_OBJECT");
    expect(serverSource).not.toContain("class MyMCP");
  });

  it("runs daily OAuth KV cleanup without changing Worker bindings", () => {
    expect(cloudflareConfig).toContain('schedule: "0 2 * * *"');
    expect(serverSource).toContain("oauthProvider.purgeExpiredData");
  });

  it("binds the Worker-owned D1 shopping database", () => {
    expect(cloudflareConfig).toContain("SHOPPING_DB: bindings.d1(");
    expect(serverSource).not.toContain("createGatewayClient");
    expect(cloudflareConfig).not.toContain("GATEWAY_URL");
  });
});
