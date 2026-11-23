import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHubServer, type HubServerHandle } from "../src/hub";
import { accessCookieName } from "../src/http-security";
import { RoadmapService } from "../src/store";
import { authFetch } from "./helpers/auth";

/**
 * Rotation contract (README.md / SECURITY.md): dashboard servers capture the access token once at
 * startup (hub.ts `startHubServer`, cli.ts standalone `pp view`), so deleting the persisted token
 * file rotates nothing until every dashboard process is stopped and restarted. Everything here
 * runs against synthetic temp dirs (PROJECT_PULSE_HOME override, dynamic ports) — never a
 * production token or home directory.
 */

let tempRoot: string;
let stateDir: string;
let hub: HubServerHandle | null = null;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "project-pulse-v05-rot-"));
  stateDir = join(tempRoot, "state");
});

afterEach(() => {
  if (hub) {
    hub.stop();
    hub = null;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

const tokenPath = () => join(stateDir, "access-token");

interface StoppableProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill: () => void;
  exited: Promise<unknown>;
}

/**
 * Reads stdout until the `pp view` listening line arrives, killing the process when the deadline
 * passes so a wedged launch fails the test instead of hanging the suite.
 *
 * The wait itself is on the child's real stdout stream (`reader.read()`); the setTimeout is only a
 * deadline watchdog against an external subprocess, whose output no fake clock can produce.
 */
async function waitForListeningUrl(proc: StoppableProcess, timeoutMs = 15000): Promise<string> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    while (!text.includes("listening at")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
  }
  const match = text.match(/listening at (\S+)/);
  if (!match) {
    proc.kill();
    await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `pp view printed no listening URL within ${timeoutMs}ms.\nstdout: ${text}\nstderr: ${stderr}`
    );
  }
  return match[1]!;
}

describe("v0.5 access-token rotation (stop → delete file → restart)", () => {
  test("hub: deleting the token file under a running server rotates nothing; a restart issues a fresh token", async () => {
    const repo = join(tempRoot, "repo");
    new RoadmapService(repo).init({ name: "Rotation Hub" });

    // Startup: the hub loads (and creates) the persisted token once.
    const first = startHubServer({ port: 0, stateDir });
    hub = first;
    const oldToken = first.accessToken;
    expect(oldToken).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(tokenPath(), "utf8").trim()).toBe(oldToken);
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);

    // Before restart: the running hub keeps serving with its in-memory token even though the
    // persisted file is gone — header requests, session cookies, and ?t= exchanges all still work.
    rmSync(tokenPath());
    expect(existsSync(tokenPath())).toBe(false);
    expect((await authFetch(oldToken)(`${first.url}/`)).status).toBe(200);
    expect((await authFetch(oldToken)(`${first.url}/api/hub/projects`)).status).toBe(200);
    expect(
      (await fetch(`${first.url}/`, { headers: { cookie: `${accessCookieName(first.port)}=${oldToken}` } }))
        .status
    ).toBe(200);
    const landing = await fetch(first.openUrl, { redirect: "manual" });
    expect(landing.status).toBe(302);
    expect(landing.headers.get("set-cookie")).toContain(oldToken);
    // Redirect target is the clean path: the token appears in the cookie, never in the Location.
    expect(landing.headers.get("location")).toBe("/");
    // Nothing regenerated the file behind the server's back, and foreign tokens stay rejected.
    expect(existsSync(tokenPath())).toBe(false);
    expect(
      (await fetch(`${first.url}/`, { headers: { "x-pp-access-token": "f".repeat(64) } })).status
    ).toBe(401);

    // Rotation: stop the hub, then start again against the same state dir.
    first.stop();
    hub = null;
    const second = startHubServer({ port: 0, stateDir });
    hub = second;
    const newToken = second.accessToken;
    expect(newToken).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken).not.toBe(oldToken);

    // After restart: a fresh token is persisted 0600 and authorized; the old one is dead everywhere.
    expect(readFileSync(tokenPath(), "utf8").trim()).toBe(newToken);
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
    expect((await authFetch(newToken)(`${second.url}/`)).status).toBe(200);
    expect((await authFetch(oldToken)(`${second.url}/`)).status).toBe(401);
    const newCookieName = accessCookieName(second.port);
    expect(
      (await fetch(`${second.url}/`, { headers: { cookie: `${newCookieName}=${oldToken}` } })).status
    ).toBe(401); // pre-rotation session cookies no longer authenticate
    expect(
      (await fetch(`${second.url}/`, { headers: { cookie: `${newCookieName}=${newToken}` } })).status
    ).toBe(200); // the fresh ?t= link exchanges for a working session
    const staleLanding = new URL(second.openUrl);
    staleLanding.searchParams.set("t", oldToken);
    expect((await fetch(staleLanding, { redirect: "manual" })).status).toBe(401); // old ?t= links stop working
    const freshLanding = await fetch(second.openUrl, { redirect: "manual" });
    expect(freshLanding.status).toBe(302);
    expect(freshLanding.headers.get("set-cookie")).toContain(newToken);
    expect(freshLanding.headers.get("location")).toBe("/");

    // Plain restart without deleting the file keeps the same token — rotation needs the delete.
    second.stop();
    hub = null;
    const third = startHubServer({ port: 0, stateDir });
    hub = third;
    expect(third.accessToken).toBe(newToken);
    expect(readFileSync(tokenPath(), "utf8").trim()).toBe(newToken);
  });

  test("standalone `pp view`: same contract end to end through the CLI with PROJECT_PULSE_HOME in a temp dir", async () => {
    const repo = join(tempRoot, "repo");
    new RoadmapService(repo).init({ name: "Rotation Standalone" });

    const spawnView = () =>
      Bun.spawn(
        [
          process.execPath,
          "run",
          join(import.meta.dir, "../src/cli.ts"),
          "view",
          "--standalone",
          "--port",
          "0",
          "--no-open",
          "--root",
          repo,
        ],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, PROJECT_PULSE_HOME: stateDir } }
      );

    const proc1 = spawnView();
    const url1 = await waitForListeningUrl(proc1);
    const oldToken = new URL(url1).searchParams.get("t")!;
    expect(oldToken).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(tokenPath(), "utf8").trim()).toBe(oldToken);
    const base1 = new URL(url1).origin;
    expect((await authFetch(oldToken)(base1)).status).toBe(200);

    // Deleting the persisted file under the running CLI process rotates nothing.
    rmSync(tokenPath());
    expect((await authFetch(oldToken)(base1)).status).toBe(200);

    proc1.kill();
    await proc1.exited;

    // Restarting with the token file absent mints and persists a fresh token.
    const proc2 = spawnView();
    try {
      const url2 = await waitForListeningUrl(proc2);
      const newToken = new URL(url2).searchParams.get("t")!;
      expect(newToken).toMatch(/^[0-9a-f]{64}$/);
      expect(newToken).not.toBe(oldToken);
      expect(readFileSync(tokenPath(), "utf8").trim()).toBe(newToken);
      const base2 = new URL(url2).origin;
      expect((await authFetch(newToken)(base2)).status).toBe(200);
      expect((await authFetch(oldToken)(base2)).status).toBe(401);
      const landing = await fetch(url2, { redirect: "manual" });
      expect(landing.status).toBe(302); // the new ?t= link exchanges for a cookie
      expect(landing.headers.get("set-cookie")).toContain(newToken);
      expect(landing.headers.get("location")).toBe("/");
    } finally {
      proc2.kill();
      await proc2.exited;
    }
  });
});
