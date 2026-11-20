import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json";
import { runCli } from "../src/cli";
import { parseMarkdownFile, serializeConfig, serializeFeature } from "../src/frontmatter";
import { findProjectRoot, RoadmapService } from "../src/store";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-v02-s1-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function captureConsole(fn: () => Promise<number>): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (...args: unknown[]) => out.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => err.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => err.push(args.map(String).join(" "));
  try {
    const code = await fn();
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
  }
}

describe("v0.2 CLI Ergonomics & Core Store Hardening", () => {
  test("findProjectRoot discovers .project-pulse/ upward while pp init stays in cwd and --root overrides", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "RootRepo" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active" });

    const nested = join(tempDir, "packages", "core", "src");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(tempDir);
    expect(findProjectRoot(tmpdir())).toBeNull();

    // Command run with nested cwd resolves parent repo root
    const nestedSummary = await captureConsole(() => runCli(["summary", "--json"], { cwd: nested }));
    expect(nestedSummary.code).toBe(0);
    expect(JSON.parse(nestedSummary.stdout).project.name).toBe("RootRepo");

    // Bare pp runs summary in initialized repo (including from nested cwd)
    const bareInit = await captureConsole(() => runCli(["--json"], { cwd: nested }));
    expect(bareInit.code).toBe(0);
    expect(JSON.parse(bareInit.stdout).project.name).toBe("RootRepo");

    // Bare pp in uninitialized directory shows help cleanly
    const uninitDir = mkdtempSync(join(tmpdir(), "project-pulse-uninit-"));
    try {
      const bareUninit = await captureConsole(() => runCli([], { cwd: uninitDir }));
      expect(bareUninit.code).toBe(0);
      expect(bareUninit.stdout).toContain("Usage:");

      // pp init inside nested dir initializes that nested dir (does not hijack parent)
      const subInitTarget = join(tempDir, "sub-project");
      mkdirSync(subInitTarget, { recursive: true });
      const initSub = await captureConsole(() =>
        runCli(["init", "--name", "SubProj", "--json"], { cwd: subInitTarget })
      );
      expect(initSub.code).toBe(0);
      expect(existsSync(join(subInitTarget, ".project-pulse/config.yaml"))).toBe(true);

      // Explicit --root overrides cwd discovery
      const rootOverride = await captureConsole(() =>
        runCli(["summary", "--root", tempDir, "--json"], { cwd: subInitTarget })
      );
      expect(rootOverride.code).toBe(0);
      expect(JSON.parse(rootOverride.stdout).project.name).toBe("RootRepo");
    } finally {
      rmSync(uninitDir, { recursive: true, force: true });
    }
  });

  test("version matches package.json and strict flag validation rejects unknown/unsafe flags", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "StrictCLI" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active" });
    svc.addFeature({ id: "feat-1", title: "Feat 1", milestone: "v0.1" });

    const verRes = await captureConsole(() => runCli(["--version"], { cwd: tempDir }));
    expect(verRes.code).toBe(0);
    expect(verRes.stdout.trim()).toBe(pkg.version);

    const unknownLong = await captureConsole(() => runCli(["summary", "--bogus"], { cwd: tempDir }));
    expect(unknownLong.code).toBe(1);
    expect(unknownLong.stderr).toContain("Unknown flag '--bogus'");

    const unknownShort = await captureConsole(() => runCli(["summary", "-x"], { cwd: tempDir }));
    expect(unknownShort.code).toBe(1);
    expect(unknownShort.stderr).toContain("Unknown flag '-x'");

    const boolWithVal = await captureConsole(() =>
      runCli(["check", "--json=true"], { cwd: tempDir })
    );
    expect(boolWithVal.code).toBe(1);
    expect(boolWithVal.stderr).toContain("does not take a value");

    const wrongCmdFlag = await captureConsole(() =>
      runCli(["summary", "--title", "Oops"], { cwd: tempDir })
    );
    expect(wrongCmdFlag.code).toBe(1);
    expect(wrongCmdFlag.stderr).toContain("is not supported for 'summary'");

    const extraPositional = await captureConsole(() =>
      runCli(["summary", "extra"], { cwd: tempDir })
    );
    expect(extraPositional.code).toBe(1);
    expect(extraPositional.stderr).toContain("Unexpected argument 'extra'");

    // Reject destructive --criterion on feature update
    const criterionOnUpdate = await captureConsole(() =>
      runCli(["feature", "update", "feat-1", "--criterion", "Wipes all"], { cwd: tempDir })
    );
    expect(criterionOnUpdate.code).toBe(1);
    expect(criterionOnUpdate.stderr).toContain("--add-criterion");

    // Negative --order value parses cleanly
    const negOrder = await captureConsole(() =>
      runCli(["feature", "update", "feat-1", "--order", "-10", "--json"], { cwd: tempDir })
    );
    expect(negOrder.code).toBe(0);
    expect(JSON.parse(negOrder.stdout).feature.order).toBe(-10);
  });

  test("non-destructive --add-criterion and --remove-criterion preserve existing criteria and done states", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "CriteriaPatch" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active" });
    svc.addFeature({
      id: "auth",
      title: "Auth",
      milestone: "v0.1",
      ship_criteria: ["Login flow works", "Session refresh works", "Legacy check"],
    });
    svc.checkFeatureCriterion("auth", "1", true);

    const updRes = await captureConsole(() =>
      runCli(
        [
          "feature",
          "update",
          "auth",
          "--remove-criterion",
          "3",
          "--add-criterion",
          "MFA recovery works",
          "--json",
        ],
        { cwd: tempDir }
      )
    );
    expect(updRes.code).toBe(0);
    const updated = JSON.parse(updRes.stdout).feature;
    expect(updated.ship_criteria).toHaveLength(3);
    expect(updated.ship_criteria[0]).toMatchObject({ text: "Login flow works", done: true });
    expect(updated.ship_criteria[1]).toMatchObject({ text: "Session refresh works", done: false });
    expect(updated.ship_criteria[2]).toMatchObject({ text: "MFA recovery works", done: false });

    // Missing criterion ID rejects cleanly without mutating file
    const badRemove = await captureConsole(() =>
      runCli(["feature", "update", "auth", "--remove-criterion", "does-not-exist", "--json"], {
        cwd: tempDir,
      })
    );
    expect(badRemove.code).toBe(1);
    expect(JSON.parse(badRemove.stdout).ok).toBe(false);
    expect(svc.load().features[0]!.ship_criteria).toHaveLength(3);
  });

  test("feature remove (--force) and milestone remove (--reassign) update references and ROADMAP.md", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "RemoveDemo" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", order: 10, status: "active" });
    svc.upsertMilestone({ id: "v0.2", title: "v0.2", order: 20, status: "planned" });
    svc.addFeature({ id: "base", title: "Base", milestone: "v0.1" });
    svc.addFeature({ id: "child", title: "Child", milestone: "v0.1", depends_on: ["base"] });

    // Refuse removing depended-on feature without --force
    const blockedRemoveF = await captureConsole(() =>
      runCli(["feature", "remove", "base", "--json"], { cwd: tempDir })
    );
    expect(blockedRemoveF.code).toBe(1);
    expect(JSON.parse(blockedRemoveF.stdout).error).toContain("child");
    expect(existsSync(join(tempDir, ".project-pulse/features/base.md"))).toBe(true);

    // Succeed with --force and prune child depends_on edge
    const forcedRemoveF = await captureConsole(() =>
      runCli(["feature", "remove", "base", "--force", "--json"], { cwd: tempDir })
    );
    expect(forcedRemoveF.code).toBe(0);
    expect(JSON.parse(forcedRemoveF.stdout).updatedDependents).toEqual(["child"]);
    expect(existsSync(join(tempDir, ".project-pulse/features/base.md"))).toBe(false);
    expect(svc.load().features.find((f) => f.id === "child")?.depends_on).toEqual([]);

    // Refuse removing milestone with assigned features without --reassign
    const blockedRemoveM = await captureConsole(() =>
      runCli(["milestone", "remove", "v0.1", "--json"], { cwd: tempDir })
    );
    expect(blockedRemoveM.code).toBe(1);
    expect(JSON.parse(blockedRemoveM.stdout).error).toContain("child");

    // Reassign to v0.2 and remove v0.1
    const reassignedM = await captureConsole(() =>
      runCli(["milestone", "remove", "v0.1", "--reassign", "v0.2", "--json"], { cwd: tempDir })
    );
    expect(reassignedM.code).toBe(0);
    expect(JSON.parse(reassignedM.stdout).reassignedFeatures).toEqual(["child"]);
    expect(existsSync(join(tempDir, ".project-pulse/milestones/v0.1.md"))).toBe(false);
    expect(svc.load().features.find((f) => f.id === "child")?.milestone).toBe("v0.2");
    expect(svc.check().ok).toBe(true);
  });

  test("pp show --no-beads skips Beads resolution and rejects conflicting --beads + --no-beads", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "ShowNoBeads" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1" });
    svc.addFeature({ id: "f1", title: "F1", milestone: "v0.1", refs: ["bd:pp-99"] });

    let called = 0;
    const spyClient = {
      async resolveRefs() {
        called++;
        return [];
      },
    };

    const res = await captureConsole(() =>
      runCli(["show", "f1", "--no-beads", "--json"], { cwd: tempDir, beadsClient: spyClient })
    );
    expect(res.code).toBe(0);
    expect(called).toBe(0);
    expect(JSON.parse(res.stdout).beads).toEqual([]);

    const conflict = await captureConsole(() =>
      runCli(["show", "f1", "--beads", "--no-beads"], { cwd: tempDir, beadsClient: spyClient })
    );
    expect(conflict.code).toBe(1);
    expect(conflict.stderr).toContain("mutually exclusive");
  });

  test("clean YAML serialization omits trailing spaces, pp check handles malformed config.yaml, and self-cycles emit once", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "CleanYaml" });
    const configYaml = serializeConfig(svc.loadConfig());
    for (const line of configYaml.split("\n")) {
      expect(line).toBe(line.replace(/[ \t]+$/, ""));
    }

    const featYaml = serializeFeature({
      id: "clean",
      title: "Clean",
      milestone: "backlog",
      order: 10,
      status: "planned",
      depends_on: [],
      refs: [],
      ship_criteria: [],
      updates: [{ at: "2026-11-20T00:00:00Z", note: "Note with colon: " }],
      description: "Body text.",
    });
    for (const line of featYaml.split("\n")) {
      expect(line).toBe(line.replace(/[ \t]+$/, ""));
    }
    expect(parseMarkdownFile(featYaml).frontmatter.updates).toEqual([
      { at: "2026-11-20T00:00:00Z", note: "Note with colon: " },
    ]);

    // Self-dependency emits exactly 1 DEPENDENCY_CYCLE error
    svc.upsertMilestone({ id: "v0.1", title: "v0.1" });
    svc.writeFeatureFile({
      id: "self-loop",
      title: "Self Loop",
      milestone: "v0.1",
      order: 10,
      status: "planned",
      depends_on: ["self-loop"],
      refs: [],
      ship_criteria: [],
      updates: [],
      description: "",
    });
    svc.render();
    const cycleCheck = svc.check();
    expect(cycleCheck.errors.filter((e) => e.code === "DEPENDENCY_CYCLE")).toHaveLength(1);

    // Malformed config.yaml produces structured CONFIG_PARSE_ERROR instead of throwing
    writeFileSync(join(tempDir, ".project-pulse/config.yaml"), "project: [unclosed\n", "utf8");
    const malformedRes = await captureConsole(() =>
      runCli(["check", "--beads", "--json"], { cwd: tempDir })
    );
    expect(malformedRes.code).toBe(1);
    const parsed = JSON.parse(malformedRes.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0].code).toBe("CONFIG_PARSE_ERROR");
  });
});
