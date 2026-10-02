// Local, interactive Codex driver. The Worker uses fixtures, never a live cart.
// GET /pending shows the prompt/tool result. POST /action submits one action:
// {id, action: {type:"tool", name, arguments}} or {id, action: {type:"finish", answer, feedback}}.
// Each run keeps its transcript and standard vitest-evals report in a new directory.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { once } from "node:events";

await mkdir("eval-results", { recursive: true });
const directory = await mkdtemp(resolve("eval-results/codex-"));
const sourceFiles = [
  "src/tools/cart.ts",
  "src/composition.ts",
  "vitest.config.ts",
  "tests/evals/harness.ts",
  "tests/evals/agent.eval.test.ts",
  "tests/evals/agent/harness.ts",
  "tests/evals/agent/codex-harness.ts",
  "tests/evals/agent/tasks.ts",
  "tests/evals/agent/judges.ts",
  "scripts/eval-agent-codex.mjs",
];
const sources = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => {
      const source = await readFile(file);
      const destination = `${directory}/sources/${file}.txt`;
      await mkdir(resolve(destination, ".."), { recursive: true });
      await writeFile(destination, source);
      return [file, createHash("sha256").update(source).digest("hex")];
    }),
  ),
);
const run = {
  startedAt: new Date().toISOString(),
  model: "codex/session",
  gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  tasks: process.env.EVAL_TASKS?.split(",").filter(Boolean) ?? null,
  sources,
  nodeVersion: process.version,
};
await writeFile(`${directory}/run.json`, `${JSON.stringify(run, null, 2)}\n`);
let pending;

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function handle(request, response) {
  if (request.method === "GET" && request.url === "/pending") {
    json(response, 200, pending?.turn ?? null);
  } else if (request.method === "POST" && request.url === "/turn") {
    if (pending)
      return json(response, 409, { error: "A turn is already pending" });
    const turn = { ...(await readJson(request)), id: randomUUID() };
    await appendFile(
      `${directory}/transcript.jsonl`,
      `${JSON.stringify({ turn })}\n`,
    );
    pending = { turn, response };
    response.on("close", () => {
      if (pending?.response === response) pending = undefined;
    });
  } else if (request.method === "POST" && request.url === "/action") {
    const { id, action } = await readJson(request);
    if (!pending || pending.turn.id !== id) {
      return json(response, 409, { error: "No pending turn with that id" });
    }
    const claimed = pending;
    pending = undefined;
    const { response: workerResponse } = claimed;
    try {
      await appendFile(
        `${directory}/transcript.jsonl`,
        `${JSON.stringify({ id, action })}\n`,
      );
    } catch (error) {
      if (!workerResponse.destroyed) pending = claimed;
      throw error;
    }
    json(workerResponse, 200, action);
    json(response, 200, { accepted: id });
  } else {
    json(response, 404, { error: "Use GET /pending or POST /action" });
  }
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: String(error) });
    else response.end();
  });
});
server.requestTimeout = 0;
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
const driver = { url: `http://127.0.0.1:${port}`, directory };
await writeFile(
  `${directory}/driver.json`,
  `${JSON.stringify(driver, null, 2)}\n`,
);
console.log(`Codex eval driver: ${driver.url}\nRun directory: ${directory}`);

const child = spawn(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "tests/evals/agent.eval.test.ts",
    "--reporter=vitest-evals/reporter",
    "--reporter=json",
    `--outputFile.json=${directory}/agent-codex.json`,
  ],
  { env: { ...process.env, EVAL_CODEX_PORT: String(port) }, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
const [code, exitSignal] = await once(child, "exit");
server.closeAllConnections();
server.close();
process.exitCode = code ?? 1;
await writeFile(
  `${directory}/run.json`,
  `${JSON.stringify(
    {
      ...run,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      status: exitSignal ? "interrupted" : code === 0 ? "passed" : "failed",
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Report: ${directory}/agent-codex.json\nSummary: node scripts/eval-agent-summary.mjs ${directory}`,
);
