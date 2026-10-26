import * as z from "zod/v4";
import { storeIdSchema, upcSchema } from "../tools/schemas.js";
import type { ShoppingListItem } from "./shopping.js";

const nameSchema = z.string().trim().min(1).max(200);
const idSchema = z.string().trim().min(1).max(200);
const keySchema = z.string().trim().min(1).max(2048);
const servingsSchema = z.number().int().min(1).max(50);
const allocationSchema = z.number().finite().nonnegative();
const choiceSchema = z.enum(["buy", "pantry", "exclude"]);
const modalitySchema = z.enum(["PICKUP", "DELIVERY"]);
const reasonSchema = z.string().trim().min(1).max(1000);

const productSchema = z.object({
  upc: upcSchema,
  productName: nameSchema,
  packages: z.number().int().min(1).max(999),
  price: z.number().finite().nonnegative().optional(),
});

export const mealSchema = z.object({
  id: idSchema,
  name: nameSchema,
  baseServings: servingsSchema,
  servings: servingsSchema,
  ingredients: z
    .array(
      z.object({
        name: nameSchema,
        quantity: z.number().finite().positive().max(1_000_000),
        unit: z.string().trim().min(1).max(80),
      }),
    )
    .max(40),
});

export type Meal = z.infer<typeof mealSchema>;

const decisionFieldsSchema = z.object({
  key: keySchema,
  requiredQuantity: z.number().finite().positive(),
  pantryQuantity: allocationSchema,
  choice: choiceSchema,
  product: productSchema.optional(),
  storeId: storeIdSchema.optional(),
  reason: reasonSchema.optional(),
});

type DecisionFields = z.infer<typeof decisionFieldsSchema>;

/** Significant digits remove floating-point noise without decimal-place rounding. */
function preciseQuantity(quantity: number): number {
  return Number(quantity.toPrecision(15));
}

function buyDecisionIssue(decision: DecisionFields): string | undefined {
  if (!decision.product) {
    return "Choose a product and an explicit package count before buying.";
  }

  if (!decision.storeId) {
    return "A buy decision must record its reviewed store.";
  }

  if (preciseQuantity(decision.pantryQuantity) >= preciseQuantity(decision.requiredQuantity)) {
    return "A buy decision must have a positive quantity remaining.";
  }
}

const decisionIssues = {
  buy: buyDecisionIssue,
  pantry: (decision: DecisionFields) =>
    preciseQuantity(decision.pantryQuantity) === preciseQuantity(decision.requiredQuantity)
      ? undefined
      : "A pantry decision must cover the full required quantity.",
  exclude: (decision: DecisionFields) =>
    decision.reason ? undefined : "Excluding an ingredient requires an explicit reason.",
};

export const mealPlanDecisionSchema = decisionFieldsSchema.superRefine((decision, context) => {
  if (preciseQuantity(decision.pantryQuantity) > preciseQuantity(decision.requiredQuantity)) {
    context.addIssue({
      code: "custom",
      path: ["pantryQuantity"],
      message: "Pantry allocation cannot exceed the required quantity.",
    });
  }

  const issue = decisionIssues[decision.choice](decision);

  if (issue) {
    context.addIssue({ code: "custom", message: issue });
  }
});

export type MealPlanDecision = z.infer<typeof mealPlanDecisionSchema>;

export const mealPlanDraftSchema = z.object({
  name: nameSchema,
  storeId: storeIdSchema,
  modality: modalitySchema,
  meals: z
    .array(mealSchema)
    .min(1)
    .max(7)
    .refine((meals) => new Set(meals.map((meal) => meal.id)).size === meals.length, {
      message: "Meal IDs must be unique within a plan.",
    }),
  decisions: z
    .array(mealPlanDecisionSchema)
    .refine(
      (decisions) => new Set(decisions.map((decision) => decision.key)).size === decisions.length,
      {
        message: "An ingredient can have only one review decision.",
      },
    )
    .default([]),
});

export type MealPlanDraft = z.infer<typeof mealPlanDraftSchema>;

