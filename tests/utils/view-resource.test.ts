import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../../src/tools/types.js";

import {
  APP_VIEW_URI,
  RESOURCE_MIME_TYPE,
  registerViewResource,
} from "../../src/utils/view-resource.js";

// Hoisted so the value is accessible inside the vi.mock factory (which gets hoisted above imports)
const { EXPECTED_MIME_TYPE } = vi.hoisted(() => ({
  EXPECTED_MIME_TYPE: "text/html;profile=mcp-app",
}));

// Type for the captured resource read callback (matches McpUiReadResourceCallback minus unused params)
type ResourceReadCallback = () => Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}>;

type CapturedResource = {
  server: Pick<McpServer, "registerResource">;
  name: string;
  uri: string;
  config: { mimeType?: string };
  callback: ResourceReadCallback;
};

const testState = vi.hoisted(() => ({
  capturedResources: [] as CapturedResource[],
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  RESOURCE_MIME_TYPE: EXPECTED_MIME_TYPE,
  registerAppResource: (
    server: Pick<McpServer, "registerResource">,
    name: string,
    uri: string,
    config: { mimeType?: string },
    callback: ResourceReadCallback,
  ) => {
    testState.capturedResources.push({ server, name, uri, config, callback });
  },
}));

// A minimal fake Fetcher that allows controlling fetch responses in tests
type FakeFetcher = {
  fetch: (req: Request) => Promise<Response>;
};

function makeFakeEnv(assetsFetcher: FakeFetcher | null): Env {
  return {
    ASSETS: assetsFetcher as unknown as Fetcher,
  } as unknown as Env;
}

function makeFakeServer(): Pick<McpServer, "registerResource"> {
  return {} as unknown as Pick<McpServer, "registerResource">;
}

function makeContext(env: Env): ToolContext {
  return {
    server: makeFakeServer() as McpServer,
    clients: {} as ToolContext["clients"],
    productService: {
      getProduct: () => {
        throw new Error("productService not used in this test");
      },
      enrichProductName: async () => null,
    } as unknown as ToolContext["productService"],
    storage: {} as ToolContext["storage"],
    getEnv: () => env,
    getSessionId: () => "session-test",
  };
}

describe("registerViewResource", () => {
  beforeEach(() => {
    testState.capturedResources = [];
  });

  describe("resource registration", () => {
    it("passes ctx.server as the first argument to registerAppResource", () => {
      const env = makeFakeEnv(null);
      const ctx = makeContext(env);
      const server = ctx.server;

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

      expect(testState.capturedResources).toHaveLength(1);
      expect(testState.capturedResources[0]?.server).toBe(server);
    });

    it("passes resourceUri as both the name and uri arguments", () => {
      const env = makeFakeEnv(null);
      const ctx = makeContext(env);
      const resourceUri = "ui://my-test-app";

      registerViewResource(ctx, resourceUri, "test-app.html");

      const captured = testState.capturedResources[0];
      expect(captured?.name).toBe(resourceUri);
      expect(captured?.uri).toBe(resourceUri);
    });

    it("passes { mimeType: RESOURCE_MIME_TYPE } as the config argument", () => {
      const env = makeFakeEnv(null);
      const ctx = makeContext(env);

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

      const captured = testState.capturedResources[0];
      expect(captured?.config).toEqual({ mimeType: EXPECTED_MIME_TYPE });
    });

    it("exports RESOURCE_MIME_TYPE with the expected value", () => {
      expect(RESOURCE_MIME_TYPE).toBe(EXPECTED_MIME_TYPE);
    });

    it("exports APP_VIEW_URI as a non-empty URI string", () => {
      expect(APP_VIEW_URI).toBe("ui://shopping-app");
    });
  });

  describe("resource handler — happy path", () => {
    it("returns HTML text from ASSETS when fetch succeeds with an ok response", async () => {
      const htmlContent = "<html><body>Shopping App</body></html>";
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) => new Response(htmlContent, { status: 200 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const ctx = makeContext(env);

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

      const callback = testState.capturedResources[0]?.callback;
      expect(callback).toBeDefined();

      const result = await callback!();
      expect(result.contents[0]?.text).toBe(htmlContent);
    });

    it("wraps the HTML in contents[0] with the correct uri, mimeType, and text", async () => {
      const htmlContent = "<!DOCTYPE html><html></html>";
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) => new Response(htmlContent, { status: 200 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const ctx = makeContext(env);
      const resourceUri = "ui://shopping-app";

      registerViewResource(ctx, resourceUri, "mcp-app.html");

      const callback = testState.capturedResources[0]?.callback;
      const result = await callback!();

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toEqual({
        uri: resourceUri,
        mimeType: EXPECTED_MIME_TYPE,
        text: htmlContent,
      });
    });

    it("constructs the ASSETS request URL as /<filename> relative to https://assets.invalid", async () => {
      const requestedUrls: string[] = [];
      const fakeAssets: FakeFetcher = {
        fetch: async (req: Request) => {
          requestedUrls.push(req.url);
          return new Response("<html></html>", { status: 200 });
        },
      };
      const env = makeFakeEnv(fakeAssets);
      const ctx = makeContext(env);

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");
      const callback = testState.capturedResources[0]?.callback;
      await callback!();

      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0]).toBe("https://assets.invalid/mcp-app.html");
    });
  });

  describe("resource handler — error fallbacks", () => {
    it("returns ERROR_HTML fallback when env.ASSETS binding is null", async () => {
      const env = makeFakeEnv(null);
      const ctx = makeContext(env);

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

      const callback = testState.capturedResources[0]?.callback;
      const result = await callback!();

      expect(result.contents[0]?.text).toContain("Error loading view");
    });

    it("returns ERROR_HTML fallback when ASSETS.fetch() returns a non-ok HTTP response", async () => {
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) => new Response("Not Found", { status: 404 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const ctx = makeContext(env);

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

      const callback = testState.capturedResources[0]?.callback;
      const result = await callback!();

      expect(result.contents[0]?.text).toContain("Error loading view");
    });

    it("returns ERROR_HTML fallback when ASSETS.fetch() throws an error", async () => {
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) => {
          throw new Error("Network error");
        },
      };
      const env = makeFakeEnv(fakeAssets);
      const ctx = makeContext(env);

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

      const callback = testState.capturedResources[0]?.callback;
      const result = await callback!();

      expect(result.contents[0]?.text).toContain("Error loading view");
    });

    it("ERROR_HTML fallback has the correct uri and mimeType in contents[0]", async () => {
      const env = makeFakeEnv(null);
      const ctx = makeContext(env);
      const resourceUri = "ui://shopping-app";

      registerViewResource(ctx, resourceUri, "mcp-app.html");

      const callback = testState.capturedResources[0]?.callback;
      const result = await callback!();

      expect(result.contents[0]?.uri).toBe(resourceUri);
      expect(result.contents[0]?.mimeType).toBe(EXPECTED_MIME_TYPE);
    });

    it("returns ERROR_HTML fallback when ASSETS.fetch() returns a 500 server error", async () => {
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) => new Response("Internal Server Error", { status: 500 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const ctx = makeContext(env);

      registerViewResource(ctx, APP_VIEW_URI, "mcp-app.html");

      const callback = testState.capturedResources[0]?.callback;
      const result = await callback!();

      expect(result.contents[0]?.text).toContain("Error loading view");
    });
  });
});
