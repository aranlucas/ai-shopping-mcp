import { type AppError, formatAppError, errorRecovery } from "../errors.js";

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
