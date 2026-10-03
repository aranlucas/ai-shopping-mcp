import {
  selectProductMatches,
  type SelectorAi,
} from "./fixtures/jev-product-selector.js";

type DiagnosticCall = { elapsedMs: number; status: number; response: unknown };

type DiagnosticError = {
  error: string;
  calls?: DiagnosticCall[];
  elapsedMs?: number;
};

/** Ephemeral local test worker: only the AI binding connects to Cloudflare. */
export default {
  async fetch(request: Request, env: { AI: SelectorAi }): Promise<Response> {
    const diagnostic = new URL(request.url).searchParams.has("diagnostics");

    const calls: DiagnosticCall[] = [];

    const started = Date.now();

    const ai: SelectorAi = diagnostic
      ? {
          gateway: (id) => ({
            async run(input, options) {
              const callStarted = Date.now();
              const response = await env.AI.gateway(id).run(input, options);
              calls.push({
                elapsedMs: Date.now() - callStarted,
                status: response.status,
                response: await response.clone().json(),
              });

              return response;
            },
          }),
        }
      : env.AI;

    try {
      const input =
        await request.json<
          Omit<Parameters<typeof selectProductMatches>[0], "ai">
        >();

      const selections = await selectProductMatches({ ...input, ai });

      return Response.json(
        diagnostic
          ? { selections, calls, elapsedMs: Date.now() - started }
          : selections,
      );
    } catch (error) {
      const body: DiagnosticError = {
        error: error instanceof Error ? error.message : String(error),
      };

      if (diagnostic) {
        body.calls = calls;
        body.elapsedMs = Date.now() - started;
      }

      return Response.json(body, { status: 500 });
    }
  },
};
