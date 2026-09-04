import createClient, { type Client } from "openapi-fetch";

import type { paths } from "./schema.js";

export type GatewayClient = Client<paths>;

/** Creates a request-local gateway client authenticated by the active MCP grant. */
export function createGatewayClient(baseUrl: string, accessToken: string): GatewayClient {
  const client = createClient<paths>({ baseUrl });
  client.use({
    onRequest({ request }) {
      request.headers.set("authorization", `Bearer ${accessToken}`);
      return request;
    },
  });
  return client;
}
