import { describe, expect, it } from "vitest";

import { DEAL_CATEGORIES, classifyDealCategory } from "../../src/utils/deal-category.js";

describe("DEAL_CATEGORIES", () => {
  it("lists categories in meal-planning priority order, ending with Other", () => {
    expect(DEAL_CATEGORIES).toEqual([
      "Meat & Seafood",
      "Produce",
      "Dairy & Eggs",
      "Bakery",
      "Frozen",
      "Pantry, Snacks & Beverages",
      "Other",
    ]);
  });
});

describe("classifyDealCategory", () => {
  const cases: Array<[string, string]> = [
    // Meat & Seafood
    ["Fresh Coastal Range Organic Boneless Chicken Full Line Sale", "Meat & Seafood"],
    ["Oscar Mayer Beef Franks", "Meat & Seafood"],
    ["Hempler's Bacon", "Meat & Seafood"],
    ["Flank Steaks", "Meat & Seafood"],
    ["Fresh Wild-Caught Alaska Sockeye Salmon Fillets", "Meat & Seafood"],
    // Produce
    ["California Red or Black Plums", "Produce"],
    ["Zucchini or Yellow Squash", "Produce"],
    ["Washington Grown Rainier Cherries", "Produce"],
    ["California Red, Green or Black Seedless Grapes", "Produce"],
    ["Personal Watermelon", "Produce"],
    // Dairy & Eggs
    ["Ellenos Greek Yogurt", "Dairy & Eggs"],
    ["Kroger Cheese", "Dairy & Eggs"],
    // Bakery
    ["Franz Wide Pan Bread", "Bakery"],
    // Frozen
    ["Bibigo or Pagoda Entrée", "Frozen"],
    ["Popsicle Ice Pops", "Frozen"],
    // Pantry, Snacks & Beverages
    ["Lipton Tea", "Pantry, Snacks & Beverages"],
    ["Canada Dry", "Pantry, Snacks & Beverages"],
    ["General Mills Cereal", "Pantry, Snacks & Beverages"],
    ["Doritos", "Pantry, Snacks & Beverages"],
    ["Vitaminwater", "Pantry, Snacks & Beverages"],
    ["Starbucks Frappuccino", "Pantry, Snacks & Beverages"],
    ["Polar Seltzer Water", "Pantry, Snacks & Beverages"],
    ["Body Armor", "Pantry, Snacks & Beverages"],
    [
      "Kendall-Jackson VR Chard, Sauvignon Blanc, Avant or Pinot Gris",
      "Pantry, Snacks & Beverages",
    ],
    ["Coca-Cola", "Pantry, Snacks & Beverages"],
    ["Stumptown Coffee", "Pantry, Snacks & Beverages"],
    ["Private Selection Pasta", "Pantry, Snacks & Beverages"],
    ["Powerade", "Pantry, Snacks & Beverages"],
    ["Modelo, Elysian or White Claw Hard Seltzer", "Pantry, Snacks & Beverages"],
    ["Pepsi", "Pantry, Snacks & Beverages"],
    // Cincinnati (Kroger flagship, division 014) — a second real circular
    // pulled to avoid overfitting the keyword lists to one week's QFC data.
    ["T-Bone Steaks", "Meat & Seafood"],
    ["Private Selection Angus 90% Lean Ground Sirloin", "Meat & Seafood"],
    ["Honeycrisp Apples", "Produce"],
    ["Taylor Farms Chopped Salad Kit", "Produce"],
    ["Kroger Butter", "Dairy & Eggs"],
    ["Thomas' English Muffins", "Bakery"],
    ["Häagen-Dazs Ice Cream", "Frozen"],
    ["DiGiorno Pizza", "Frozen"],
    ["Marie Callender's Pot Pie", "Frozen"],
    ["Ranch Style Beans", "Pantry, Snacks & Beverages"],
    ["Knorr Sides", "Pantry, Snacks & Beverages"],
    ["Sparkling Ice", "Pantry, Snacks & Beverages"],
    ["Kroger Trail Mix", "Pantry, Snacks & Beverages"],
    ["Nissin Ramen or Chow Mein", "Pantry, Snacks & Beverages"],
    ["Chef Boyardee", "Pantry, Snacks & Beverages"],
    ["Frito-Lay Multipack", "Pantry, Snacks & Beverages"],
    ["Green Mountain or McCafé K-Cups", "Pantry, Snacks & Beverages"],
    ["7UP", "Pantry, Snacks & Beverages"],
  ];

  it.each(cases)("classifies %j as %j", (title, expected) => {
    expect(classifyDealCategory(title)).toBe(expected);
  });

  it("falls back to Other for an unrecognized title", () => {
    expect(classifyDealCategory("Widget Deluxe 3000")).toBe("Other");
  });

  it("falls back to Other for an empty title", () => {
    expect(classifyDealCategory("")).toBe("Other");
  });

  it("is case-insensitive", () => {
    expect(classifyDealCategory("GROUND BEEF")).toBe("Meat & Seafood");
  });

  it("does not match a keyword that's a substring of a longer word", () => {
    // "Popcorn" must not match the "corn" Produce keyword via substring
    // containment — word-boundary matching requires "corn" as its own word.
    expect(classifyDealCategory("Popcorn Tin")).toBe("Other");
  });
});
