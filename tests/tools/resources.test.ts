import { describe, expect, it } from "vitest";

import { toonResource } from "../../src/utils/toon.js";

describe("toonResource", () => {
  it("serializes uniform item arrays as TOON text resources", () => {
    const result = toonResource("shopping://user/pantry", {
      itemCount: 2,
      items: [
        {
          productName: "Milk",
          quantity: 1,
          addedAt: "2026-06-01T00:00:00.000Z",
          expiresAt: "2026-06-08T00:00:00.000Z",
        },
        {
          productName: "Eggs",
          quantity: 12,
          addedAt: "2026-06-01T00:00:00.000Z",
          expiresAt: "2026-06-12T00:00:00.000Z",
        },
      ],
      lastUpdated: "2026-06-06T12:00:00.000Z",
    });

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toMatchObject({
      type: "text",
      uri: "shopping://user/pantry",
      mimeType: "text/toon",
    });
    expect(result.contents[0]?.text).toContain("items[2]{productName,quantity,addedAt,expiresAt}:");
    expect(result.contents[0]?.text).toContain(
      '  Milk,1,"2026-06-01T00:00:00.000Z","2026-06-08T00:00:00.000Z"',
    );
  });
});
