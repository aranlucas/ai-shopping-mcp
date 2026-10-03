import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";

type PayloadEnvelope = Pick<CallToolResult, "structuredContent">;

/** Validate the schema's input contract without cloning it. Tests checking for
 * forbidden extra fields must observe the original payload, not a stripped copy.
 */
export function parseToolPayload<T extends z.ZodType>(
  schema: T,
  result: PayloadEnvelope,
) {
  return z
    .custom<z.input<T>>((value) => schema.safeParse(value).success)
    .parse(result.structuredContent);
}
