/** Public RPC contract of the Auth Worker's named KrogerTokens entrypoint. */
export interface KrogerTokens extends Rpc.WorkerEntrypointBranded {
  accessToken(
    userId: string,
  ): Promise<{ accessToken: string; expiresAt: number } | null>;
}
