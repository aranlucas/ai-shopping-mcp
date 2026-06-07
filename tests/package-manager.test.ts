import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
};

const pkg = packageJson as PackageJson;

describe("package manager", () => {
  it("uses pnpm as the project package manager", () => {
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });

  it("does not use npm or npx in package scripts", () => {
    expect(Object.values(pkg.scripts ?? {})).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\b(?:npm|npx)\b/)]),
    );
  });
});
