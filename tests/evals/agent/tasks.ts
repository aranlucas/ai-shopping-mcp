/**
 * Realistic multi-step shopping tasks for the agent eval (agent.eval.test.ts),
 * following Anthropic's "writing tools for agents" methodology: prompts come
 * from real workflows, most need several tool calls, and success is checked
 * against end state (cart, saved lists, pantry, recorded orders) rather than
 * a fixed tool script — any valid path passes.
 *
 * `split: "test"` tasks are held out: use them to confirm a tool change
 * generalizes, but don't tune tool descriptions against their transcripts.
 */
import type { ToolCall } from "vitest-evals";

import { DEFAULT_STORE_ID, upcsForTerm } from "../harness.js";

export type CartItem = { upc: string; quantity: number; modality: string };
export type ListItem = {
  productName: string;
  upc: string | null;
  quantity: number;
  checked: boolean;
};
export type PantryItem = { name: string; quantity: number };

/** What the harness observed after the agent finished; judges read only this. */
export type AgentOutput = {
  answer: string;
  feedback: string;
  cart: CartItem[];
  lists: Array<{ name: string; items: ListItem[] }>;
  pantry: PantryItem[];
};

export type Check = { name: string; pass: boolean; detail?: string };

export type Seeder = (
  name: string,
  args: Record<string, unknown>,
) => Promise<void>;

export type AgentTask = {
  id: string;
  split: "train" | "test";
  prompt: string;
  setup?: (seed: Seeder) => Promise<void>;
  checks: (output: AgentOutput, toolCalls: ToolCall[]) => Check[];
};

const MILK_2PCT = "0001111041700";
const MILK_WHOLE = "0001111042850";
const EGGS = "0001111060933";
const BREAD = "0001111008728";
const DKB_BREAD = "0007294760112";
const BUTTER = "0001111042372";
const CHEESE = "0001111098765";

const WRITE_TOOLS = new Set([
  "add_to_inventory",
  "remove_from_inventory",
  "create_shopping_list",
  "add_shopping_list_items",
  "edit_shopping_list_item",
  "add_shopping_list_to_cart",
  "shop_for_items",
  "record_order",
]);

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function check(name: string, pass: boolean, detail?: string): Check {
  return pass || detail === undefined
    ? { name, pass }
    : { name, pass, detail: detail.slice(0, 300) };
}

const cartText = (cart: CartItem[]) =>
  cart
    .map((item) => `${item.upc}x${item.quantity} ${item.modality}`)
    .join(", ") || "empty cart";
const cartHas = (cart: CartItem[], upcs: string[]) =>
  cart.some((item) => upcs.includes(item.upc));
const cartQuantity = (cart: CartItem[], upc: string) =>
  cart
    .filter((item) => item.upc === upc)
    .reduce((sum, item) => sum + item.quantity, 0);

function findList(output: AgentOutput, name: string): ListItem[] | null {
  return (
    output.lists.find((list) => list.name.toLowerCase() === name.toLowerCase())
      ?.items ?? null
  );
}
const listText = (items: ListItem[] | null) =>
  items
    ? items
        .map(
          (item) =>
            `${item.productName}x${item.quantity}${item.checked ? " (checked)" : ""}`,
        )
        .join(", ") || "empty list"
    : "list not found";
const listHas = (items: ListItem[] | null, upcs: string[], name: RegExp) =>
  (items ?? []).some(
    (item) =>
      (item.upc !== null && upcs.includes(item.upc)) ||
      name.test(item.productName),
  );

const pantryText = (pantry: PantryItem[]) =>
  pantry.map((item) => `${item.name}x${item.quantity}`).join(", ") ||
  "empty pantry";

function recordedOrderItems(toolCalls: ToolCall[]) {
  return toolCalls
    .filter((call) => call.name === "record_order" && call.status === "ok")
    .flatMap((call) =>
      Array.isArray(call.arguments?.items)
        ? (call.arguments.items as Array<{ upc?: string; quantity?: number }>)
        : [],
    );
}

const seedStore = (seed: Seeder) =>
  seed("set_preferred_store", { storeId: DEFAULT_STORE_ID });

const seedWeeklyList = (seed: Seeder) =>
  seed("create_shopping_list", {
    name: "Weekly",
    items: [
      { upc: MILK_2PCT, productName: "Kroger 2% Milk", quantity: 1 },
      { upc: BREAD, productName: "Kroger White Bread", quantity: 1 },
      { upc: CHEESE, productName: "Kroger Cheddar Block", quantity: 1 },
    ],
  });

