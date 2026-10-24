import { z } from "zod/v4";
import type { AppEnv } from "../env.js";
import type { KrogerTokenInfo } from "./kroger/client.js";

const tokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number().finite().positive(),
});

/** Auth's per-user broker owns refresh coordination; shopping keeps no credentials. */
export async function krogerToken(
  env: Pick<AppEnv, "AUTH">,
  userId: string,
): Promise<KrogerTokenInfo | null> {
  z.string().min(1).max(256).parse(userId);

  const result = await env.AUTH.accessToken(userId);

  if (result === null) {
    return null;
  }

  const token = tokenSchema.parse(result);

  if (token.expiresAt <= Date.now()) {
    throw new Error("Auth returned an expired Kroger token");
  }

  return { accessToken: token.accessToken, tokenExpiresAt: token.expiresAt };
}