export const mealPlanSchema = mealPlanDraftSchema.extend({
  id: idSchema,
  version: z.number().int().positive(),
  status: z.enum(["draft", "prepared"]),
  shoppingListId: idSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MealPlan = z.infer<typeof mealPlanSchema>;

export const mealPlanChangeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("set_servings"), mealId: idSchema, servings: servingsSchema }),
  z.strictObject({ type: z.literal("replace_meal"), meal: mealSchema }),
  z.strictObject({ type: z.literal("add_meal"), meal: mealSchema }),
  z.strictObject({ type: z.literal("remove_meal"), mealId: idSchema }),
  z.strictObject({
    type: z.literal("set_store"),
    storeId: storeIdSchema,
    modality: modalitySchema.optional(),
  }),
  z.strictObject({
    type: z.literal("review_ingredient"),
    key: keySchema,
    pantryQuantity: allocationSchema.default(0),
    choice: choiceSchema,
    product: productSchema.optional(),
    reason: reasonSchema.optional(),
  }),
]);

export type MealPlanChange = z.infer<typeof mealPlanChangeSchema>;

type ReviewIngredientChange = Extract<MealPlanChange, { type: "review_ingredient" }>;

export interface MealPlanIngredient {
  key: string;
  name: string;
  unit: string;
  requiredQuantity: number;
  pantryQuantity: number;
  remainingQuantity: number;
  state: "unresolved" | "ready" | "pantry" | "excluded" | "stale";
  sources: Array<{ mealId: string; mealName: string; quantity: number }>;
  decision?: MealPlanDecision;
}

export class MealPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MealPlanValidationError";
  }
}

function parseDomain<Output, Input>(schema: z.ZodType<Output, Input>, input: Input): Output {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new MealPlanValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }

  return result.data;
}

function addIngredient(
  ingredients: Map<string, MealPlanIngredient>,
  meal: Meal,
  ingredient: Meal["ingredients"][number],
): void {
  const key = JSON.stringify([ingredient.name.toLowerCase(), ingredient.unit.toLowerCase()]);

  // Even a subnormal positive input must not become a zero requirement when scaled down.
  const quantity = preciseQuantity(
    Math.max(Number.MIN_VALUE, (ingredient.quantity * meal.servings) / meal.baseServings),
  );

  const source = { mealId: meal.id, mealName: meal.name, quantity };
  const existing = ingredients.get(key);

  if (existing) {
    existing.requiredQuantity += quantity;
    existing.sources.push(source);

    return;
  }

  ingredients.set(key, {
    key,
    name: ingredient.name,
    unit: ingredient.unit,
    requiredQuantity: quantity,
    pantryQuantity: 0,
    remainingQuantity: quantity,
    state: "unresolved",
    sources: [source],
  });
}

function decisionIsStale(
  ingredient: MealPlanIngredient,
  decision: MealPlanDecision,
  storeId: string,
): boolean {
  return (
    ingredient.requiredQuantity !== preciseQuantity(decision.requiredQuantity) ||
    (decision.choice === "buy" && decision.storeId !== storeId)
  );
}

const reviewedStates = { buy: "ready", pantry: "pantry", exclude: "excluded" } as const;

function reviewedIngredient(
  ingredient: MealPlanIngredient,
  decision: MealPlanDecision | undefined,
  storeId: string,
): MealPlanIngredient {
  const requiredQuantity = preciseQuantity(ingredient.requiredQuantity);
  const current = { ...ingredient, requiredQuantity, remainingQuantity: requiredQuantity };

  if (!decision) {
    return current;
  }

  // Stale allocations remain in the visible suggestion, not in the current allocation.
  if (decisionIsStale(current, decision, storeId)) {
    return { ...current, state: "stale", decision };
  }

  const pantryQuantity = preciseQuantity(decision.pantryQuantity);

  return {
    ...current,
    pantryQuantity,
    remainingQuantity: preciseQuantity(Math.max(0, requiredQuantity - pantryQuantity)),
    state: reviewedStates[decision.choice],
    decision,
  };
}

export function aggregateMealPlan(draft: MealPlanDraft) {
  const current = parseDomain(mealPlanDraftSchema, draft);
  const requirements = new Map<string, MealPlanIngredient>();

  for (const meal of current.meals) {
    for (const ingredient of meal.ingredients) {
      addIngredient(requirements, meal, ingredient);
    }
  }

  const decisions = new Map(current.decisions.map((decision) => [decision.key, decision]));

  const ingredients = [...requirements.values()].map((ingredient) =>
    reviewedIngredient(ingredient, decisions.get(ingredient.key), current.storeId),
  );

  const unresolvedCount = ingredients.filter(
    (ingredient) => ingredient.state === "unresolved" || ingredient.state === "stale",
  ).length;

  return { ingredients, unresolvedCount, ready: unresolvedCount === 0 };
}

