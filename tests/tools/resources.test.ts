import { describe, expect, it } from "vitest";

import * as resources from "../../src/tools/resources.js";

type TextResourceContent = {
  type: "text";
  uri: string;
  mimeType?: string;
  text: string;
};

type TextResourceResult = {
  contents: TextResourceContent[];
};

type ResourceFormatter = (uri: string, data: unknown) => TextResourceResult;

function getResourceFormatter(name: string): ResourceFormatter {
  const exportedValue = (resources as Record<string, unknown>)[name];
  expect(exportedValue).toBeTypeOf("function");
  return exportedValue as ResourceFormatter;
}

describe("toonResource", () => {
  it("serializes uniform item arrays as TOON text resources", () => {
    const toonResource = getResourceFormatter("toonResource");

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