export const AGENT_TASKS: AgentTask[] = [
  {
    id: "cold-start-cart",
    split: "train",
    prompt:
      "My zip is 98105. Find the closest QFC, make it my store, and put milk and a dozen eggs in my Kroger cart.",
    checks: ({ cart }, toolCalls) => [
      check(
        "saved University Village as preferred store",
        toolCalls.some(
          (call) =>
            call.name === "set_preferred_store" &&
            call.status === "ok" &&
            call.arguments?.storeId === DEFAULT_STORE_ID,
        ),
      ),
      check("milk in cart", cartHas(cart, upcsForTerm("milk")), cartText(cart)),
      check("eggs in cart", cartHas(cart, upcsForTerm("eggs")), cartText(cart)),
    ],
  },
  {
    id: "cheaper-milk",
    split: "train",
    prompt:
      "I need 2 gallons of milk. Compare Kroger's 2% and whole milk and put 2 of whichever is cheaper right now in my cart.",
    setup: seedStore,
    checks: ({ cart }) => [
      check(
        "2x Kroger 2% (on sale) in cart",
        cartQuantity(cart, MILK_2PCT) === 2,
        cartText(cart),
      ),
      check(
        "whole milk not added",
        !cartHas(cart, [MILK_WHOLE]),
        cartText(cart),
      ),
    ],
  },
  {
    id: "budget-basket",
    split: "train",
    prompt:
      "I have $10. Put the cheapest milk, eggs, and bread in my cart for pickup, and butter too if everything still fits under $10. Tell me the total.",
    setup: seedStore,
    checks: ({ cart, answer }) => [
      check(
        "cheapest milk, eggs, bread in cart",
        [MILK_2PCT, EGGS, BREAD].every((upc) => cartHas(cart, [upc])),
        cartText(cart),
      ),
      check(
        "butter left out ($12.76 would exceed $10)",
        !cartHas(cart, [BUTTER]),
        cartText(cart),
      ),
      check("reports the $8.27 total", /8\.27/.test(answer), answer),
    ],
  },
  {
    id: "french-toast-pantry",
    split: "train",
    prompt:
      "I'm making French toast this weekend: bread, eggs, milk, and butter. Check what I already have and make a shopping list called \"French toast\" with only what I still need. Don't add anything to my cart yet.",
    setup: async (seed) => {
      await seedStore(seed);
      await seed("add_to_inventory", {
        inventory: "pantry",
        items: [
          { name: "Eggs", quantity: 12 },
          { name: "Butter", quantity: 1 },
        ],
      });
    },
    checks: (output) => {
      const list = findList(output, "French toast");
      return [
        check("list created", list !== null),
        check(
          "bread on list",
          listHas(list, upcsForTerm("bread"), /bread/i),
          listText(list),
        ),
        check(
          "milk on list",
          listHas(list, upcsForTerm("milk"), /milk/i),
          listText(list),
        ),
        check(
          "eggs and butter left off (already in pantry)",
          !listHas(list, [EGGS, BUTTER], /egg|butter/i),
          listText(list),
        ),
        check(
          "cart untouched",
          output.cart.length === 0,
          cartText(output.cart),
        ),
      ];
    },
  },
  {
    id: "append-not-duplicate",
    split: "train",
    prompt: "Add a dozen eggs to my Weekly list.",
    setup: async (seed) => {
      await seedStore(seed);
      await seedWeeklyList(seed);
    },
    checks: (output) => {
      const weekly = output.lists.filter((list) => /weekly/i.test(list.name));
      const list = findList(output, "Weekly");
      return [
        check(
          "still exactly one Weekly list",
          weekly.length === 1,
          weekly.map((entry) => entry.name).join(", "),
        ),
        check(
          "eggs added",
          listHas(list, upcsForTerm("eggs"), /egg/i),
          listText(list),
        ),
        check(
          "original items kept",
          listHas(list, [MILK_2PCT], /milk/i) &&
            listHas(list, [CHEESE], /cheddar/i),
          listText(list),
        ),
      ];
    },
  },
  {
    id: "edit-weekly-list",
    split: "train",
    prompt:
      "On my Weekly list: make the milk 2, take the cheese off, and check off the bread — I already grabbed it.",
    setup: async (seed) => {
      await seedStore(seed);
      await seedWeeklyList(seed);
    },
    checks: (output) => {
      const list = findList(output, "Weekly");
      const milk = list?.find((item) => item.upc === MILK_2PCT);
      const bread = list?.find((item) => item.upc === BREAD);
      return [
        check("milk quantity is 2", milk?.quantity === 2, listText(list)),
        check(
          "cheese removed",
          !listHas(list, [CHEESE], /cheddar|cheese/i),
          listText(list),
        ),
        check("bread checked off", bread?.checked === true, listText(list)),
      ];
    },
  },
  {
    id: "log-purchase",
    split: "train",
    prompt:
      "Just got back from QFC University Village: I bought 2 gallons of Kroger 2% milk and a dozen Kroger large eggs. Log that order and add both to my pantry.",
    setup: seedStore,
    checks: ({ pantry }, toolCalls) => {
      const ordered = recordedOrderItems(toolCalls);
      return [
        check(
          "order has 2x the Kroger 2% milk UPC",
          ordered.some((item) => item.upc === MILK_2PCT && item.quantity === 2),
          JSON.stringify(ordered),
        ),
        check(
          "order has the Kroger eggs UPC",
          ordered.some((item) => item.upc === EGGS),
          JSON.stringify(ordered),
        ),
        check(
          "milk in pantry",
          pantry.some((item) => /milk/i.test(item.name)),
          pantryText(pantry),
        ),
        check(
          "eggs in pantry",
          pantry.some((item) => /egg/i.test(item.name)),
          pantryText(pantry),
        ),
      ];
    },
  },
  {
    id: "sale-items-list",
    split: "train",
    prompt:
      'What\'s on sale at my store this week? Put every sale item into a new shopping list called "Deals".',
    setup: seedStore,
    checks: (output) => {
      const list = findList(output, "Deals");
      return [
        check("list created", list !== null),
        check(
          "sale milk on list",
          listHas(list, [MILK_2PCT], /2%|reduced fat/i),
          listText(list),
        ),
        check(
          "sale bread on list",
          listHas(list, [DKB_BREAD], /dave|killer/i),
          listText(list),
        ),
      ];
    },
  },
  {
    id: "missing-item",
    split: "train",
    prompt: "Add bread and zzzfrobnut sauce to my cart.",
    setup: seedStore,
    checks: ({ cart, answer }) => [
      check(
        "bread in cart",
        cartHas(cart, upcsForTerm("bread")),
        cartText(cart),
      ),
      check(
        "tells the user zzzfrobnut wasn't found",
        /zzzfrobnut/i.test(answer) &&
          /(couldn.?t|could not|no (results|match)|not (find|found|available)|unavailable)/i.test(
            answer,
          ),
        answer,
      ),
    ],
  },
  {
    id: "use-first",
    split: "train",
    prompt:
      "Which things in my pantry should I use up first? Just tell me, don't change anything.",
    setup: async (seed) => {
      await seed("add_to_inventory", {
        inventory: "pantry",
        items: [
          { name: "Spinach", quantity: 1, expiresAt: daysFromNow(1) },
          { name: "Greek yogurt", quantity: 2, expiresAt: daysFromNow(12) },
          { name: "Rice", quantity: 1 },
        ],
      });
    },
    checks: ({ answer }, toolCalls) => [
      check(
        "leads with spinach",
        /spinach/i.test(answer) &&
          answer.search(/spinach/i) < answer.search(/yogurt|rice|$/i),
        answer,
      ),
      check(
        "made no writes",
        !toolCalls.some((call) => WRITE_TOOLS.has(call.name)),
        toolCalls.map((call) => call.name).join(", "),
      ),
    ],
  },
  {
    id: "list-to-cart-delivery",
    split: "test",
    prompt: "Send my Party list to my Kroger cart — I want it delivered.",
    setup: async (seed) => {
      await seedStore(seed);
      await seed("create_shopping_list", {
        name: "Party",
        items: [
          { upc: CHEESE, productName: "Kroger Cheddar Block", quantity: 2 },
          { upc: DKB_BREAD, productName: "Dave's Killer Bread", quantity: 1 },
        ],
      });
    },
    checks: ({ cart }) => [
      check("cheese in cart", cartHas(cart, [CHEESE]), cartText(cart)),
      check("bread in cart", cartHas(cart, [DKB_BREAD]), cartText(cart)),
      check(
        "every item is DELIVERY",
        cart.length > 0 && cart.every((item) => item.modality === "DELIVERY"),
        cartText(cart),
      ),
    ],
  },
  {
    id: "store-close-time",
    split: "test",
    prompt: "What time does my store close on Tuesdays?",
    setup: seedStore,
    checks: ({ answer }) => [
      check(
        "answers 11 PM",
        /\b11(:00)?\s*(p\.?m\.?)|\b23:00\b/i.test(answer),
        answer,
      ),
    ],
  },
  {
    id: "aisle-lookup",
    split: "test",
    prompt: "I'm standing in my QFC right now. Which aisle has the butter?",
    setup: seedStore,
    checks: ({ answer }) => [
      check("answers aisle D3", /\bD3\b/.test(answer), answer),
    ],
  },
  {
    id: "pantry-used-up",
    split: "test",
    prompt: "I used 6 eggs and finished the milk. Update my pantry.",
    setup: (seed) =>
      seed("add_to_inventory", {
        inventory: "pantry",
        items: [
          { name: "Eggs", quantity: 12 },
          { name: "Milk", quantity: 1 },
          { name: "Butter", quantity: 1 },
        ],
      }),
    checks: ({ pantry }) => [
      check(
        "6 eggs left",
        pantry.some((item) => /egg/i.test(item.name) && item.quantity === 6),
        pantryText(pantry),
      ),
      check(
        "milk removed",
        !pantry.some((item) => /milk/i.test(item.name)),
        pantryText(pantry),
      ),
      check(
        "butter untouched",
        pantry.some((item) => /butter/i.test(item.name)),
        pantryText(pantry),
      ),
    ],
  },
  {
    id: "no-store-yet",
    split: "test",
    prompt: "Add milk to my cart.",
    checks: ({ cart, answer }) => [
      check(
        "asks for a zip code or store instead of guessing",
        /zip|which store|preferred store/i.test(answer),
        answer,
      ),
      check("cart untouched", cart.length === 0, cartText(cart)),
    ],
  },
];
