import type {
  Icon,
  McpServer,
  RegisteredTool,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
} from "@modelcontextprotocol/server";

const RESOURCE_URI_META_KEY = "ui/resourceUri";

type AppToolMeta = Record<string, unknown> & {
  ui?: { resourceUri?: string };
};

/**
 * MCP SDK v2-native equivalent of ext-apps' registerAppTool helper.
 * ext-apps still types its server helpers against SDK v1, while its wire
 * contract only requires mirroring the nested resource URI to the legacy
 * metadata key for older hosts.
 */
export function registerAppTool<
  OutputArgs extends StandardSchemaWithJSON,
  InputArgs extends StandardSchemaWithJSON | undefined = undefined,
>(
  server: McpServer,
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    icons?: Icon[];
    _meta?: AppToolMeta;
  },
  callback: ToolCallback<InputArgs>,
): RegisteredTool {
  const resourceUri = config._meta?.ui?.resourceUri;
  const metadata = resourceUri
    ? { ...config._meta, [RESOURCE_URI_META_KEY]: resourceUri }
    : config._meta;

  return server.registerTool(name, { ...config, _meta: metadata }, callback);
}
