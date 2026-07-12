/**
 * Deterministic keyword classifier that groups weekly-deal titles into meal-
 * planning categories. Neither deal source carries reliable category data:
 * the primary DACS print-ad path has no department field at all, and the
 * Product Search fallback's `categories` field is dropped before this point.
 * See docs/superpowers/specs/2026-07-12-weekly-deals-category-ordering-design.md.
 */

export const DEAL_CATEGORIES = [
  "Meat & Seafood",
  "Produce",
  "Dairy & Eggs",
  "Bakery",
  "Frozen",
  "Pantry, Snacks & Beverages",
  "Other",
] as const;

export type DealCategory = (typeof DEAL_CATEGORIES)[number];

type KeywordCategory = Exclude<DealCategory, "Other">;

const CATEGORY_KEYWORDS: Record<KeywordCategory, string[]> = {
  "Meat & Seafood": [
    "chicken",
    "beef",
    "pork",
    "turkey",
    "ham",
    "bacon",
    "sausage",
    "steak",
    "steaks",
    "ribs",
    "brisket",
    "ground beef",
    "flank",
    "sirloin",
    "wing",
    "wings",
    "meat",
    "salmon",
    "shrimp",
    "seafood",
    "fish",
    "tilapia",
    "cod",
    "crab",
    "tuna",
    "franks",
    "hot dog",
    "hot dogs",
    "pepperoni",
  ],
  Produce: [
    "apple",
    "apples",
    "banana",
    "bananas",
    "orange",
    "oranges",
    "grape",
    "grapes",
    "berry",
    "berries",
    "strawberry",
    "strawberries",
    "blueberry",
    "blueberries",
    "melon",
    "watermelon",
    "cherry",
    "cherries",
    "plum",
    "plums",
    "peach",
    "peaches",
    "pear",
    "pears",
    "lemon",
    "lemons",
    "lime",
    "limes",
    "avocado",
    "avocados",
    "tomato",
    "tomatoes",
    "potato",
    "potatoes",
    "onion",
    "onions",
    "pepper",
    "peppers",
    "lettuce",
    "spinach",
    "broccoli",
    "carrot",
    "carrots",
    "cucumber",
    "cucumbers",
    "zucchini",
    "squash",
    "corn",
    "mushroom",
    "mushrooms",
    "celery",
    "cabbage",
    "kale",
    "produce",
    "vegetable",
    "vegetables",
    "fruit",
    "salad",
  ],
  "Dairy & Eggs": [
    "milk",
    "cheese",
    "yogurt",
    "yoghurt",
    "egg",
    "eggs",
    "butter",
    "creamer",
    "cottage cheese",
    "sour cream",
    "half and half",
  ],
  Bakery: [
    "bread",
    "bun",
    "buns",
    "bagel",
    "bagels",
    "muffin",
    "muffins",
    "cake",
    "donut",
    "donuts",
    "tortilla",
    "tortillas",
    "roll",
    "rolls",
    "pastry",
    "bakery",
    "pie crust",
  ],
  Frozen: [
    "frozen",
    "ice cream",
    "popsicle",
    "popsicles",
    "ice pop",
    "ice pops",
    "waffle",
    "waffles",
    "entree",
  ],
  "Pantry, Snacks & Beverages": [
    "soda",
    "cola",
    "water",
    "juice",
    "coffee",
    "tea",
    "cereal",
    "pasta",
    "rice",
    "sauce",
    "chip",
    "chips",
    "cracker",
    "crackers",
    "snack",
    "snacks",
    "cookie",
    "cookies",
    "candy",
    "soup",
    "beer",
    "wine",
    "seltzer",
    "sports drink",
    "energy drink",
    "drink",
    "drinks",
    "ketchup",
    "mustard",
    "mayo",
    "oil",
    "spice",
    "granola",
    "nuts",
    "chard",
    "sauvignon",
    "pinot",
    "doritos",
    "pepsi",
    "powerade",
    "vitaminwater",
    "body armor",
    "frappuccino",
    "canada dry",
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CATEGORY_PATTERNS: Array<{ category: KeywordCategory; pattern: RegExp }> = (
  Object.entries(CATEGORY_KEYWORDS) as Array<[KeywordCategory, string[]]>
).map(([category, keywords]) => ({
  category,
  pattern: new RegExp(`\\b(?:${keywords.map(escapeRegExp).join("|")})\\b`),
}));

/** Lowercase and strip diacritics so accented titles (e.g. "Entrée") match ASCII keywords. */
function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Classifies a weekly-deal title into a meal-planning category by testing
 * word-boundary keyword matches in priority order (DEAL_CATEGORIES order,
 * excluding "Other"). Falls back to "Other" when nothing matches. Pure and
 * synchronous — safe to call for every deal on every request.
 */
export function classifyDealCategory(title: string): DealCategory {
  const normalized = normalizeTitle(title);
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(normalized)) return category;
  }
  return "Other";
}
