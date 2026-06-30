import { err, fromThrowable, ok, type Result } from "neverthrow";
import * as z from "zod/v4";

export const safeJsonParse: (raw: string) => Result<unknown, SyntaxError> = fromThrowable(
  (raw: string): unknown => JSON.parse(raw),
  (error): SyntaxError =>
    error instanceof SyntaxError
      ? error
      : new SyntaxError(error instanceof Error ? error.message : String(error)),
);

export function safeJsonParseWithSchema<TSchema extends z.ZodType>(
  jsonString: string,
  schema: TSchema,
): Result<z.output<TSchema>, SyntaxError | z.ZodError> {
  return safeJsonParse(jsonString).match(
    (data) => {
      const parsedSchema = schema.safeParse(data);
      return parsedSchema.success ? ok(parsedSchema.data) : err(parsedSchema.error);
    },
    (parseError) => err(parseError),
  );
}
