import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliCaptured as runCliCapturedImpl } from "./helpers/cli";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-s1b-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Lockstep wrapper: every case in this file runs the CLI with cwd bound to the per-test tempDir.
async function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return runCliCapturedImpl(args, { cwd: tempDir });
}

describe("Slice 1b: Milestone & Feature Authoring CLI Commands + Auto-Sync", () => {
  test("milestone add/update and feature add/update auto-regenerate ROADMAP.md", async () => {
    expect((await runCli(["init", "--name", "Authoring Demo"])).code).toBe(0);

    const mAdd = await runCli([
      "milestone",
      "add",
      "v0.1",
      "--title",
      "v0.1 — Core",
      "--order",
      "10",
      "--status",
      "active",
      "--target",
      "2026-Q4",
      "--description",
      "Initial core milestone.",
      "--json",
    ]);
    expect(mAdd.code).toBe(0);
    expect(JSON.parse(mAdd.stdout).milestone.id).toBe("v0.1");

    const mUpd = await runCli([
      "milestone",
      "update",
      "v0.1",
      "--target",
      "2026-12",
      "--json",
    ]);
    expect(mUpd.code).toBe(0);
    expect(JSON.parse(mUpd.stdout).milestone.target).toBe("2026-12");

    const f1Add = await runCli([
      "feature",
      "add",
      "local-store",
      "--title",
      "Local Store",
      "--milestone",
      "v0.1",
      "--area",
      "Core",
      "--status",
      "shipped",
      "--criterion",
      "Atomic writes work",
      "--ref",
      "bd:pp-1",
      "--description",
      "Stores files cleanly.",
      "--json",
    ]);
    expect(f1Add.code).toBe(0);
    expect(JSON.parse(f1Add.stdout).feature.ship_criteria.length).toBe(1);

    const f2Add = await runCli([
      "feature",
      "add",
      "offline-sync",
      "--title",
      "Offline Sync",
      "--milestone",
      "v0.1",
      "--area",
      "Sync",
      "--depends-on",
      "local-store",
      "--criterion",
      "Queue offline mutations",
      "--criterion",
      "Reconcile on reconnect",
      "--ref",
      "bd:pp-2",
      "--ref",
      "gh:#10",
      "--json",
    ]);
    expect(f2Add.code).toBe(0);

    const f2Upd = await runCli([
      "feature",
      "update",
      "offline-sync",
      "--status",
      "in-progress",
      "--add-ref",
      "linear:ENG-5",
      "--remove-ref",
      "gh:#10",
      "--json",
    ]);
    expect(f2Upd.code).toBe(0);
    const updatedFeature = JSON.parse(f2Upd.stdout).feature;
    expect(updatedFeature.status).toBe("in-progress");
    expect(updatedFeature.refs).toEqual(["bd:pp-2", "linear:ENG-5"]);

    const roadmap = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(roadmap).toContain("## v0.1 — Core (`v0.1`)");
    expect(roadmap).toContain("### Offline Sync (`offline-sync`)");
    expect(roadmap).toContain("**Status:** `in-progress`");
    expect(roadmap).toContain("**Depends on:** `local-store`");

    const checkRes = await runCli(["check", "--json"]);
    expect(checkRes.code).toBe(0);
    expect(JSON.parse(checkRes.stdout).ok).toBe(true);
  });

  test("feature check toggles by ID or 1-based index and feature note appends timestamped pulse", async () => {
    expect((await runCli(["init", "--name", "Pulse Demo"])).code).toBe(0);
    expect((await runCli(["milestone", "add", "v0.1", "--title", "v0.1"])).code).toBe(0);
    expect(
      (
        await runCli([
          "feature",
          "add",
          "auth",
          "--title",
          "Auth",
          "--milestone",
          "v0.1",
          "--criterion",
          "Login works",
          "--criterion",
          "Token refresh works",
        ])
      ).code
    ).toBe(0);

    // Toggle first criterion by 1-based index
    const check1 = await runCli(["feature", "check", "auth", "1", "--json"]);
    expect(check1.code).toBe(0);
    const fAfter1 = JSON.parse(check1.stdout).feature;
    expect(fAfter1.ship_criteria[0].done).toBe(true);
    const secondId = fAfter1.ship_criteria[1].id;

    // Set second criterion explicitly by ID with --done, then --undone
    const check2 = await runCli(["feature", "check", "auth", secondId, "--done", "--json"]);
    expect(check2.code).toBe(0);
    expect(JSON.parse(check2.stdout).feature.ship_criteria[1].done).toBe(true);

    const check2Undo = await runCli(["feature", "check", "auth", secondId, "--undone", "--json"]);
    expect(check2Undo.code).toBe(0);
    expect(JSON.parse(check2Undo.stdout).feature.ship_criteria[1].done).toBe(false);

    // Add pulse note
    const noteRes = await runCli(["feature", "note", "auth", "Login flow implemented", "--json"]);
    expect(noteRes.code).toBe(0);
    const fAfterNote = JSON.parse(noteRes.stdout).feature;
    expect(fAfterNote.updates.length).toBe(1);
    expect(fAfterNote.updates[0].note).toBe("Login flow implemented");
    expect(fAfterNote.updates[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const roadmap = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(roadmap).toContain("- [x] Login works");
    expect(roadmap).toContain("- [ ] Token refresh works");
    expect(roadmap).toContain("Login flow implemented");

    expect((await runCli(["check"])).code).toBe(0);
  });

  test("invalid mutations are rejected before writing corrupt files or dirtying ROADMAP.md", async () => {
    expect((await runCli(["init", "--name", "Guard Demo"])).code).toBe(0);
    expect((await runCli(["milestone", "add", "v0.1", "--title", "v0.1"])).code).toBe(0);
    expect(
      (
        await runCli([
          "feature",
          "add",
          "f1",
          "--title",
          "Feature 1",
          "--milestone",
          "v0.1",
        ])
      ).code
    ).toBe(0);

    const roadmapBefore = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");

    // Unknown milestone rejected without creating file
    const badFeature = await runCli([
      "feature",
      "add",
      "bad-feat",
      "--title",
      "Bad",
      "--milestone",
      "nope",
      "--json",
    ]);
    expect(badFeature.code).toBe(1);
    expect(JSON.parse(badFeature.stdout).ok).toBe(false);
    expect(existsSync(join(tempDir, ".project-pulse/features/bad-feat.md"))).toBe(false);

    // Self-dependency cycle rejected without corrupting f1
    const badCycle = await runCli([
      "feature",
      "update",
      "f1",
      "--depends-on",
      "f1",
      "--json",
    ]);
    expect(badCycle.code).toBe(1);
    expect(readFileSync(join(tempDir, "ROADMAP.md"), "utf8")).toBe(roadmapBefore);
    expect((await runCli(["check"])).code).toBe(0);
  });
});

describe("Slice 1b regressions: body indentation and ref trimming", () => {
  test("an initial indented code block survives add/update, reload, and rendering (pp-f7m.37)", async () => {
    expect((await runCli(["init", "--name", "Code Block Demo"])).code).toBe(0);

    const description = "    const pinned = load();\n\nPlain paragraph after the snippet.";
    const fAdd = await runCli([
      "feature",
      "add",
      "snippet",
      "--title",
      "Snippet",
      "--description",
      description,
      "--json",
    ]);
    expect(fAdd.code).toBe(0);
    expect(JSON.parse(fAdd.stdout).feature.description).toBe(description);

    // Serialization keeps the canonical `---\n<body>\n` convention (content
    // starts on the line after the closing delimiter) with the code block's
    // four leading spaces intact.
    const featurePath = join(tempDir, ".project-pulse/features/snippet.md");
    expect(readFileSync(featurePath, "utf8")).toContain(
      "---\n    const pinned = load();\n\nPlain paragraph after the snippet.\n"
    );

    // A later mutation reloads and re-serializes the file; the indentation
    // must survive that round-trip unchanged.
    const fUpd = await runCli(["feature", "update", "snippet", "--status", "in-progress", "--json"]);
    expect(fUpd.code).toBe(0);
    expect(JSON.parse(fUpd.stdout).feature.description).toBe(description);
    expect(readFileSync(featurePath, "utf8")).toContain(
      "---\n    const pinned = load();\n\nPlain paragraph after the snippet.\n"
    );

    // Rendering keeps the indented first line as its own roadmap line.
    const roadmapLines = readFileSync(join(tempDir, "ROADMAP.md"), "utf8").split("\n");
    expect(roadmapLines).toContain("    const pinned = load();");

    const mAdd = await runCli([
      "milestone",
      "add",
      "setup",
      "--title",
      "Setup",
      "--description",
      "    mkdir -p store\n\nSetup steps.",
      "--json",
    ]);
    expect(mAdd.code).toBe(0);
    expect(readFileSync(join(tempDir, "ROADMAP.md"), "utf8").split("\n")).toContain(
      "    mkdir -p store"
    );
  });

  test("removing a whitespace-padded ref removes the stored reference (pp-f7m.38)", async () => {
    expect((await runCli(["init", "--name", "Ref Trim Demo"])).code).toBe(0);

    const fAdd = await runCli([
      "feature",
      "add",
      "refs-demo",
      "--title",
      "Refs Demo",
      "--ref",
      "  bd:pp-9  ",
      "--json",
    ]);
    expect(fAdd.code).toBe(0);
    // Adding trims: the stored ref is the trimmed id.
    expect(JSON.parse(fAdd.stdout).feature.refs).toEqual(["bd:pp-9"]);

    // Removing the same pasted ref, still whitespace-padded, must match it.
    const fRemove = await runCli([
      "feature",
      "update",
      "refs-demo",
      "--remove-ref",
      " bd:pp-9 ",
      "--json",
    ]);
    expect(fRemove.code).toBe(0);
    expect(JSON.parse(fRemove.stdout).feature.refs).toEqual([]);

    const featureBody = readFileSync(join(tempDir, ".project-pulse/features/refs-demo.md"), "utf8");
    expect(featureBody).not.toContain("bd:pp-9");

    const roadmap = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(roadmap).not.toContain("bd:pp-9");
    expect((await runCli(["check"])).code).toBe(0);
  });
});
