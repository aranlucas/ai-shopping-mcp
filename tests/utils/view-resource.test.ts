import type { McpUiReadResourceCallback } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_VIEW_URI,
  registerViewResource,
} from "../../src/utils/view-resource.js";

const EXPECTED_MIME_TYPE = "text/html;profile=mcp-app";

type CapturedResource = {
  name: string;
  uri: string;
  config: { mimeType?: string };
  callback: McpUiReadResourceCallback;
};

const testState = vi.hoisted(() => ({
  capturedResources: [] as CapturedResource[],
}));

function makeFakeServer(): McpServer {
  return {
    registerResource: (
      name: string,
      uri: string,
      config: { mimeType?: string },
      callback: McpUiReadResourceCallback,
    ) => {
      testState.capturedResources.push({ name, uri, config, callback });
      return {};
    },
  } as unknown as McpServer;
}

// A minimal fake Fetcher that allows controlling fetch responses in tests
type FakeFetcher = {
  fetch: (req: Request) => Promise<Response>;
};

function makeFakeEnv(assetsFetcher: FakeFetcher | null): Env {
  return {
    ASSETS: assetsFetcher as unknown as Fetcher,
  } as unknown as Env;
}

function readCapturedResource() {
  const resource = testState.capturedResources[0];
  if (!resource) throw new Error("view resource callback was not captured");
  return resource.callback(
    new URL(resource.uri),
    {} as Parameters<McpUiReadResourceCallback>[1],
  );
}

describe("registerViewResource", () => {
  beforeEach(() => {
    testState.capturedResources = [];
  });

  describe("resource registration", () => {
    it("registers the resource on the server", () => {
      const env = makeFakeEnv(null);
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

      expect(testState.capturedResources).toHaveLength(1);
    });

    it("passes resourceUri as both the name and uri arguments", () => {
      const env = makeFakeEnv(null);
      const server = makeFakeServer();
      const resourceUri = "ui://my-test-app";

      registerViewResource(server, () => env, resourceUri, "test-app.html");

      const captured = testState.capturedResources[0];
      expect(captured?.name).toBe(resourceUri);
      expect(captured?.uri).toBe(resourceUri);
    });

    it("passes { mimeType: RESOURCE_MIME_TYPE } as the config argument", () => {
      const env = makeFakeEnv(null);
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

      const captured = testState.capturedResources[0];
      expect(captured?.config).toEqual({ mimeType: EXPECTED_MIME_TYPE });
    });

    it("exports APP_VIEW_URI as a non-empty URI string", () => {
      expect(APP_VIEW_URI).toBe("ui://shopping-app");
    });
  });

  describe("resource handler — happy path", () => {
    it("returns HTML text from ASSETS when fetch succeeds with an ok response", async () => {
      const htmlContent = "<html><body>Shopping App</body></html>";
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) =>
          new Response(htmlContent, { status: 200 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

      const result = await readCapturedResource();
      expect(result.contents[0]).toMatchObject({ text: htmlContent });
    });

    it("wraps the HTML in contents[0] with the correct uri, mimeType, and text", async () => {
      const htmlContent = "<!DOCTYPE html><html></html>";
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) =>
          new Response(htmlContent, { status: 200 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const server = makeFakeServer();
      const resourceUri = "ui://shopping-app";

      registerViewResource(server, () => env, resourceUri, "mcp-app.html");

      const result = await readCapturedResource();

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toEqual({
        uri: resourceUri,
        mimeType: EXPECTED_MIME_TYPE,
        text: htmlContent,
        _meta: {
          ui: { csp: { resourceDomains: ["https://www.kroger.com"] } },
        },
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
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");
      await readCapturedResource();

      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0]).toBe("https://assets.invalid/mcp-app.html");
    });
  });

  describe("resource handler — error fallbacks", () => {
    it("returns ERROR_HTML fallback when env.ASSETS binding is null", async () => {
      const env = makeFakeEnv(null);
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

      const result = await readCapturedResource();

      expect(result.contents[0]).toHaveProperty(
        "text",
        expect.stringContaining("Error loading view"),
      );
    });

    it("returns ERROR_HTML fallback when ASSETS.fetch() returns a non-ok HTTP response", async () => {
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) =>
          new Response("Not Found", { status: 404 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

      const result = await readCapturedResource();

      expect(result.contents[0]).toHaveProperty(
        "text",
        expect.stringContaining("Error loading view"),
      );
    });

    it("returns ERROR_HTML fallback when ASSETS.fetch() throws an error", async () => {
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) => {
          throw new Error("Network error");
        },
      };
      const env = makeFakeEnv(fakeAssets);
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

      const result = await readCapturedResource();

      expect(result.contents[0]).toHaveProperty(
        "text",
        expect.stringContaining("Error loading view"),
      );
    });

    it("ERROR_HTML fallback has the correct uri and mimeType in contents[0]", async () => {
      const env = makeFakeEnv(null);
      const server = makeFakeServer();
      const resourceUri = "ui://shopping-app";

      registerViewResource(server, () => env, resourceUri, "mcp-app.html");

      const result = await readCapturedResource();

      expect(result.contents[0]?.uri).toBe(resourceUri);
      expect(result.contents[0]?.mimeType).toBe(EXPECTED_MIME_TYPE);
    });

    it("returns ERROR_HTML fallback when ASSETS.fetch() returns a 500 server error", async () => {
      const fakeAssets: FakeFetcher = {
        fetch: async (_req: Request) =>
          new Response("Internal Server Error", { status: 500 }),
      };
      const env = makeFakeEnv(fakeAssets);
      const server = makeFakeServer();

      registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

      const result = await readCapturedResource();

      expect(result.contents[0]).toHaveProperty(
        "text",
        expect.stringContaining("Error loading view"),
      );
    });
  });
});
