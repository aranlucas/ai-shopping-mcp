import { z } from "zod/v4";
import { selectionSchema } from "../../scripts/eval-schemas.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { URL, fileURLToPath } from "node:url";

/** @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "jev-selector-live-"));
  let worker;

  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "jev-selector-live",
        compatibility_date: "2025-03-10",
        ai: { binding: "AI", remote: true },
      }),
    );
    worker = await unstable_dev(
      fileURLToPath(new URL("../../scripts/selector-live-worker.ts", import.meta.url)),
      {
        config: configPath,
        ip: "127.0.0.1",
        port: 0,
        inspectorPort: 0,
        persist: false,
        logLevel: "error",
        experimental: { disableExperimentalWarning: true, watch: false },
      },
    );

    const candy = {
      upc: "1111111111111",
      description: "Chocolate Milk Candy Bar",
      categories: ["Candy"],
      items: [{ size: "1.5 oz", fulfillment: { curbside: true } }],
    };

    const milk = {
      upc: "2222222222222",
      description: "Whole Milk",
      categories: ["Dairy"],
      items: [{ size: "1 gal", fulfillment: { curbside: true } }],
    };

    const distractors = Array.from({ length: 19 }, (_, index) => ({
      ...candy,
      upc: String(1000000000000 + index),
      description: `Chocolate Candy Bar ${index + 1}`,
    }));

    const otherNames = [
      "Large Eggs",
      "Bananas",
      "White Rice",
      "Olive Oil",
      "Chicken Breast",
      "Carrots",
      "Rolled Oats",
      "Plain Yogurt",
    ];

    const otherProducts = otherNames.map((description, index) => ({
      upc: String(3000000000000 + index),
      description,
      items: [{ fulfillment: { curbside: true } }],
    }));

    const items = [
      { query: "whole milk", products: [...distractors, milk] },
      { query: "whole milk", products: [...distractors, candy] },
      ...otherProducts.map((product) => ({
        query: product.description,
        products: [...distractors, product],
      })),
    ].map((item, index) => Object.assign({}, item, { requestId: `item_${index}` }));

    const response = await worker.fetch("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        forPickup: true,
      }),
    });

    /** @type {unknown} */
    const payload = await response.json();
    const errorBody = z.object({ error: z.string() }).safeParse(payload);
    assert(response.ok, errorBody.success ? errorBody.data.error : `HTTP ${response.status}`);
    const body = z.array(selectionSchema).parse(payload);
    const [selected, rejected] = body;
    assert(
      selected.status === "selected" && selected.product.upc === milk.upc,
      "Expected Jev to select Whole Milk over candy.",
    );
    assert(
      rejected.status === "unresolved",
      "Expected Jev to abstain when only candy is available.",
    );
    assert(body.length === items.length, "Expected one result per requested item.");

    for (const [index, product] of otherProducts.entries()) {
      const selection = body[index + 2];
      assert(
        selection.status === "selected" && selection.product.upc === product.upc,
        `Expected Jev to select ${product.description}.`,
      );
    }

    console.log(
      "Live batched Jev passed: 10 items × 20 candidates in one call; all 9 correct products selected and candy-only shortlist rejected. No cart or shopping-list writes.",
    );
  } finally {
    await worker?.stop();
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Live Jev failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
