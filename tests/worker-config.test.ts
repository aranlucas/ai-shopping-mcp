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
});
