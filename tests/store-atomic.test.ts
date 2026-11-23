import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROADMAP_GENERATED_MARKER } from "../src/renderer";
import { caseCollisionEntry, RoadmapService } from "../src/store";
import { STORE_LOCK_FILE_NAME, withStoreLock } from "../src/store-lock";

const GENERATED_ROADMAP_HEADER = `${ROADMAP_GENERATED_MARKER} Do not edit manually. -->`;
const NOTE_COUNT = 12;
// Allow each child its 10s SQLite contention deadline plus process startup and teardown.
const CONCURRENT_CLI_TIMEOUT_MS = 20_000;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-atomic-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function pulseDir(): string {
  return join(tempDir, ".project-pulse");
}

function roadmapPath(): string {
  return join(tempDir, "ROADMAP.md");
}

function configPath(): string {
  return join(pulseDir(), "config.yaml");
}

function lockDbPath(): string {
  return join(pulseDir(), STORE_LOCK_FILE_NAME);
}

function initRepo(): RoadmapService {
  const service = new RoadmapService(tempDir);
  service.init({ name: "Atomic" });
  service.upsertMilestone({ id: "backlog", title: "Backlog" });
  return service;
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], env?: Record<string, string>): Promise<CliResult> {
  const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "../src/cli.ts"), ...args], {
    cwd: tempDir,
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : process.env,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

// Polls for a file an external subprocess creates; the awaited condition is a real
// cross-process filesystem signal, so deterministic fake timers cannot replace it.
async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${path}`);
    }
    await Bun.sleep(10);
  }
}

/** True when the host filesystem resolves differently-cased spellings to the same file. */
function isCaseInsensitivePath(dir: string): boolean {
  const probeName = `.tmp.caseprobe.${Date.now()}`;
  writeFileSync(join(dir, probeName), "");
  try {
    // Probe by uppercasing only the final filename; parent directories must stay untouched.
    return existsSync(join(dir, probeName.toUpperCase()));
  } finally {
    rmSync(join(dir, probeName), { force: true });
  }
}

describe("Store atomicity: cross-process locking, init guard, case collisions", () => {
  test("concurrent independent processes all retain their acknowledged notes exactly once", async () => {
    const service = initRepo();
    service.addFeature({ id: "f", title: "Feature F" });

    const results = await Promise.all(
      Array.from({ length: NOTE_COUNT }, (_, i) => runCli(["feature", "note", "f", `note-${i}`]))
    );
    // Acceptance: every acknowledged note is retained exactly once; an unsuccessful write must
    // fail as a retryable conflict, never as a silent drop.
    const acked = new Set<number>();
    for (const [i, result] of results.entries()) {
      if (result.code === 0) {
        acked.add(i);
      } else {
        expect(result.stderr, `note-${i} failed without a retryable conflict`).toMatch(/retry/i);
      }
    }
    expect(acked.size).toBeGreaterThan(0);

    const loaded = service.load();
    const feature = loaded.features.find((f) => f.id === "f");
    expect(feature).toBeDefined();
    const notes = feature!.updates.map((u) => u.note);
    expect(new Set(notes).size).toBe(notes.length);
    for (const i of acked) {
      expect(notes.filter((n) => n === `note-${i}`)).toHaveLength(1);
    }
    for (const i of results.keys()) {
      if (!acked.has(i)) expect(notes).not.toContain(`note-${i}`);
    }

    const check = service.check();
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
  }, CONCURRENT_CLI_TIMEOUT_MS);

  test("mixed concurrent mutations across all shared paths keep the store consistent", async () => {
    const service = initRepo();
    service.addFeature({ id: "f1", title: "Feature F1", ship_criteria: ["criterion one"] });

    const commands: string[][] = [
      ...[0, 1, 2, 3].map((i) => ["feature", "note", "f1", `storm-${i}`]),
      ...[0, 1, 2].map((i) => ["milestone", "update", "backlog", "--title", `Backlog v${i}`]),
      ...[0, 1, 2].map((i) => ["feature", "add", `storm-${i}`, "--title", `Storm ${i}`]),
      ["feature", "update", "f1", "--status", "in-progress"],
      ["feature", "check", "f1", "1"],
      ["feature", "check", "f1", "1", "--undone"],
      ...[0, 1].map(() => ["render"]),
      ["init"],
    ];

    const results = await Promise.all(commands.map((args) => runCli(args)));
    const acked = (i: number) => results[i]!.code === 0;
    for (const [i, result] of results.entries()) {
      if (result.code !== 0) {
        // Only a retryable lock conflict is an acceptable non-zero outcome.
        expect(result.stderr, `command ${JSON.stringify(commands[i])} failed unacceptably`).toMatch(
          /retry/i
        );
      }
    }

    const loaded = service.load();
    const stormNotes = loaded.features
      .find((f) => f.id === "f1")!
      .updates.map((u) => u.note);
    expect(new Set(stormNotes).size).toBe(stormNotes.length);
    for (const i of [0, 1, 2, 3]) {
      if (acked(i)) expect(stormNotes).toContain(`storm-${i}`);
    }

    const ids = loaded.features.map((f) => f.id);
    for (const i of [0, 1, 2]) {
      if (acked(7 + i)) expect(ids).toContain(`storm-${i}`);
    }

    const backlog = loaded.milestones.find((m) => m.id === "backlog")!;
    expect(backlog.title === "Backlog" || /^Backlog v[0-2]$/.test(backlog.title)).toBe(true);

    const check = service.check();
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
  }, CONCURRENT_CLI_TIMEOUT_MS);

  test("a live foreign holder yields a retryable conflict; a killed holder recovers automatically", async () => {
    const service = initRepo();
    service.addFeature({ id: "f", title: "Feature F" });

    const readyPath = join(tempDir, "lock-holder-ready");
    // Holder takes the same write transaction a pp process takes, then parks until killed.
    const holderCode = [
      `const { Database } = require("bun:sqlite");`,
      `const db = new Database(${JSON.stringify(lockDbPath())});`,
      `db.exec("PRAGMA busy_timeout = 25");`,
      `db.exec("BEGIN IMMEDIATE");`,
      `require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready");`,
      "Bun.sleepSync(30000);",
    ].join("\n");
    const holder = Bun.spawn([process.execPath, "-e", holderCode], {
      cwd: tempDir,
      stdout: "ignore",
      stderr: "ignore",
    });
    await waitForFile(readyPath, 5000);

    // Contention: a real note command fails as a retryable conflict while the foreign process
    // holds the write lock, and nothing is written.
    const conflicting = await runCli(["feature", "note", "f", "never acknowledged"], {
      PP_LOCK_TIMEOUT_MS: "250",
    });
    expect(conflicting.code).not.toBe(0);
    expect(conflicting.stderr).toMatch(/retry/i);
    expect(service.load().features.find((f) => f.id === "f")!.updates).toHaveLength(0);

    // Recovery: SIGKILL the holder. The kernel releases the SQLite file lock immediately, so the
    // same note succeeds without any stale-lock cleanup or unlink.
    holder.kill("SIGKILL");
    await holder.exited;

    const retried = await runCli(["feature", "note", "f", "after-conflict"]);
    expect(retried.code, retried.stderr).toBe(0);
    const notes = service.load().features.find((f) => f.id === "f")!.updates.map((u) => u.note);
    expect(notes).toEqual(["after-conflict"]);
    expect(service.check().ok, JSON.stringify(service.check().errors)).toBe(true);
  });

  test("locking is re-entrant and mutations that nest still work", () => {
    expect(withStoreLock(pulseDir(), () => withStoreLock(pulseDir(), () => "inner"))).toBe("inner");

    const service = initRepo();
    // upsertFeature on a new id delegates to addFeature under the same held lock.
    service.upsertFeature({ id: "nested", title: "Nested" });
    expect(service.load().features.map((f) => f.id)).toContain("nested");

    // Removal and pulse paths through the lock.
    service.addFeature({ id: "dep-child", title: "Child", depends_on: ["nested"] });
    const removed = service.removeFeature("nested", { force: true });
    expect(removed.updatedDependents).toEqual(["dep-child"]);

    service.upsertMilestone({ id: "m2", title: "M2" });
    service.addFeature({ id: "moved", title: "Moved" });
    const removedMilestone = service.removeMilestone("backlog", { reassignTo: "m2" });
    expect(removedMilestone.reassignedFeatures).toContain("moved");

    const pulsed = service.logFeaturePulse({ id: "moved", note: "pulsed" });
    expect(pulsed.entity.milestone).toBe("m2");
    expect(pulsed.entity.updates.map((u) => u.note)).toEqual(["pulsed"]);

    expect(service.check().ok).toBe(true);
  });

  test("init refuses hand-written roadmaps with and without config and preserves all bytes", () => {
    const handWritten = "# My roadmap\n\nHand-written plans that must survive.\n";

    // No config yet: refusal must not create anything.
    writeFileSync(roadmapPath(), handWritten);
    const service = new RoadmapService(tempDir);
    expect(() => service.init()).toThrow(/--force/);
    expect(readFileSync(roadmapPath(), "utf8")).toBe(handWritten);
    expect(existsSync(configPath())).toBe(false);
    expect(existsSync(pulseDir())).toBe(false);

    // Initialized repo whose generated roadmap was replaced by hand-written bytes: refusal
    // preserves both the hand-written roadmap and the existing config (even with flags set).
    const initialized = new RoadmapService(tempDir);
    initialized.init({ force: true, name: "Atomic" });
    writeFileSync(roadmapPath(), handWritten);
    const configBefore = readFileSync(configPath(), "utf8");
    expect(() => initialized.init({ name: "Renamed" })).toThrow(/--force/);
    expect(readFileSync(roadmapPath(), "utf8")).toBe(handWritten);
    expect(readFileSync(configPath(), "utf8")).toBe(configBefore);
  });

  test("a quoted generated marker inside hand-written body text is not a generated header", () => {
    const quoted = [
      "# Plans",
      "",
      "The tool normally starts its file with:",
      "",
      `    ${GENERATED_ROADMAP_HEADER}`,
      "",
      "...but this document is hand-written.",
      "",
    ].join("\n");
    writeFileSync(roadmapPath(), quoted);
    const service = new RoadmapService(tempDir);
    expect(() => service.init()).toThrow(/--force/);
    expect(readFileSync(roadmapPath(), "utf8")).toBe(quoted);
    expect(existsSync(configPath())).toBe(false);
  });

  test("forced replacement and normal re-init remain supported", () => {
    writeFileSync(roadmapPath(), "# Hand-written\n");
    const service = new RoadmapService(tempDir);
    service.init({ force: true, name: "Forced" });
    expect(readFileSync(roadmapPath(), "utf8").split("\n")[0]).toBe(GENERATED_ROADMAP_HEADER);
    expect(service.load().config.project.name).toBe("Forced");
    expect(service.check().ok).toBe(true);

    // Normal re-init over a generated roadmap succeeds and applies flag updates.
    const updated = service.init({ name: "Renamed" });
    expect(updated.created).toBe(false);
    expect(service.load().config.project.name).toBe("Renamed");
    expect(readFileSync(roadmapPath(), "utf8").split("\n")[0]).toBe(GENERATED_ROADMAP_HEADER);

    // A file that genuinely opens with the generated header still counts as replaceable.
    service.init({ name: "Atomic" });
    writeFileSync(roadmapPath(), `${GENERATED_ROADMAP_HEADER}\n\n# Edited by an agent\n`);
    expect(() => service.init({ name: "Atomic" })).not.toThrow();
    expect(readFileSync(roadmapPath(), "utf8").split("\n")[0]).toBe(GENERATED_ROADMAP_HEADER);
  });

  test("caseCollisionEntry flags exactly the writes that would clobber a differently-cased sibling", () => {
    // Case-insensitive semantics: differently-cased sibling resolves to the same file.
    expect(caseCollisionEntry(["API.md"], "api.md", true)).toBe("API.md");
    expect(caseCollisionEntry(["V0.1.md"], "v0.1.md", true)).toBe("V0.1.md");
    // Case-sensitive semantics: the exact path is a separate file, both IDs may coexist.
    expect(caseCollisionEntry(["API.md"], "api.md", false)).toBeNull();
    expect(caseCollisionEntry(["API.md", "api.md"], "api.md", true)).toBeNull();
    // Exact entry present: the write targets that file itself, whatever siblings exist.
    expect(caseCollisionEntry(["API.md", "api.md"], "API.md", true)).toBeNull();
    expect(caseCollisionEntry(["api.md"], "api.md", true)).toBeNull();
    // Unrelated names never collide.
    expect(caseCollisionEntry(["other.md"], "api.md", true)).toBeNull();
  });

  test("differently cased feature and milestone ids cannot clobber originals on case-insensitive filesystems", () => {
    const service = initRepo();
    const caseInsensitive = isCaseInsensitivePath(pulseDir());

    service.addFeature({ id: "API", title: "Original", milestone: "backlog" });
    service.upsertMilestone({ id: "V0.1", title: "Original" });

    if (caseInsensitive) {
      // Writing the differently-cased sibling would overwrite the original on this host:
      // refuse before committing bytes.
      expect(() => service.addFeature({ id: "api", title: "Impostor" })).toThrow(/same file/);
      expect(() => service.upsertMilestone({ id: "v0.1", title: "Impostor" })).toThrow(/same file/);
      const loaded = service.load();
      expect(loaded.features.find((f) => f.id === "API")!.title).toBe("Original");
      expect(loaded.milestones.find((m) => m.id === "V0.1")!.title).toBe("Original");
    } else {
      // Case-sensitive host: differently-cased IDs keep coexisting as distinct files.
      service.addFeature({ id: "api", title: "Lowercase twin" });
      service.upsertMilestone({ id: "v0.1", title: "Lowercase twin" });
      expect(readdirSync(join(pulseDir(), "features")).sort()).toEqual(["API.md", "api.md"]);

      // Updating each twin after both exist must keep working: the exact entry short-circuits
      // the guard instead of rejecting writes to a cased sibling pair.
      service.updateFeature("API", { title: "Original, updated" });
      service.updateFeature("api", { title: "Twin, updated" });
      service.updateMilestone("V0.1", { title: "Original, updated" });
      service.updateMilestone("v0.1", { title: "Twin, updated" });
      const updated = service.load();
      expect(updated.features.find((f) => f.id === "API")!.title).toBe("Original, updated");
      expect(updated.features.find((f) => f.id === "api")!.title).toBe("Twin, updated");
      expect(updated.milestones.find((m) => m.id === "V0.1")!.title).toBe("Original, updated");
      expect(updated.milestones.find((m) => m.id === "v0.1")!.title).toBe("Twin, updated");
    }
    expect(service.check().ok).toBe(true);
  });
});
