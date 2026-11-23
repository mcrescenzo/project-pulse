import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { buildChangelog, buildDigest, parseSinceSpec } from "../src/digest";
import { serializeConfig } from "../src/frontmatter";
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

  test("digest reads a roadmap nested inside the repo against its own unchanged HEAD (pp-f7m.8)", async () => {
    git(["init"], tempDir);
    git(["config", "user.name", "Tester"], tempDir);
    git(["config", "user.email", "tester@example.com"], tempDir);

    // Two nested projects reuse the feature id "f"; the superproject itself keeps a roadmap
    // whose feature is also called "f". The repo root is the git root for all of them.
    const svcRoot = new RoadmapService(tempDir);
    svcRoot.init({ name: "Super Root" });
    svcRoot.addFeature({ id: "f", title: "Root F", milestone: "backlog", status: "shipped" });

    const dirA = join(tempDir, "pkg", "a");
    const dirB = join(tempDir, "pkg", "b");
    const svcA = new RoadmapService(dirA);
    svcA.init({ name: "Nested A" });
    svcA.upsertMilestone({ id: "m1", title: "M1", status: "active", order: 10 });
    svcA.addFeature({
      id: "f",
      title: "Feature F",
      milestone: "m1",
      status: "in-progress",
      ship_criteria: [{ id: "wire", text: "Wire it" }],
    });
    const svcB = new RoadmapService(dirB);
    svcB.init({ name: "Nested B" });
    svcB.addFeature({ id: "f", title: "Feature F in B", milestone: "backlog", status: "shipped" });

    git(["add", "."], tempDir);
    git(["commit", "-m", "baseline"], tempDir);
    git(["tag", "nested-start"], tempDir);

    // Unmodified working tree vs its own HEAD: zero activity, not "newly added".
    const unchanged = buildDigest(dirA, { since: "HEAD" });
    expect(unchanged.gitBaseline.available).toBe(true);
    expect(unchanged.addedFeatures).toHaveLength(0);
    expect(unchanged.summary.addedCount).toBe(0);
    expect(unchanged.statusChanges).toHaveLength(0);
    expect(unchanged.markdown).toContain("_No roadmap activity recorded in this window._");

    // Change only A; the superproject's and B's identically-named features must not leak in.
    svcA.updateFeature("f", { status: "shipped" });
    svcA.checkFeatureCriterion("f", "wire", true);
    svcA.addFeature({ id: "g", title: "Feature G", milestone: "m1", status: "planned" });
    git(["add", "."], tempDir);
    git(["commit", "-m", "progress in a"], tempDir);

    const delta = buildDigest(dirA, { since: "nested-start" });
    expect(delta.shippedFeatures.map((x) => x.id)).toEqual(["f"]);
    expect(delta.addedFeatures.map((x) => x.id)).toEqual(["g"]);
    expect(delta.completedCriteria.map((c) => c.featureId)).toEqual(["f"]);
    expect(delta.markdown).not.toContain("Root F");
    expect(delta.markdown).not.toContain("Feature F in B");
  });

  test("pp changelog --all includes the implicit default bucket and never duplicates it (pp-f7m.15)", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Backlog Only" });
    svc.addFeature({ id: "seed-a", title: "Seed A", milestone: "backlog", status: "shipped" });
    svc.addFeature({ id: "seed-b", title: "Seed B", milestone: "backlog", status: "planned" });

    // Backlog-only project: --all covers the configured implicit default bucket.
    const allRes = buildChangelog(tempDir, { all: true });
    expect(allRes.milestones.map((m) => m.milestone.id)).toEqual(["backlog"]);
    expect(allRes.milestones[0]!.milestone.title).toBe("Backlog");
    expect(allRes.markdown).toContain("## Backlog");
    expect(allRes.markdown).toContain("### Shipped");
    expect(allRes.markdown).toContain("**Seed A** (`seed-a`)");
    expect(allRes.markdown).toContain("**Seed B** (`seed-b`) [planned]");

    // CLI --json path stays well-formed.
    const allCli = await captureCli(["changelog", "--all", "--json"]);
    expect(allCli.code).toBe(0);
    const allJson = JSON.parse(allCli.stdout);
    expect(allJson.milestones.map((m: { milestone: { id: string } }) => m.milestone.id)).toEqual([
      "backlog",
    ]);

    // The bucket id follows config.defaults.milestone, it is not a hardcoded "backlog". Fresh
    // fixture with the custom bucket configured before its features exist — features may only
    // reference declared milestones or the configured default bucket.
    const customDir = join(tempDir, "custom-bucket");
    const customSvc = new RoadmapService(customDir);
    customSvc.init({ name: "Triage Only" });
    const customCfg = customSvc.loadConfig();
    customCfg.defaults.milestone = "triage";
    writeFileSync(join(customDir, ".project-pulse", "config.yaml"), serializeConfig(customCfg));
    customSvc.addFeature({ id: "seed-a", title: "Seed A", milestone: "triage", status: "shipped" });
    customSvc.addFeature({ id: "seed-b", title: "Seed B", milestone: "triage", status: "planned" });
    const triageRes = buildChangelog(customDir, { all: true });
    expect(triageRes.milestones.map((m) => m.milestone.id)).toEqual(["triage"]);
    expect(triageRes.markdown).toContain("## Backlog");
    expect(triageRes.markdown).toContain("**Seed A** (`seed-a`)");
    expect(triageRes.markdown).toContain("**Seed B** (`seed-b`) [planned]");

    // Explicit milestones coexist with a featureful implicit bucket, which renders last.
    customSvc.upsertMilestone({ id: "v1", title: "v1", status: "shipped", order: 5 });
    const mixed = buildChangelog(customDir, { all: true });
    expect(mixed.milestones.map((m) => m.milestone.id)).toEqual(["v1", "triage"]);
    expect(mixed.markdown).toContain("## v1");
    expect(mixed.markdown).toContain("## Backlog");
    expect(mixed.markdown).toContain("**Seed A** (`seed-a`)");

    // Once the default bucket exists as a real milestone, --all emits it exactly once.
    customSvc.upsertMilestone({ id: "triage", title: "The Triage", status: "active", order: 10 });
    const declared = buildChangelog(customDir, { all: true });
    expect(declared.milestones.map((m) => m.milestone.id)).toEqual(["v1", "triage"]);
    expect(declared.markdown).toContain("## The Triage");
    expect(declared.markdown).toContain("**Seed A** (`seed-a`)");
    expect(declared.markdown).not.toContain("## Backlog");
  });
});
