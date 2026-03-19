/**
 * Builds all View HTML files using Vite + vite-plugin-singlefile.
 * Each view in views/<name>/index.html becomes dist/views/<name>/index.html.
 *
 * Wrangler serves these via the ASSETS binding.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const viewsDir = join(import.meta.dirname, "..", "views");
const distDir = join(import.meta.dirname, "..", "dist", "views");

// Clean dist/views before rebuilding
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}

// Find all views with an index.html
const views = readdirSync(viewsDir).filter((name) => {
  const htmlPath = join(viewsDir, name, "index.html");
  return (
    name !== "shared" &&
    statSync(join(viewsDir, name)).isDirectory() &&
    existsSync(htmlPath)
  );
});

if (views.length === 0) {
  console.log("No views found to build.");
  process.exit(0);
}

console.log(`Building ${views.length} view(s): ${views.join(", ")}`);

for (const view of views) {
  const input = `${view}/index.html`;
  console.log(`  Building ${input}...`);
  execSync(`INPUT=${input} npx vite build --config vite.config.ts`, {
    cwd: join(import.meta.dirname, ".."),
    stdio: "inherit",
  });
}

console.log(`All views built to dist/views/`);
