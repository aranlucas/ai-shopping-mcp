import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

const portlessUrl = process.env.PORTLESS_URL ? new URL(process.env.PORTLESS_URL) : undefined;

export default defineConfig({
  plugins: [cloudflare()],
  publicDir: "dist/views",
  resolve: { tsconfigPaths: true },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 8788),
    ...(portlessUrl && {
      allowedHosts: [portlessUrl.hostname],
      origin: portlessUrl.origin,
    }),
  },
});
