import { formatPantryList } from "../utils/format-response.js";
import { createUserStorage, type PantryItem } from "../utils/user-storage.js";
import type { ToolResponse } from "./cart-tools.js";

export interface AddToPantryInput {
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    expiresAt?: string;
  }>;
}

export interface RemoveFromPantryInput {
  productId: string;
}

export async function addToPantry(
  input: AddToPantryInput,
  userId: string,
  kvNamespace: KVNamespace,
): Promise<ToolResponse> {
  const { items } = input;

  if (!userId) {
    throw new Error("User not authenticated");
  }

  const storage = createUserStorage(kvNamespace);
  const now = new Date().toISOString();

  for (const item of items) {
    const pantryItem: PantryItem = {
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      addedAt: now,
      expiresAt: item.expiresAt,
    };

    await storage.pantry.add(userId, pantryItem);
  }

  const pantry = await storage.pantry.getAll(userId);
  const formatted = formatPantryList(pantry);

  return {
    content: [
      {
        type: "text",
        text: `Added ${items.length} item(s) to pantry.\n\nYour pantry:\n\n${formatted}`,
      },
    ],
  };
}

export async function removeFromPantry(
  input: RemoveFromPantryInput,
  userId: string,
  kvNamespace: KVNamespace,
): Promise<ToolResponse> {
  const { productId } = input;

  if (!userId) {
    throw new Error("User not authenticated");
  }

  const storage = createUserStorage(kvNamespace);
  await storage.pantry.remove(userId, productId);

  const pantry = await storage.pantry.getAll(userId);
  const formatted = formatPantryList(pantry);

  return {
    content: [
      {
        type: "text",
        text: `Item removed from pantry.\n\nYour pantry:\n\n${formatted}`,
      },
    ],
  };
}

export async function viewPantry(
  userId: string,
  kvNamespace: KVNamespace,
): Promise<ToolResponse> {
  if (!userId) {
    throw new Error("User not authenticated");
  }

  const storage = createUserStorage(kvNamespace);
  const pantry = await storage.pantry.getAll(userId);
  const formatted = formatPantryList(pantry);

  return {
    content: [
      {
        type: "text",
        text: `Your pantry (${pantry.length} items):\n\n${formatted}`,
      },
    ],
  };
}

export async function clearPantry(
  userId: string,
  kvNamespace: KVNamespace,
): Promise<ToolResponse> {
  if (!userId) {
    throw new Error("User not authenticated");
  }

  const storage = createUserStorage(kvNamespace);
  await storage.pantry.clear(userId);

  return {
    content: [
      {
        type: "text",
        text: "Pantry cleared successfully.",
      },
    ],
  };
}
