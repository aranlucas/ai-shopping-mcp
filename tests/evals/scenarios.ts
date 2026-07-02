/**
 * End-to-end shopping scenarios shared by the live-model runner
 * (live-model.eval.test.ts). Each scenario is a realistic user request plus
 * machine-checkable success criteria against the Kroger fixture cart.
 *
 * Add scenarios here when a small model fails a flow in the wild: encode the
 * user phrasing that broke, the fixtures it needs, and what the cart must end
 * up containing.
 */
import { upcsForTerm } from "./harness.js";

export type EvalScenario = {
  name: string;
  /** The single user message the model starts from. */
  userTask: string;
  /** Seed a preferred store before the run (skips the store-setup subtask). */
  seedPreferredStoreId?: string;
  /** Hard cap on tool calls — exceeding it fails the scenario. */
  maxToolCalls: number;
  /**
   * Cart success criteria: for each entry, at least one captured cart item's
   * UPC must be in `anyOf`. Order-independent.
   */
  expectCart: Array<{ label: string; anyOf: string[] }>;
};

export const SCENARIOS: EvalScenario[] = [
  {
    name: "cold start: zip → store → milk and eggs in cart",
    userTask:
      "My zip code is 98105. Find my nearest QFC, save it as my store, and add milk and a dozen eggs to my Kroger cart.",
    maxToolCalls: 8,
    expectCart: [
      { label: "milk", anyOf: upcsForTerm("milk") },
      { label: "eggs", anyOf: upcsForTerm("eggs") },
    ],
  },
  {
    name: "returning user: add bread to cart",
    userTask: "Add a loaf of bread to my cart.",
    seedPreferredStoreId: "70500847",
    maxToolCalls: 5,
    expectCart: [{ label: "bread", anyOf: upcsForTerm("bread") }],
  },
  {
    name: "returning user: milk via addToCart",
    userTask: "Add milk to my Kroger cart.",
    seedPreferredStoreId: "70500847",
    // The live model may or may not use shop_for_items's addToCart option;
    // either a 1-call addToCart path or a 2-call shop_for_items +
    // add_shopping_list_to_cart path should land the milk in the cart.
    maxToolCalls: 2,
    expectCart: [{ label: "milk", anyOf: upcsForTerm("milk") }],
  },
];
