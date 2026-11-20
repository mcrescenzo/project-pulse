import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { joinOrStartHub, startHubServer, type HubServerHandle } from "../src/hub";
import { RoadmapService } from "../src/store";
import { resolveChromiumExecutable } from "./helpers/chromium";
import { authFetch } from "./helpers/auth";

const CHROMIUM_PATH = resolveChromiumExecutable();
const testUi = CHROMIUM_PATH ? test : test.skip;

let tempRoot: string;
let stateDir: string;
let hub: HubServerHandle | null = null;
let browser: Browser | null = null;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "project-pulse-hub-"));
  stateDir = join(tempRoot, "state");
});

afterEach(async () => {
  if (browser) {
    await browser.close();
    browser = null;
  }
  if (hub) {
    hub.stop();
    hub = null;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

async function readSseUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedEvent: string,
  timeoutMs = 5000
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
      setTimeout(() => resolve({ done: true }), Math.max(50, deadline - Date.now()))
    );
    const chunk = await Promise.race([reader.read(), timeoutPromise]);
    if (chunk.done || !chunk.value) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    if (buffer.includes(`event: ${expectedEvent}`)) {
      return buffer;
    }
  }
  return buffer;
}

function makeRepo(nameDir: string, projectName: string, featureId: string): string {
  const repoDir = join(tempRoot, nameDir);
  mkdirSync(repoDir, { recursive: true });
  const svc = new RoadmapService(repoDir);
  svc.init({ name: projectName, summary: `${projectName} roadmap summary.` });
  svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active" });
  svc.addFeature({ id: featureId, title: `${projectName} Feature`, milestone: "v0.1" });
  return repoDir;
}

