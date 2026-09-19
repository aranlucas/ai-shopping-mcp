import type { SelectorAi } from "../src/services/product-selector.js";

export type JevRun = ReturnType<SelectorAi["gateway"]>["run"];

/** Deterministic inference fixture; production selection/validation still runs. */
export function stubJevAi(preferredName?: string): SelectorAi {
  return {
    gateway() {
      return {
        async run({ query: input }) {
          const questions = input.questions as {
            [id: string]: {
              criteria: Record<string, { name?: string } | string>;
            };
          };
          return Response.json({
            model: "jev-test-fixture",
            answers: Object.fromEntries(
              Object.entries(questions).map(([id, question]) => {
                const criteria = question.criteria;
                const choice =
                  Object.keys(criteria).find((key) => {
                    const candidate = criteria[key];
                    return (
                      typeof candidate === "object" &&
                      candidate.name === preferredName
                    );
                  }) ?? "candidate_0";
                return [
                  id,
                  {
                    type: "choice",
                    choice,
                    confidence: 1,
                    probabilities: Object.fromEntries(
                      Object.keys(criteria).map((key) => [
                        key,
                        key === choice ? 1 : 0,
                      ]),
                    ),
                  },
                ];
              }),
            ),
          });
        },
      };
    },
  };
}
