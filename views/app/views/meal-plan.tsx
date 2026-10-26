import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  aggregateMealPlan,
  type Meal,
  type MealPlanChange,
  type MealPlanIngredient,
} from "../../../src/domain/meal-plan.js";
import {
  type AppData,
  type MealPlanContent,
  type MealPlansContent,
  type ShoppingAppClient,
  sendUserMessage,
} from "../../shared/types.js";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../shared/ui/card";
import { Alert, AlertDescription } from "../../shared/ui/alert";
import { changeMealPlan, openMealPlan, prepareMealPlan } from "../meal-plan-calls.js";
import { openShoppingList } from "../tool-calls.js";
import { useResettableState } from "../../shared/hooks.js";

type ViewProps = {
  app: ShoppingAppClient | null;
  canCallTools: boolean;
  setData: (data: AppData | null) => void;
};

type MealRowProps = {
  meal: Meal;
  disabled: boolean;
  onChange: (change: MealPlanChange) => Promise<void>;
};

function MealRow({ meal, disabled, onChange }: MealRowProps) {
  const [servings, setServings] = useState(String(meal.servings));

  const editServings = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setServings(event.currentTarget.value);
  }, []);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onChange({ type: "set_servings", mealId: meal.id, servings: Number(servings) }).catch(
        console.error,
      );
    },
    [meal.id, onChange, servings],
  );

  return (
    <li>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3 py-2">
        <strong className="min-w-0 flex-1">{meal.name}</strong>
        <label className="flex items-center gap-2">
          Servings
          <input
            aria-label={`${meal.name} servings`}
            name="servings"
            type="number"
            min={1}
            max={50}
            step={1}
            required
            value={servings}
            onChange={editServings}
            disabled={disabled}
            className="w-16"
          />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={disabled}>
          Save servings
        </Button>
      </form>
    </li>
  );
}

type IngredientRowProps = {
  ingredient: MealPlanIngredient;
  planId: string;
  storeId: string;
  disabled: boolean;
  onChange: (change: MealPlanChange) => Promise<void>;
  onAsk: (message: string) => Promise<void>;
};

function IngredientRow({
  ingredient,
  planId,
  storeId,
  disabled,
  onChange,
  onAsk,
}: IngredientRowProps) {
  const usePantry = useCallback(() => {
    onChange({
      type: "review_ingredient",
      key: ingredient.key,
      choice: "pantry",
      pantryQuantity: ingredient.requiredQuantity,
    }).catch(console.error);
  }, [ingredient.key, ingredient.requiredQuantity, onChange]);

  const ask = useCallback(() => {
    onAsk(
      `Help me review ${ingredient.name} (${ingredient.requiredQuantity} ${ingredient.unit}) in meal plan ${planId}, ingredient key ${ingredient.key}. Use store ${storeId}. Show product choices, ask how much I have in the recipe unit, and confirm package counts before saving the decision.`,
    ).catch(console.error);
  }, [ingredient, planId, storeId, onAsk]);

  const stale = ingredient.state === "stale";
  const needsReview = stale || ingredient.state === "unresolved";
  const product = ingredient.decision?.product;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{ingredient.name}</strong>
        <span>
          {ingredient.requiredQuantity} {ingredient.unit}
        </span>
        <Badge variant="secondary" tone={needsReview ? "warning" : "success"}>
          {ingredient.state}
        </Badge>
      </div>
      <p>
        Pantry: {ingredient.pantryQuantity} {ingredient.unit} · Still needed:{" "}
        {ingredient.remainingQuantity} {ingredient.unit}
      </p>
      {product && (
        <p>
          {stale ? "Previous choice: " : "Buy: "}
          {product.productName} · {product.packages} package(s)
        </p>
      )}
      {ingredient.decision?.choice === "exclude" && <p>Excluded: {ingredient.decision.reason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={usePantry} disabled={disabled}>
          I have all {ingredient.requiredQuantity} {ingredient.unit}
        </Button>
        <Button variant="secondary" size="sm" onClick={ask} disabled={disabled}>
          Review with assistant
        </Button>
      </div>
    </li>
  );
}

type PlanErrorProps = { message: string | null };

function PlanError({ message }: PlanErrorProps) {
  if (!message) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

type MealPlanViewProps = ViewProps & { data: MealPlanContent };

type MealPlansViewProps = ViewProps & { data: MealPlansContent };

/** A late tool response cannot replace a newer host result or an unmounted view. */
function usePlanAction(source: AppData, setData: ViewProps["setData"]) {
  const [pending, setPending] = useResettableState(source, () => false);
  const [error, setError] = useResettableState(source, (): string | null => null);
  const latest = useRef<AppData | null>(null);
  useLayoutEffect(() => {
    latest.current = source;

    return () => {
      latest.current = null;
    };
  }, [source]);

  const run = useCallback(
    async (operation: () => Promise<AppData | void>) => {
      setPending(true);
      setError(null);

      try {
        const result = await operation();

        if (result && latest.current === source) {
          setData(result);
        }
      } catch (cause) {
        if (latest.current === source) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not save the plan. Reload it and try again.",
          );
        }
      } finally {
        if (latest.current === source) {
          setPending(false);
        }
      }
    },
    [source, setData, setPending, setError],
  );

  return { pending, error, run };
}