describe("v0.3 Auto-Joining Multi-Project Local Hub", () => {
  test("hosts multiple repos under /p/<slug> with slug dedupe, isolated SSE, token auth, and stale pruning", async () => {
    const repoA = makeRepo("alpha-repo", "Alpha Project", "alpha-feat");
    const repoB = makeRepo("beta-repo", "Beta Project", "beta-feat");
    const nestedDuplicateDir = join(tempRoot, "nested", "alpha-repo");
    const repoA2 = makeRepo(join("nested", "alpha-repo"), "Second Alpha", "alpha2-feat");

    hub = startHubServer({ port: 0, stateDir });
    const api = authFetch(hub.accessToken);

    // Token, access-token, and registry files created with restrictive permissions (state dir 0700)
    const hubLockPath = join(stateDir, "hub.json");
    expect(existsSync(hubLockPath)).toBe(true);
    expect(statSync(hubLockPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateDir, "access-token")).mode & 0o777).toBe(0o600);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);

    // Portfolio, project list, and project dashboards require the access token
    expect((await fetch(`${hub.url}/`)).status).toBe(401);
    expect((await fetch(`${hub.url}/api/hub/projects`)).status).toBe(401);
    // Health probe stays public for hub discovery, but a foreign Host is rejected (DNS rebinding)
    expect((await fetch(`${hub.url}/api/hub/health`)).status).toBe(200);
    expect(
      (await fetch(`${hub.url}/api/hub/health`, { headers: { Host: "attacker.example" } })).status
    ).toBe(403);

    // Registration rejects missing or bad token
    const noToken = await fetch(`${hub.url}/api/hub/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootDir: repoA }),
    });
    expect(noToken.status).toBe(401);

    const badToken = await fetch(`${hub.url}/api/hub/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PP-Hub-Token": "wrong-token" },
      body: JSON.stringify({ rootDir: repoA }),
    });
    expect(badToken.status).toBe(403);

    // Register via joinOrStartHub against already-running hub
    const joinA = await joinOrStartHub(repoA, { port: hub.port, stateDir });
    expect(joinA.mode).toBe("joined");
    expect(joinA.slug).toBe("alpha-repo");
    expect(joinA.url).toBe(`http://127.0.0.1:${hub.port}/p/alpha-repo`);
    expect(joinA.openUrl).toBe(`http://127.0.0.1:${hub.port}/p/alpha-repo?t=${hub.accessToken}`);
    expect((await fetch(`${hub.url}/p/alpha-repo/api/roadmap`)).status).toBe(401);
    expect(statSync(join(stateDir, "projects.json")).mode & 0o777).toBe(0o600);

    const joinB = await joinOrStartHub(repoB, { port: hub.port, stateDir });
    expect(joinB.mode).toBe("joined");
    expect(joinB.slug).toBe("beta-repo");

    // Duplicate basename disambiguates slug automatically
    const joinA2 = await joinOrStartHub(repoA2, { port: hub.port, stateDir });
    expect(joinA2.slug).toBe("alpha-repo-2");

    // Re-registering repoA is idempotent
    const joinAAgain = await joinOrStartHub(repoA, { port: hub.port, stateDir });
    expect(joinAAgain.slug).toBe("alpha-repo");

    // Per-project APIs return independent roadmaps
    const roadA = await (await api(`${hub.url}/p/alpha-repo/api/roadmap`)).json();
    const roadB = await (await api(`${hub.url}/p/beta-repo/api/roadmap`)).json();
    expect(roadA.config.project.name).toBe("Alpha Project");
    expect(roadB.config.project.name).toBe("Beta Project");

    // Isolated SSE streams: mutating Alpha emits reload ONLY on Alpha's SSE stream, not Beta's
    const sseA = await api(`${hub.url}/p/alpha-repo/api/events`);
    const sseB = await api(`${hub.url}/p/beta-repo/api/events`);
    const readerA = sseA.body!.getReader();
    const readerB = sseB.body!.getReader();

    new RoadmapService(repoA).addFeatureNote("alpha-feat", "Alpha update");
    const [outA, outB] = await Promise.all([
      readSseUntilEvent(readerA, "reload", 5000),
      readSseUntilEvent(readerB, "reload", 400),
    ]);
    expect(outA).toContain("event: reload");
    expect(outB).not.toContain("event: reload");
    await readerA.cancel();
    await readerB.cancel();

    // Stale-path cleanup removes deleted repo from /api/hub/projects & projects.json
    rmSync(nestedDuplicateDir, { recursive: true, force: true });
    const listAfterDelete = await (await api(`${hub.url}/api/hub/projects`)).json();
    expect(listAfterDelete.projects.map((p: { slug: string }) => p.slug).sort()).toEqual([
      "alpha-repo",
      "beta-repo",
    ]);
    const savedRegistry = JSON.parse(readFileSync(join(stateDir, "projects.json"), "utf8"));
    expect(savedRegistry.projects).toHaveLength(2);
  });

  testUi("renders portfolio overview and switches between hub projects in browser", async () => {
    const repoA = makeRepo("alpha-ui", "Alpha UI", "alpha-feat");
    const repoB = makeRepo("beta-ui", "Beta UI", "beta-feat");

    const started = await joinOrStartHub(repoA, { port: 0, stateDir });
    expect(started.mode).toBe("started");
    if (started.mode === "started") {
      hub = started.handle;
    }
    await joinOrStartHub(repoB, { port: hub!.port, stateDir });

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });

      // 1. Portfolio overview page lists both repositories
      await page.goto(hub!.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector('.project-card[data-project-slug="alpha-ui"]');
      await page.waitForSelector('.project-card[data-project-slug="beta-ui"]');

      // 2. Click Open Dashboard on Alpha UI
      await page.locator('.project-card[data-project-slug="alpha-ui"] .btn-open').click();
      await page.waitForSelector('.card[data-feature-id="alpha-feat"]');
      expect(await page.locator("#project-name").textContent()).toBe("Alpha UI");

      // 3. Switch to Beta UI using header project switcher
      await page.waitForFunction(() => {
        const sel = document.getElementById("project-switcher") as HTMLSelectElement | null;
        return sel && sel.options.length >= 2;
      });
      await page.locator("#project-switcher").selectOption("/p/beta-ui");
      await page.waitForSelector('.card[data-feature-id="beta-feat"]');
      expect(await page.locator("#project-name").textContent()).toBe("Beta UI");

      expect(consoleErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("CLI pp view joins running hub and --standalone runs isolated server", async () => {
    const repoA = makeRepo("cli-hub-a", "CLI Hub A", "feat-a");
    const repoB = makeRepo("cli-standalone", "CLI Standalone", "feat-b");

    hub = startHubServer({ port: 0, stateDir });
    const cliPath = join(import.meta.dir, "../src/cli.ts");

    // 1. CLI pp view auto-joins running hub and exits 0 immediately
    const joinProc = Bun.spawn(
      [process.execPath, "run", cliPath, "view", "--root", repoA, "--port", String(hub.port), "--no-open"],
      {
        env: { ...process.env, PROJECT_PULSE_HOME: stateDir },
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const [joinOut, joinErr, joinCode] = await Promise.all([
      new Response(joinProc.stdout).text(),
      new Response(joinProc.stderr).text(),
      joinProc.exited,
    ]);
    expect(joinErr).toBe("");
    expect(joinCode).toBe(0);
    expect(joinOut).toContain(
      `Joined Project Pulse hub at http://127.0.0.1:${hub.port}/p/cli-hub-a?t=${hub.accessToken}`
    );

    // 2. CLI pp view --standalone starts isolated server cleanly even with --port
    const standaloneProc = Bun.spawn(
      [process.execPath, "run", cliPath, "view", "--root", repoB, "--standalone", "--port", "0", "--no-open"],
      {
        env: { ...process.env, PROJECT_PULSE_HOME: stateDir },
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const reader = standaloneProc.stdout.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (!out.includes("Project Pulse dashboard listening at ")) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      out += decoder.decode(value, { stream: true });
    }
    const urlMatch = out.match(/(http:\/\/127\.0\.0\.1:\d+)\/\?t=([0-9a-f]{64})/);
    expect(urlMatch).not.toBeNull();
    // Standalone mode uses the persistent access token from PROJECT_PULSE_HOME
    expect(urlMatch![2]).toBe(readFileSync(join(stateDir, "access-token"), "utf8").trim());
    const apiData = await (await authFetch(urlMatch![2]!)(`${urlMatch![1]}/api/roadmap`)).json();
    expect(apiData.config.project.name).toBe("CLI Standalone");

    await reader.cancel();
    standaloneProc.kill("SIGTERM");
    expect(await standaloneProc.exited).toBe(0);
  });
});
