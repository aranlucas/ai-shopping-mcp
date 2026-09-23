// Props stored in the access token and exposed through the MCP auth context.
// Only contains what's needed for runtime API calls — no refresh credentials.
export type Props = {
  id: string;
  accessToken: string;
  tokenExpiresAt: number;
};

// Full props stored in the grant for token refresh.
// Contains Kroger credentials needed by tokenExchangeCallback to refresh upstream tokens.
export type GrantProps = Props & {
  refreshToken?: string;
  krogerClientId: string;
  krogerClientSecret: string;
};

// --- Response helpers ---

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}
