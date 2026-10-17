import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(import.meta.url);

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const cfBin = join(dirname(require.resolve("cf/package.json")), "bin/cf");

/**
 * Start an isolated evaluation Worker using the project's installed cf CLI.
 * @param {URL} entrypoint
 * @param {{ remoteAi?: boolean }} options
 */
export async function startCfWorker(entrypoint, { remoteAi = true } = {}) {
  const parent = join(projectRoot, ".cloudflare/evals");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "worker-"));

  try {
    await symlink(join(projectRoot, "node_modules"), join(directory, "node_modules"), "dir");
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        devDependencies: { "@cloudflare/vite-plugin": "*" },
      }),
    );
    await writeFile(
      join(directory, "cloudflare.config.ts"),
      `import { bindings, defineConfig } from "cf/config";
import * as entrypoint from ${JSON.stringify(fileURLToPath(entrypoint))} with { type: "cf-worker" };
export default defineConfig({ worker: {
  name: "selector-eval",
  compatibilityDate: "2025-03-10",
  entrypoint,
  env: ${remoteAi ? "{ AI: bindings.ai({ dev: { remote: true } }) }" : "{}"},
} });
`,
    );
    await writeFile(
      join(directory, "vite.config.ts"),
      `import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [cloudflare({ persistState: false, inspectorPort: false, types: { generate: false } })],
  publicDir: false,
  server: { host: "127.0.0.1", port: 0, watch: null },
});
`,
    );

    const child = spawn(process.execPath, [cfBin, "dev"], {
      cwd: directory,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const exited = new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", resolve);
    });

    /** @param {NodeJS.Signals} signal */
    const kill = (signal) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        process.kill(-child.pid, signal);
      }
    };

    const stop = async () => {
      const timeout = setTimeout(() => kill("SIGKILL"), 5_000);

      try {
        kill("SIGTERM");
        await exited;
      } finally {
        clearTimeout(timeout);
        await rm(directory, { recursive: true, force: true });
      }
    };

    let origin = "";

    try {
      origin = await new Promise((resolve, reject) => {
        let output = "";

        const timeout = setTimeout(() => {
          reject(new Error(`cf dev did not become ready within 60 seconds.\n${output}`));
        }, 60_000);

        /** @param {Buffer} chunk */
        function onOutput(chunk) {
          output = (output + chunk.toString()).slice(-16_000);
          const match = /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output);

          if (match) {
            clearTimeout(timeout);
            resolve(match[1]);
          }
        }

        child.stdout.on("data", onOutput);
        child.stderr.on("data", onOutput);
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          reject(
            new Error(
              `cf dev exited (${String(signal ?? code)}) before becoming ready.\n${output}`,
            ),
          );
        });
      });
    } catch (error) {
      await stop();
      throw error;
    }

    return {
      /** @param {string} input
       * @param {RequestInit} [init]
       */
      fetch(input, init) {
        const url = new URL(input);

        return fetch(new URL(url.pathname + url.search, origin), init);
      },
      stop,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
