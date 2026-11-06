import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer, RegisteredResource } from "@modelcontextprotocol/server";

export const APP_VIEW_URI = "ui://shopping-app";

const ERROR_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/></head>
<body><div style="text-align:center;padding:32px;color:#9ca3af">
Error loading view</div></body></html>`;

async function loadViewHtml(env: Env, htmlPath: string): Promise<string> {
  try {
    const assets = env.ASSETS;

    if (!assets) {
      throw new Error("ASSETS binding not available");
    }

    const url = new URL(htmlPath, "https://assets.invalid");
    const response = await assets.fetch(new Request(url.toString()));

    if (!response.ok) {
      throw new Error(`Failed to fetch view HTML: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error(`Failed to load view ${htmlPath}:`, error);

    return ERROR_HTML;
  }
}

/**
 * Register an MCP Apps resource that serves a Vite-built View HTML file.
 *
 * The HTML is loaded from the ASSETS binding at request time (not at
 * registration time), so the Env is resolved lazily via getEnv().
 */
export function registerViewResource(
  server: McpServer,
  getEnv: () => Env,
  resourceUri: string,
  filename: string,
): RegisteredResource {
  return registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await loadViewHtml(getEnv(), `/${filename}`);

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  resourceDomains: ["https://www.kroger.com"],
                },
              },
            },
          },
        ],
      };
    },
  );
}
