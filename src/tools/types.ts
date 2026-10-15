// Request-local identity and Kroger credentials, resolved server-side after JWT validation.
export type Props = {
  id: string;
  accessToken: string;
  tokenExpiresAt: number;
};

// --- Response helpers ---

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
