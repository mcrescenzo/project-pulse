import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { hubHandoffLines } from "../src/cli-main";
import { buildPortfolioHtml } from "../src/dashboard-html";
import { RoadmapService } from "../src/store";
import { spawnCli, sleep } from "./helpers/cli";

let tempRoot: string;
let stateDir: string;
let stubDir: string;
let openedLog: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "pp-v21-handoff-"));
  stateDir = join(tempRoot, "state");
  stubDir = join(tempRoot, "bin");
  openedLog = join(tempRoot, "opened.log");
  mkdirSync(stateDir);
  mkdirSync(stubDir);
  // Stand-in browser openers that record the URL instead of launching anything.
  for (const name of ["xdg-open", "open"]) {
    const path = join(stubDir, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${openedLog}"\n`);
    chmodSync(path, 0o755);
  }
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeRepo(name: string): string {
  const dir = join(tempRoot, name);
  mkdirSync(dir);
  const svc = new RoadmapService(dir);
  svc.init({ name, summary: "" });
  svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
  svc.addFeature({ id: "f1", title: "F1", milestone: "m1" });
  return dir;
}

async function readUntil(stream: ReadableStream<Uint8Array>, marker: string): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (!out.includes(marker)) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    out += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return out;
}

async function waitForOpened(count: number): Promise<string[]> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (existsSync(openedLog)) {
      const lines = readFileSync(openedLog, "utf8").split("\n").filter(Boolean);
      if (lines.length >= count) return lines;
    }
    await sleep(50);
  }
  return existsSync(openedLog) ? readFileSync(openedLog, "utf8").split("\n").filter(Boolean) : [];
}

describe("pp view hub handoff", () => {
  test("handoff lines: auto-open prints no token; --no-open prints the whole URL on its own line", () => {
    const base = { url: "http://127.0.0.1:4310/p/app", overviewUrl: `http://127.0.0.1:4310/?t=${"a".repeat(64)}`, ownerPid: 42 };
    expect(hubHandoffLines({ ...base, mode: "started" }, { autoOpen: true })).toEqual([
      "Dashboard: http://127.0.0.1:4310/p/app",
      "Hub runs in this terminal (PID 42); Ctrl-C stops all project dashboards.",
    ]);
    expect(hubHandoffLines({ ...base, mode: "joined" }, { autoOpen: true })).toEqual([
      "Dashboard: http://127.0.0.1:4310/p/app",
      "Joined the hub owned by PID 42; Ctrl-C in that terminal stops all project dashboards.",
    ]);
    const noOpen = hubHandoffLines({ ...base, mode: "started" }, { autoOpen: false });
    expect(noOpen[2]).toBe(base.overviewUrl);
    expect(noOpen.filter((l) => l.includes("?t="))).toEqual([base.overviewUrl]);
  });

  test.skipIf(process.platform === "win32")(
    "auto-open start and join print no access token, hand the tokenized link to the browser, and state ownership",
    async () => {
      const env = { PROJECT_PULSE_HOME: stateDir, PATH: `${stubDir}${delimiter}${process.env.PATH ?? ""}` };
      const repoA = makeRepo("alpha");
      const repoB = makeRepo("beta");
      const start = spawnCli(["view", "--root", repoA, "--port", "0"], { env });
      try {
        const startOut = await readUntil(start.stdout, "Ctrl-C stops all project dashboards.");
        const token = readFileSync(join(stateDir, "access-token"), "utf8").trim();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(startOut).not.toContain(token);
        expect(startOut).not.toContain("?t=");
        const address = startOut.split("\n").find((l) => l.startsWith("Dashboard: "))!;
        expect(address).toMatch(/^Dashboard: http:\/\/127\.0\.0\.1:\d+\/p\/alpha$/);
        expect(startOut).toContain(`Hub runs in this terminal (PID ${start.child.pid}); Ctrl-C stops all project dashboards.`);
        const port = new URL(address.slice("Dashboard: ".length)).port;

        const joiner = spawnCli(["view", "--root", repoB, "--port", port], { env });
        const [joinOut, joinCode] = await Promise.all([new Response(joiner.stdout).text(), joiner.exited]);
        expect(joinCode).toBe(0);
        expect(joinOut).not.toContain(token);
        expect(joinOut.split("\n")).toEqual([
          `Dashboard: http://127.0.0.1:${port}/p/beta`,
          `Joined the hub owned by PID ${start.child.pid}; Ctrl-C in that terminal stops all project dashboards.`,
          "",
        ]);

        const opened = await waitForOpened(2);
        expect(opened).toEqual([
          `http://127.0.0.1:${port}/p/alpha?t=${token}`,
          `http://127.0.0.1:${port}/p/beta?t=${token}`,
        ]);
      } finally {
        start.kill("SIGTERM");
        await start.exited;
      }
    },
    20_000
  );

  test("the hub home page names the owning PID and what Ctrl-C does", () => {
    const html = buildPortfolioHtml({ ownerPid: 4242 });
    expect(html).toContain(
      'Hub process <span class="mono">PID 4242</span>. The hub runs in the terminal that started it. Ctrl-C in that terminal stops all project dashboards.'
    );
  });
});
