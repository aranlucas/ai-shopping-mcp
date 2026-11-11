import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

export default {
  tests: ["test/e2e/**/*.e2e.ts"],
  targets: [
    {
      name: "preview",
      engine: web(),
      app: {
        url: "http://127.0.0.1:4173",
        command: {
          executable: "pnpm",
          args: [
            "exec",
            "vite",
            "--config",
            "vite.views.config.ts",
            "--host",
            "127.0.0.1",
            "--port",
            "4173",
            "--strictPort",
          ],
        },
      },
    },
  ],
  workers: 1,
  retries: 0,
  reporters: ["list", "junit"],
  trace: "retain-on-failure",
} satisfies E2EConfig;
