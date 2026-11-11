import * as Sentry from "@sentry/cloudflare";

import { type AppError, errorDiagnostics, formatAppError, errorRecovery } from "../errors.js";

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
  structuredContent?: {
    error: {
      code: AppError["type"];
      message: string;
      recovery: ReturnType<typeof errorRecovery>;
    };
  };
};

export function toMcpError(error: AppError): McpToolResult {
  const diagnostics = errorDiagnostics(error);

  if (diagnostics !== undefined) {
    console.error(`${error.type}: ${error.message}`, diagnostics);
    Sentry.captureException(diagnostics instanceof Error ? diagnostics : new Error(error.message), {
      tags: { errorType: error.type },
      extra: diagnostics instanceof Error ? undefined : { diagnostics },
    });
  }

  return {
    content: [{ type: "text" as const, text: formatAppError(error) }],
    isError: true as const,
    structuredContent: {
      error: {
        code: error.type,
        message: error.message,
        recovery: errorRecovery(error),
      },
    },
  };
}
