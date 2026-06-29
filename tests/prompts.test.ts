import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { describe, expect, it, beforeEach } from "vitest";

import { registerPrompts } from "../src/prompts.js";

type PromptArgs = Record<string, string | undefined>;

type PromptMessage = {
  role: string;
  content: { type: string; text: string };
};

type PromptResult = {
  messages: PromptMessage[];
};

type PromptHandler = (args: PromptArgs) => PromptResult | Promise<PromptResult>;

type CapturedPrompt = {
  name: string;
  config: {
    title?: string;
    description?: string;
    argsSchema?: Record<string, unknown>;
  };
  handler: PromptHandler;
};

const capturedPrompts: CapturedPrompt[] = [];

function makeServer(): McpServer {
  return {
    registerPrompt: (name: string, config: CapturedPrompt["config"], handler: PromptHandler) => {
      capturedPrompts.push({ name, config, handler });
    },
  } as unknown as McpServer;
}

function getPrompt(name: string): CapturedPrompt {
  const prompt = capturedPrompts.find((p) => p.name === name);
  expect(prompt).toBeDefined();
  return prompt as CapturedPrompt;
}

async function callPrompt(name: string, args: PromptArgs = {}): Promise<PromptResult> {
  return await getPrompt(name).handler(args);
}

function getText(result: PromptResult): string {
  return result.messages[0]?.content.text ?? "";
}

describe("registerPrompts", () => {
  beforeEach(() => {
    capturedPrompts.length = 0;
    registerPrompts(makeServer());
  });

  it("registers exactly 3 prompts", () => {
    expect(capturedPrompts).toHaveLength(3);
  });

  it("registers grocery-list-store_path, set_preferred_store, and add_recipe_to_cart", () => {
    const names = capturedPrompts.map((p) => p.name);
    expect(names).toContain("grocery-list-store_path");
    expect(names).toContain("set_preferred_store");
    expect(names).toContain("add_recipe_to_cart");
  });

  describe("grocery-list-store_path", () => {
    it("includes the grocery list text when grocery_list is provided", async () => {
      const result = await callPrompt("grocery-list-store_path", {
        grocery_list: "Milk, Eggs, Bread",
      });
      const text = getText(result);
      expect(text).toContain("Milk, Eggs, Bread");
    });

    it("includes the DO NOT add items instruction when grocery_list is provided", async () => {
      const result = await callPrompt("grocery-list-store_path", {
        grocery_list: "Apples",
      });
      const text = getText(result);
      expect(text).toContain("DO NOT add items to my cart");
    });

    it("returns fallback message about checking pantry/order history when grocery_list is omitted", async () => {
      const result = await callPrompt("grocery-list-store_path", {});
      const text = getText(result);
      expect(text).toContain("check my pantry, order history");
      expect(text).not.toContain("I have the following grocery list");
    });

    it("fallback message also includes the DO NOT add items instruction", async () => {
      const result = await callPrompt("grocery-list-store_path", {});
      const text = getText(result);
      expect(text).toContain("DO NOT add items to my cart");
    });

    it("returns a single user message", async () => {
      const result = await callPrompt("grocery-list-store_path", {});
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.role).toBe("user");
      expect(result.messages[0]?.content.type).toBe("text");
    });
  });

  describe("set_preferred_store", () => {
    it("includes the zip code in the message when zip_code is provided", async () => {
      const result = await callPrompt("set_preferred_store", { zip_code: "98101" });
      const text = getText(result);
      expect(text).toContain("98101");
      expect(text).toContain("Search for stores near zip code: 98101");
    });

    it("uses the generic 'near my area' fallback when zip_code is not provided", async () => {
      const result = await callPrompt("set_preferred_store", {});
      const text = getText(result);
      expect(text).toContain("Search for stores near my area");
      expect(text).not.toContain("zip code:");
    });

    it("returns a single user message", async () => {
      const result = await callPrompt("set_preferred_store", {});
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.role).toBe("user");
      expect(result.messages[0]?.content.type).toBe("text");
    });

    it("argsSchema rejects zip_code values that are not exactly 5 characters", () => {
      const prompt = getPrompt("set_preferred_store");
      const schema = prompt.config.argsSchema as Record<
        string,
        { safeParse: (v: unknown) => { success: boolean } }
      >;
      expect(schema.zip_code.safeParse("1234").success).toBe(false);
      expect(schema.zip_code.safeParse("123456").success).toBe(false);
      expect(schema.zip_code.safeParse("12345").success).toBe(true);
    });
  });

  describe("add_recipe_to_cart", () => {
    it("interpolates the recipe type into the message twice when recipe_type is provided", async () => {
      const result = await callPrompt("add_recipe_to_cart", { recipe_type: "chocolate cake" });
      const text = getText(result);
      const occurrences = text.split("chocolate cake").length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    });

    it("argsSchema defaults recipe_type to 'classic apple pie' when not provided", () => {
      const prompt = getPrompt("add_recipe_to_cart");
      const schema = prompt.config.argsSchema as Record<string, { parse: (v: unknown) => string }>;
      // The Zod schema carries the default; the MCP framework applies it before invoking the handler.
      const applied = schema.recipe_type.parse(undefined);
      expect(applied).toBe("classic apple pie");
    });

    it("uses 'classic apple pie' in message when handler receives the schema-applied default", async () => {
      const result = await callPrompt("add_recipe_to_cart", { recipe_type: "classic apple pie" });
      const text = getText(result);
      expect(text).toContain("classic apple pie");
    });

    it("returns a single user message", async () => {
      const result = await callPrompt("add_recipe_to_cart", { recipe_type: "lasagna" });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.role).toBe("user");
      expect(result.messages[0]?.content.type).toBe("text");
    });
  });
});
