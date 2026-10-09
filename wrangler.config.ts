import { defineWranglerConfig } from "wrangler/experimental-config";

const portlessUrl = process.env.PORTLESS_URL
  ? new URL(process.env.PORTLESS_URL)
  : undefined;

export default defineWranglerConfig({
  build: {
    command: "pnpm build:views",
  },
  dev: {
    port: Number(process.env.PORT ?? 8788),
    ...(portlessUrl && {
      host: portlessUrl.host,
      upstreamProtocol: portlessUrl.protocol === "https:" ? "https" : "http",
    }),
  },
  types: {
    generate: false,
  },
  assetsDirectory: "./dist/views",
});
