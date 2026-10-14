import { z } from "zod/v4";

// Preserve catalog and diagnostic fields that are not used for scoring. Reports
// retain the original evidence, while fields used by these scripts are checked.
export const productSchema = z.looseObject({
  upc: z.string().optional(),
  description: z.string().optional(),
  brand: z.string().optional(),
  categories: z.array(z.string()).optional(),
  manufacturerDeclarations: z.array(z.string()).optional(),
  allergensDescription: z.string().optional(),
  nutritionInformation: z.looseObject({ ingredientStatement: z.string().optional() }).optional(),
  items: z
    .array(
      z.looseObject({
        size: z.string().optional(),
        fulfillment: z.looseObject({ curbside: z.boolean().optional() }).optional(),
        inventory: z.looseObject({ stockLevel: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

export const selectionSchema = z.discriminatedUnion("status", [
  z.looseObject({ requestId: z.string(), status: z.literal("selected"), product: productSchema }),
  z.looseObject({ requestId: z.string(), status: z.literal("unresolved") }),
]);

export const selectedActualSchema = z.looseObject({
  upc: z.string().optional(),
  name: z.string().optional(),
});

const actualSchema = z.union([selectedActualSchema, z.literal("unresolved"), z.literal("error")]);
const expectedSchema = z.union([z.array(selectedActualSchema), z.literal("unresolved")]);

export const selectorBodySchema = z.looseObject({
  selections: z.array(selectionSchema).optional(),
  calls: z
    .array(
      z.looseObject({
        elapsedMs: z.number(),
        status: z.number(),
        response: z.unknown(),
      }),
    )
    .optional(),
  elapsedMs: z.number(),
  error: z.string().optional(),
});

export const agentSelectorBodySchema = z.looseObject({
  selections: z.array(selectionSchema).optional(),
  choices: z.record(z.string(), z.string()).optional(),
  raw: z.unknown().optional(),
  elapsedMs: z.number().nullable(),
  error: z.string().optional(),
});

const selectorRowSchema = z.looseObject({
  id: z.string(),
  query: z.string(),
  category: z.string(),
  order: z.string(),
  batchIndex: z.number().int().nonnegative(),
  candidates: z.array(productSchema),
  expected: expectedSchema,
  actual: actualSchema,
  correct: z.boolean(),
  baselineCorrect: z.boolean(),
  baselineActual: actualSchema,
  note: z.string().optional(),
  choice: z.string().optional(),
  confidence: z.number().optional(),
  topProbability: z.number().optional(),
  error: z.string().optional(),
});

export const pairedReportSchema = z.looseObject({
  batches: z.array(selectorBodySchema.extend({ order: z.string(), ids: z.array(z.string()) })),
  results: z.array(selectorRowSchema),
});

/** @typedef {z.infer<typeof selectorRowSchema>} SelectorRow */
/** @typedef {z.infer<typeof selectorBodySchema> & {order: string, ids: string[]}} SelectorBatch */
/** @typedef {z.infer<typeof agentSelectorBodySchema> & {order: string, ids: string[]}} AgentSelectorBatch */
/**
 * @typedef {object} AgentSelectorRow
 * @property {string} id
 * @property {string} query
 * @property {string} order
 * @property {string} category
 * @property {number} batchIndex
 * @property {z.infer<typeof expectedSchema>} expected
 * @property {z.infer<typeof actualSchema>} actual
 * @property {boolean} correct
 * @property {boolean} jevCorrect
 * @property {z.infer<typeof actualSchema>} jevActual
 * @property {string | undefined} choice
 * @property {string | undefined} error
 */

const answerResponseSchema = z.looseObject({
  answers: z.record(
    z.string(),
    z.object({
      choice: z.string(),
      confidence: z.number(),
      probabilities: z.record(z.string(), z.number()),
    }),
  ),
});

// Error responses can have any JSON shape; absent or invalid optional telemetry
// is not a selection and contributes no usage to the summary.
const usageResponseSchema = z.looseObject({
  usage: z
    .looseObject({
      cost: z.number().nullish(),
      input_tokens: z.number().nullish(),
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
    })
    .optional(),
});

/** @param {unknown} response */
export function responseUsage(response) {
  const parsed = usageResponseSchema.safeParse(response);
  return parsed.success ? parsed.data.usage : undefined;
}

/** @param {unknown} response */
export function responseAnswers(response) {
  const parsed = answerResponseSchema.safeParse(response);
  return parsed.success ? parsed.data.answers : undefined;
}

const scoreSchema = z.object({
  score: z.number().nullish(),
  metadata: z
    .object({
      split: z.string().nullish(),
      rationale: z.string().nullish(),
      feedback: z.string().nullish(),
      toolErrors: z.number().nullish(),
    })
    .nullish(),
});

export const agentReportSchema = z.object({
  testResults: z.array(
    z.object({
      assertionResults: z.array(
        z.object({
          ancestorTitles: z.array(z.string()),
          title: z.string(),
          status: z.string(),
          failureMessages: z.array(z.string()),
          meta: z
            .object({
              eval: z.object({ scores: z.array(scoreSchema) }).nullish(),
              harness: z
                .object({
                  run: z
                    .object({
                      usage: z
                        .object({
                          toolCalls: z.number().nullish(),
                          totalTokens: z.number().nullish(),
                        })
                        .nullish(),
                    })
                    .nullish(),
                })
                .nullish(),
            })
            .nullish(),
        }),
      ),
    }),
  ),
});

export const codexTurnSchema = z.looseObject({
  taskId: z.string(),
  split: z.string(),
  observation: z.union([
    z.looseObject({ system: z.string(), prompt: z.string(), tools: z.array(z.unknown()) }),
    z.looseObject({ name: z.string(), text: z.string(), isError: z.boolean() }),
  ]),
});

export const codexActionSchema = z.object({
  id: z.string(),
  action: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("tool"),
      name: z.string().min(1),
      arguments: z.record(z.string(), z.json()),
    }),
    z.strictObject({ type: z.literal("finish"), answer: z.string(), feedback: z.string() }),
  ]),
});
