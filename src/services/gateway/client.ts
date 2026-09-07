import createClient, { type Client } from "openapi-fetch";
import { requestTimeoutMiddleware } from "../../utils/request-timeout.js";
import { fetchWithReadRetry } from "../../utils/fetch.js";

import type { paths } from "./schema.js";

export type GatewayClient = Client<paths>;

/** Creates a request-local gateway client authenticated by the active MCP grant. */
export function createGatewayClient(
  baseUrl: string,
  accessToken: string,
  signal?: AbortSignal,
): GatewayClient {
  const client = createClient<paths>({ baseUrl, fetch: fetchWithReadRetry });
  client.use(requestTimeoutMiddleware(signal));
  client.use({
    onRequest({ request }) {
      request.headers.set("authorization", `Bearer ${accessToken}`);
      return request;
    },
  });
  return client;
}
