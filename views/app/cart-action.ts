import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { AddShoppingListToCartArgs } from "../shared/types.js";
import {
  addListToCart,
  createProductList,
  needsCartCheck,
  type ProductShoppingListInput,
} from "./tool-calls.js";

type Modality = AddShoppingListToCartArgs["modality"];
export type CartRequest =
  | { kind: "product"; product: ProductShoppingListInput; modality: Modality }
  | { kind: "list"; listId: string; modality: Modality };

export type CartState =
  | { status: "idle"; request: CartRequest }
  | { status: "submitting"; request: CartRequest }
  | { status: "added"; request: CartRequest }
  | {
      status: "already_added";
      request: CartRequest;
      message: string;
    }
  | {
      status: "needs_match";
      request: CartRequest;
      message: string;
    }
  | { status: "retryable"; request: CartRequest; message: string }
  | { status: "check_cart"; request: CartRequest; message: string };

/** One action owns its state and the checkpoint from which a safe retry resumes. */
export function createCartAction(input: CartRequest) {
  const initialRequest = structuredClone(input);
  let state: CartState = { status: "idle", request: initialRequest };
  let pending = Promise.resolve();
  const listeners = new Set<() => void>();
  const transition = (next: CartState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  async function run(app: App | null, request: CartRequest): Promise<void> {
    try {
      if (request.kind === "product") {
        const listId = await createProductList(app, request.product);
        request = { kind: "list", listId, modality: request.modality };
        transition({ status: "submitting", request });
      }
      const result = await addListToCart(app, request.listId, request.modality);
      if (result.outcome === "already_added") {
        transition({
          status: "already_added",
          request,
          message:
            result.actionDetail ??
            "These items were already added to your Kroger cart.",
        });
      } else if (result.outcome === "needs_match") {
        transition({
          status: "needs_match",
          request,
          message:
            result.actionDetail ??
            "No items are ready for the Kroger cart. Find Kroger matches and try again.",
        });
      } else {
        transition({ status: "added", request });
      }
    } catch (error) {
      transition({
        status: needsCartCheck(error) ? "check_cart" : "retryable",
        request,
        message:
          error instanceof Error ? error.message : "Failed to add to cart",
      });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit(app: App | null): Promise<void> {
      // Repeated clicks share the in-flight request; terminal outcomes cannot resubmit.
      if (state.status !== "idle" && state.status !== "retryable")
        return pending;
      const request = state.request;
      pending = Promise.resolve().then(() => run(app, request));
      transition({ status: "submitting", request });
      return pending;
    },
    reset() {
      // Only confirmed success can start a new intentional add.
      if (state.status === "added" || state.status === "already_added")
        transition({ status: "idle", request: initialRequest });
    },
  };
}
