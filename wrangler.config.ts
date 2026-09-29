import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  build: {
    command: "pnpm build:views",
  },
  dev: {
    port: 8788,
  },
  types: {
    generate: false,
  },
  assetsDirectory: "./dist/views",
});