function requireMeal(meals: Meal[], id: string): void {
  if (!meals.some((meal) => meal.id === id)) {
    throw new MealPlanValidationError("The meal to change is not in this plan.");
  }
}

function reviewIngredient(draft: MealPlanDraft, change: ReviewIngredientChange): MealPlanDraft {
  const ingredient = aggregateMealPlan(draft).ingredients.find((item) => item.key === change.key);

  if (!ingredient) {
    throw new MealPlanValidationError("The ingredient to review is not in this plan.");
  }

  const decision = parseDomain(mealPlanDecisionSchema, {
    key: ingredient.key,
    requiredQuantity: ingredient.requiredQuantity,
    pantryQuantity: change.pantryQuantity,
    choice: change.choice,
    product: change.product,
    reason: change.reason,
    storeId: change.choice === "buy" ? draft.storeId : undefined,
  });

  return {
    ...draft,
    decisions: [...draft.decisions.filter((item) => item.key !== change.key), decision],
  };
}

function changeDraft(draft: MealPlanDraft, change: MealPlanChange): MealPlanDraft {
  switch (change.type) {
    case "set_servings":
      requireMeal(draft.meals, change.mealId);

      return {
        ...draft,
        meals: draft.meals.map((meal) =>
          meal.id === change.mealId ? { ...meal, servings: change.servings } : meal,
        ),
      };
    case "replace_meal":
      requireMeal(draft.meals, change.meal.id);

      return {
        ...draft,
        meals: draft.meals.map((meal) => (meal.id === change.meal.id ? change.meal : meal)),
      };
    case "add_meal":
      return { ...draft, meals: [...draft.meals, change.meal] };
    case "remove_meal":
      requireMeal(draft.meals, change.mealId);

      return { ...draft, meals: draft.meals.filter((meal) => meal.id !== change.mealId) };
    case "set_store":
      return { ...draft, storeId: change.storeId, modality: change.modality ?? draft.modality };
    case "review_ingredient":
      return reviewIngredient(draft, change);
  }
}

export function applyMealPlanChange(
  draft: MealPlanDraft,
  change: z.input<typeof mealPlanChangeSchema>,
): MealPlanDraft {
  const current = parseDomain(mealPlanDraftSchema, draft);
  const parsedChange = parseDomain(mealPlanChangeSchema, change);

  return parseDomain(mealPlanDraftSchema, changeDraft(current, parsedChange));
}

function addPurchase(items: Map<string, ShoppingListItem>, decision: MealPlanDecision): void {
  const product = decision.product;

  if (!product) {
    throw new MealPlanValidationError("A buy decision must include a reviewed product.");
  }

  const existing = items.get(product.upc);

  if (!existing) {
    const item: ShoppingListItem = {
      upc: product.upc,
      productName: product.productName,
      quantity: product.packages,
    };

    if (product.price !== undefined) {
      item.price = product.price;
    }

    items.set(product.upc, item);

    return;
  }

  if (existing.productName !== product.productName) {
    throw new MealPlanValidationError(
      "Selections for the same UPC must use the same product name.",
    );
  }

  if (existing.quantity + product.packages > 999) {
    throw new MealPlanValidationError("Combined package quantities for a UPC cannot exceed 999.");
  }

  existing.quantity += product.packages;

  if (existing.price !== product.price) {
    delete existing.price;
  }
}

/**
 * Packages are shopper-selected counts, never conversions from ingredient quantities.
 * Same-UPC names must agree; differing or partially missing unit prices are omitted.
 */
export function mealPlanItems(draft: MealPlanDraft): ShoppingListItem[] {
  const aggregate = aggregateMealPlan(draft);

  if (!aggregate.ready) {
    throw new MealPlanValidationError("Review every current ingredient before preparing the list.");
  }

  const items = new Map<string, ShoppingListItem>();

  for (const ingredient of aggregate.ingredients) {
    if (ingredient.decision?.choice === "buy") {
      addPurchase(items, ingredient.decision);
    }
  }

  return [...items.values()];
}
