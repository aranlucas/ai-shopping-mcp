import createClient, { type Client } from "openapi-fetch";

import type { paths } from "./schema.js";

export type GatewayClient = Client<paths>;

/** Creates a request-local gateway client bound to the active Kroger subject. */
export function createGatewayClient(
  baseUrl: string,
  serviceSecret: string,
  getUserId: () => string,
): GatewayClient {
  const client = createClient<paths>({ baseUrl });
  client.use({
    onRequest({ request }) {
      request.headers.set("x-shopping-service-secret", serviceSecret);
      request.headers.set("x-shopping-user-id", getUserId());
      return request;
    },
  });
  return client;
}