export function MealPlanView({ data, app, canCallTools, setData }: MealPlanViewProps) {
  const { plan } = data;
  const aggregate = aggregateMealPlan(plan);
  const { pending, error, run } = usePlanAction(data, setData);

  const change = useCallback(
    (value: MealPlanChange) => run(() => changeMealPlan(app, data, value)),
    [app, data, run],
  );

  const ask = useCallback(
    (message: string) => run(() => sendUserMessage(app, message)),
    [app, run],
  );

  const reload = useCallback(() => {
    run(() => openMealPlan(app, plan.id)).catch(console.error);
  }, [app, plan.id, run]);

  const prepare = useCallback(() => {
    run(() => prepareMealPlan(app, data)).catch(console.error);
  }, [app, data, run]);

  const openList = useCallback(() => {
    const listId = plan.shoppingListId;

    if (listId) {
      run(() => openShoppingList(app, listId)).catch(console.error);
    }
  }, [app, plan.shoppingListId, run]);

  const disabled = !canCallTools || pending;
  const frozen = disabled || plan.status === "prepared";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5">
      <Card>
        <CardHeader>
          <CardTitle>{plan.name}</CardTitle>
          <CardDescription>
            {plan.meals.length} meals · Store {plan.storeId} · {plan.modality}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p>
            Your choices are saved. Review ingredient amounts and package counts before preparing
            the shopping list.
          </p>
          <ul>
            {plan.meals.map((meal) => (
              <MealRow
                key={`${meal.id}:${plan.version}`}
                meal={meal}
                disabled={frozen}
                onChange={change}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ingredient review</CardTitle>
          <CardDescription>
            {aggregate.unresolvedCount} need review. Pantry confirmations use the displayed recipe
            unit and do not change inventory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul>
            {aggregate.ingredients.map((ingredient) => (
              <IngredientRow
                key={ingredient.key}
                ingredient={ingredient}
                planId={plan.id}
                storeId={plan.storeId}
                disabled={frozen}
                onChange={change}
                onAsk={ask}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
      <PlanError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={reload} disabled={disabled}>
          Reload saved plan
        </Button>
        {plan.status === "draft" && (
          <Button onClick={prepare} disabled={disabled || !aggregate.ready}>
            Prepare reviewed list
          </Button>
        )}
        {plan.shoppingListId && (
          <Button onClick={openList} disabled={disabled}>
            Open shopping list
          </Button>
        )}
      </div>
      <p>
        {plan.status === "prepared" && !plan.shoppingListId
          ? "Plan prepared: no purchases needed."
          : "Preparing saves a list. Adding items to Kroger is a separate action from that list."}
      </p>
    </div>
  );
}

type PlanSummaryProps = {
  plan: MealPlansContent["plans"][number];
  onOpen: (id: string) => Promise<void>;
  disabled: boolean;
};

function PlanSummary({ plan, onOpen, disabled }: PlanSummaryProps) {
  const open = useCallback(() => {
    onOpen(plan.id).catch(console.error);
  }, [plan.id, onOpen]);

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div>
        <strong>{plan.name}</strong>
        <p>
          {plan.mealCount} meals · {plan.status}
        </p>
      </div>
      <Button variant="outline" onClick={open} disabled={disabled}>
        Open
      </Button>
    </li>
  );
}

export function MealPlansView({ data, app, canCallTools, setData }: MealPlansViewProps) {
  const { pending, error, run } = usePlanAction(data, setData);

  const open = useCallback((id: string) => run(() => openMealPlan(app, id)), [app, run]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <Card>
        <CardHeader>
          <CardTitle>Saved meal plans</CardTitle>
        </CardHeader>
        <CardContent>
          {data.plans.length === 0 && (
            <p>Ask your assistant to plan your dinners and save the meals here.</p>
          )}
          <ul>
            {data.plans.map((plan) => (
              <PlanSummary
                key={plan.id}
                plan={plan}
                onOpen={open}
                disabled={!canCallTools || pending}
              />
            ))}
          </ul>
          <PlanError message={error} />
        </CardContent>
      </Card>
    </div>
  );
}
