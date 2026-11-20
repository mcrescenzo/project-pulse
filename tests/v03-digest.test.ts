import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { buildChangelog, buildDigest, parseSinceSpec } from "../src/digest";
import { RoadmapService } from "../src/store";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-digest-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function git(args: string[], cwd: string): void {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(res.stderr)}`);
  }
}

async function captureCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => err.push(a.map(String).join(" "));
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await runCli(args, { cwd: tempDir });
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.stdout.write = origWrite;
  }
}

describe("v0.3 Activity Digest & Release Changelog", () => {
  test("parseSinceSpec distinguishes relative durations, ISO dates, and git refs without Date.parse pitfalls", () => {
    const fixedNow = new Date("2026-11-20T12:00:00.000Z");
    const rel = parseSinceSpec("7d", fixedNow);
    expect(rel.kind).toBe("date");
    expect(rel.sinceIso).toBe("2026-11-13T12:00:00.000Z");

    const iso = parseSinceSpec("2026-11-01", fixedNow);
    expect(iso.kind).toBe("date");
    expect(iso.sinceIso).toBe("2026-11-01T00:00:00.000Z");

    // Version tags like "v0.1" must NOT be misparsed by JS Date.parse
    const tagRef = parseSinceSpec("v0.1", fixedNow);
    expect(tagRef.kind).toBe("ref");
    expect(tagRef.ref).toBe("v0.1");
  });

  test("pp digest computes delta across git commits/tags (shipped, status changes, criteria, notes, added/removed)", async () => {
    git(["init"], tempDir);
    git(["config", "user.name", "Tester"], tempDir);
    git(["config", "user.email", "tester@example.com"], tempDir);

    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Digest Demo", summary: "Git history diffing." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.upsertMilestone({ id: "v0.2", title: "v0.2 Next", status: "planned", order: 20 });
    svc.addFeature({
      id: "alpha",
      title: "Alpha",
      milestone: "v0.1",
      status: "in-progress",
      ship_criteria: ["Step 1", "Step 2"],
    });
    svc.addFeature({
      id: "dropped",
      title: "Old Feature",
      milestone: "v0.2",
      status: "planned",
    });

    git(["add", "."], tempDir);
    git(["commit", "-m", "baseline roadmap"], tempDir);
    git(["tag", "v0.1-start"], tempDir);

    // Move project forward after baseline tag
    svc.updateFeature("alpha", { status: "shipped" });
    svc.checkFeatureCriterion("alpha", "1", true);
    svc.addFeatureNote("alpha", "Alpha shipped cleanly");
    svc.removeFeature("dropped");
    svc.addFeature({
      id: "beta",
      title: "Beta",
      milestone: "v0.2",
      status: "in-progress",
      ship_criteria: ["Wire Beta"],
    });
    git(["add", "."], tempDir);
    git(["commit", "-m", "progress after baseline"], tempDir);

    const res = await captureCli(["digest", "--since", "v0.1-start", "--json"]);
    expect(res.code).toBe(0);
    const digest = JSON.parse(res.stdout);
    expect(digest.gitBaseline.available).toBe(true);
    expect(digest.shippedFeatures.map((f: { id: string }) => f.id)).toEqual(["alpha"]);
    expect(digest.statusChanges).toEqual([
      { id: "alpha", title: "Alpha", milestone: "v0.1", from: "in-progress", to: "shipped" },
    ]);
    expect(digest.addedFeatures.map((f: { id: string }) => f.id)).toEqual(["beta"]);
    expect(digest.removedFeatures.map((f: { id: string }) => f.id)).toEqual(["dropped"]);
    expect(digest.completedCriteria).toHaveLength(1);
    expect(digest.pulseNotes.map((p: { note: string }) => p.note)).toEqual(["Alpha shipped cleanly"]);

    // Filter by milestone
    const m1Only = buildDigest(tempDir, { since: "HEAD~1", milestone: "v0.1" });
    expect(m1Only.addedFeatures).toHaveLength(0);
    expect(m1Only.shippedFeatures.map((f) => f.id)).toEqual(["alpha"]);
  });

  test("pp digest degrades gracefully in non-git directories and single-commit unannotated repos", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "NoGit App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "shipped" });
    svc.addFeature({ id: "feat-1", title: "Feat One", milestone: "v0.1", status: "shipped" });
    svc.addFeatureNote("feat-1", "Recent note inside window", new Date().toISOString());

    // 1. Non-git directory succeeds
    const nonGit = await captureCli(["digest", "--since", "7d", "--json"]);
    expect(nonGit.code).toBe(0);
    const nonGitJson = JSON.parse(nonGit.stdout);
    expect(nonGitJson.gitBaseline.available).toBe(false);
    expect(nonGitJson.shippedFeatures).toHaveLength(1);
    expect(nonGitJson.pulseNotes).toHaveLength(1);

    // 2. Single unannotated commit created today with --since 7d still succeeds
    git(["init"], tempDir);
    git(["config", "user.name", "Tester"], tempDir);
    git(["config", "user.email", "tester@example.com"], tempDir);
    git(["add", "."], tempDir);
    git(["commit", "-m", "only commit"], tempDir);

    const singleCommit = buildDigest(tempDir, { since: "7d" });
    expect(singleCommit.gitBaseline.available).toBe(false);
    expect(singleCommit.markdown).toContain("Feat One");
  });

  test("pp changelog generates clean Markdown release notes with default milestone, --all, and --json", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Changelog App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "shipped", target: "2026-Q4", order: 10 });
    svc.upsertMilestone({ id: "v0.2", title: "v0.2 Next", status: "active", order: 20 });
    svc.addFeature({
      id: "core-a",
      title: "Core A",
      milestone: "v0.1",
      status: "shipped",
      area: "Core",
      refs: ["bd:pp-1"],
      description: "First major capability.",
      ship_criteria: ["Fast startup", "Clean storage"],
    });
    svc.checkFeatureCriterion("core-a", "1", true);
    svc.addFeature({ id: "next-b", title: "Next B", milestone: "v0.2", status: "in-progress" });

    // Default picks latest shipped milestone (v0.1)
    const defRes = await captureCli(["changelog", "--json"]);
    expect(defRes.code).toBe(0);
    const defJson = JSON.parse(defRes.stdout);
    expect(defJson.milestones.map((m: { milestone: { id: string } }) => m.milestone.id)).toEqual(["v0.1"]);
    expect(defJson.markdown).toContain("## v0.1 Core (2026-Q4)");
    expect(defJson.markdown).toContain("**Core A** (`core-a`)");
    expect(defJson.markdown).toContain("- [x] Fast startup");

    // --all covers both milestones
    const allRes = buildChangelog(tempDir, { all: true });
    expect(allRes.milestones.map((m) => m.milestone.id)).toEqual(["v0.1", "v0.2"]);
    expect(allRes.markdown).toContain("## v0.2 Next");

    // Combining <id> and --all rejects cleanly
    const conflict = await captureCli(["changelog", "v0.1", "--all"]);
    expect(conflict.code).toBe(1);
  });
});
