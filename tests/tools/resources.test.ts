import { describe, expect, it } from "vitest";

import { toonResource, toonResult } from "../../src/utils/toon.js";

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

describe("toonResult", () => {
  it("returns a content array (not contents) with exactly one item", () => {
    const result = toonResult({ message: "hello" });

    expect(result).toHaveProperty("content");
    expect(result).not.toHaveProperty("contents");
    expect(result.content).toHaveLength(1);
  });

  it("item has type: text and a TOON-encoded text property", () => {
    const result = toonResult({ message: "hello" });
    const item = result.content[0];

    expect(item).toBeDefined();
    expect(item?.type).toBe("text");
    expect(typeof item?.text).toBe("string");
    expect(item?.text.length).toBeGreaterThan(0);
  });

  it("item does not include uri or mimeType fields", () => {
    const result = toonResult({ message: "hello" });
    const item = result.content[0] as Record<string, unknown>;

    expect(item).not.toHaveProperty("uri");
    expect(item).not.toHaveProperty("mimeType");
  });

  it("correctly encodes uniform item arrays into TOON compact format", () => {
    const result = toonResult({
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

    expect(result.content[0]?.text).toContain("items[2]{productName,quantity,addedAt,expiresAt}:");
    expect(result.content[0]?.text).toContain(
      '  Milk,1,"2026-06-01T00:00:00.000Z","2026-06-08T00:00:00.000Z"',
    );
  });

  it("produces the same TOON encoding as toonResource for the same data", () => {
    const data = {
      items: [
        { name: "Bread", count: 1 },
        { name: "Butter", count: 2 },
      ],
    };

    const resourceResult = toonResource("shopping://user/shopping-list", data);
    const toolResult = toonResult(data);

    expect(toolResult.content[0]?.text).toBe(resourceResult.contents[0]?.text);
  });
});
