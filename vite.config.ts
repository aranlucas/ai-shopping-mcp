import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
  root: "views/",
  plugins: [tailwindcss(), react(), viteSingleFile()],
  resolve: {
    alias: {
      "@views": path.resolve(__dirname, "./views"),
      "@": path.resolve(__dirname, "views"),
    },
  },
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    rollupOptions: {
      input: path.resolve(__dirname, "views/mcp-app.html"),
    },
    outDir: path.resolve(__dirname, "dist/views"),
    emptyOutDir: true,
  },
});
