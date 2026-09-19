import { err, ok } from "neverthrow";
import { type AppError, errorRecovery, validationError } from "../errors.js";
import type { ProductSearchResult } from "./catalog/kroger-search.js";
import type { ProductSelection } from "./product-selector.js";

export type RequestedItem = {
  requestId: string;
  name: string;
  quantity: number;
};
export type ShoppingItemOutcome =
  | {
      kind: "matched";
      request: RequestedItem;
      product: Extract<ProductSelection, { status: "selected" }>["product"];
    }
  | { kind: "not_found"; request: RequestedItem }
  | { kind: "needs_review"; request: RequestedItem }
  | { kind: "failed"; request: RequestedItem; error: AppError };

/** Interpret search and selection together once, preserving failure provenance. */
export function classifyShoppingItem(
  request: RequestedItem,
  search: ProductSearchResult,
  selection: ProductSelection | undefined,
): ShoppingItemOutcome {
  if (search.requestId !== request.requestId)
    throw new Error(
      `Search result ${search.requestId} does not match request ${request.requestId}`,
    );
  if (search.status === "failed")
    return {
      kind: "failed",
      request,
      error: search.error,
    };
  if (
    selection?.status === "selected" &&
    selection.requestId === request.requestId
  )
    return { kind: "matched", request, product: selection.product };
  return {
    kind: search.products.length > 0 ? "needs_review" : "not_found",
    request,
  };
}

/** Both the saved list and the response consume this classification. */
export function summarizeShoppingOutcomes(outcomes: ShoppingItemOutcome[]) {
  const matched = outcomes.filter((outcome) => outcome.kind === "matched");
  const missing = outcomes
    .filter((outcome) => outcome.kind === "not_found")
    .map((outcome) => outcome.request.name);
  const review = outcomes
    .filter((outcome) => outcome.kind === "needs_review")
    .map((outcome) => outcome.request.name);
  const failed = outcomes.filter((outcome) => outcome.kind === "failed");
  if (matched.length === 0)
    return err(
      failed[0]?.error ??
        validationError(
          review.length > 0
            ? `No suitable match for: ${[...missing, ...review].join(", ")}. Review alternatives with search_products.`
            : `No products found for: ${missing.join(", ")}. Try different search terms with search_products.`,
        ),
    );
  const sections = [
    {
      count: missing.length,
      lines: [`No results for: ${missing.join(", ")}.`],
    },
    {
      count: failed.length,
      lines: [
        "Some searches failed; these items were not added:",
        ...failed.map(
          ({ request, error }) =>
            `- ${request.name}: ${error.type}: ${error.message} (recovery: ${errorRecovery(error)})`,
        ),
      ],
    },
    {
      count: review.length,
      lines: [
        `No suitable match for: ${review.join(", ")}. Review alternatives with search_products.`,
      ],
    },
  ];
  return ok({
    matched,
    warnings: sections.flatMap((section) =>
      section.count > 0 ? [""].concat(section.lines) : [],
    ),
  });
}
