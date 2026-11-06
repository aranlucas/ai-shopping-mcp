import { z } from "zod/v4";
import { getMcpAuthContext } from "agents/mcp/server";
import { isVerifiedShopperId } from "./shopper-identity.js";

export type Props = { id: string; accessToken: string; tokenExpiresAt: number };

export const requestTokenSchema = z.object({
  accessToken: z.string(),
  // Token expiry is enforced by the Kroger client.
  tokenExpiresAt: z.union([z.number(), z.nan(), z.literal(Infinity), z.literal(-Infinity)]),
});

const authenticatedPropsSchema = z.object({
  props: requestTokenSchema.extend({ id: z.string().refine(isVerifiedShopperId) }),
});

// Provider-owned auth extensions are untrusted until validated here.
export function parseAuthenticatedProps(value: unknown): Props {
  const parsed = authenticatedPropsSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error("getProps() called outside an authenticated MCP request");
  }

  return parsed.data.props;
}

export function getProps(): Props {
  return parseAuthenticatedProps(getMcpAuthContext());
}
