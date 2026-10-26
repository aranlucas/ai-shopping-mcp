import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { mealPlans, shoppingLists } from "../db/schema.js";
import {
  applyMealPlanChange,
  mealPlanDraftSchema,
  mealPlanItems,
  mealPlanSchema,
  type MealPlan,
  type MealPlanChange,
  type MealPlanDraft,
} from "../domain/meal-plan.js";
import { AppErrorException, notFoundError, validationError } from "../errors.js";
import { newListItems } from "./d1-shopping-storage.js";

function planFromRow(row: typeof mealPlans.$inferSelect): MealPlan {
  return mealPlanSchema.parse({
    ...row.draft,
    id: row.id,
    version: row.version,
    status: row.status,
    shoppingListId: row.shoppingListId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function requireDraftVersion(plan: MealPlan, expectedVersion: number): void {
  if (plan.status !== "draft") {
    throw new AppErrorException(
      validationError("This plan is already prepared. Open its shopping list."),
    );
  }

  if (plan.version !== expectedVersion) {
    throw changedPlan();
  }
}

function changedPlan(): AppErrorException {
  return new AppErrorException(
    validationError("The meal plan changed. Reload it before reviewing or preparing it again."),
  );
}

/** Shopper-scoped plans, with optimistic edits and one transactional list preparation. */
export function createD1MealPlanStore(binding: D1Database, userId: string) {
  const db = drizzle(binding);
  const owned = (id: string) => and(eq(mealPlans.id, id), eq(mealPlans.userId, userId));
  const select = (id: string) => db.select().from(mealPlans).where(owned(id));

  const get = async (id: string): Promise<MealPlan> => {
    const row = await select(id).get();

    if (!row) {
      throw new AppErrorException(notFoundError("No meal plan with that ID."));
    }

    return planFromRow(row);
  };

  const create = async (input: MealPlanDraft): Promise<MealPlan> => {
    const draft = mealPlanDraftSchema.parse(input);
    const id = `plan_${crypto.randomUUID().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    await db.insert(mealPlans).values({ id, userId, draft, createdAt: now, updatedAt: now }).run();

    return { ...draft, id, version: 1, status: "draft", createdAt: now, updatedAt: now };
  };

  const update = async (
    id: string,
    expectedVersion: number,
    change: MealPlanChange,
  ): Promise<MealPlan> => {
    const current = await get(id);
    requireDraftVersion(current, expectedVersion);
    const draft = applyMealPlanChange(current, change);

    const rows = await db
      .update(mealPlans)
      .set({
        draft,
        version: expectedVersion + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(and(owned(id), eq(mealPlans.version, expectedVersion), eq(mealPlans.status, "draft")))
      .returning();

    const updated = rows[0];

    if (!updated) {
      throw changedPlan();
    }

    return planFromRow(updated);
  };

  const prepare = async (id: string, expectedVersion: number): Promise<MealPlan> => {
    const current = await get(id);

    // A lost response or concurrent prepare returns the original durable result.
    if (current.status === "prepared") {
      return current;
    }

    requireDraftVersion(current, expectedVersion);
    const items = newListItems(mealPlanItems(current));
    const listId = items.length ? `list_${crypto.randomUUID().replaceAll("-", "")}` : null;
    const now = new Date().toISOString();

    const claim = db
      .update(mealPlans)
      .set({
        status: "prepared",
        shoppingListId: listId,
        version: expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(owned(id), eq(mealPlans.version, expectedVersion), eq(mealPlans.status, "draft")));

    // D1 batches execute in one transaction. Only this claim's unique list ID can
    // insert a list; a concurrent edit/prepare inserts nothing. An insert failure
    // rolls back the claim too. Pantry-only plans deliberately create no list.
    const insert = db.insert(shoppingLists).select(
      db
        .select({
          id: sql<string>`${listId}`.as("id"),
          userId: sql<string>`${userId}`.as("user_id"),
          name: sql<string>`${current.name}`.as("name"),
          items: sql<typeof items>`${JSON.stringify(items)}`.as("items_json"),
          createdAt: sql<string>`${now}`.as("created_at"),
          updatedAt: sql<string>`${now}`.as("updated_at"),
          version: sql<number>`1`.as("version"),
          fulfillment: sql<
            NonNullable<typeof shoppingLists.$inferSelect.fulfillment>
          >`${JSON.stringify({ storeId: current.storeId, modality: current.modality })}`.as(
            "fulfillment_json",
          ),
        })
        .from(mealPlans)
        .where(
          and(
            owned(id),
            eq(mealPlans.shoppingListId, listId ?? ""),
            eq(mealPlans.status, "prepared"),
          ),
        ),
    );

    const [, , rows] = await db.batch([claim, insert, select(id)]);
    const result = rows[0];

    if (result?.status !== "prepared") {
      throw changedPlan();
    }

    return planFromRow(result);
  };

  const list = () =>
    db
      .select({
        id: mealPlans.id,
        name: sql<string>`json_extract(${mealPlans.draft}, '$.name')`,
        mealCount: sql<number>`json_array_length(${mealPlans.draft}, '$.meals')`,
        status: mealPlans.status,
        updatedAt: mealPlans.updatedAt,
      })
      .from(mealPlans)
      .where(eq(mealPlans.userId, userId))
      .orderBy(desc(mealPlans.updatedAt))
      .limit(50)
      .all();

  return { create, get, update, prepare, list };
}

export type MealPlanStore = ReturnType<typeof createD1MealPlanStore>;
