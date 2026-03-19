import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const INPUT = process.env.INPUT;
if (!INPUT) {
  throw new Error("INPUT environment variable is not set");
}

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
  root: "views/",
  plugins: [tailwindcss(), react(), viteSingleFile()],
  resolve: {
    alias: {
      "@views": path.resolve(__dirname, "./views"),
    },
  },
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    rollupOptions: {
      input: path.resolve(__dirname, "views", INPUT),
    },
    outDir: path.resolve(__dirname, "dist/views"),
    emptyOutDir: false,
  },
});
