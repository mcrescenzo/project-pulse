import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHandler } from "../src/mcp";
import { RoadmapFrozenError, RoadmapService } from "../src/store";
import { validateStore } from "../src/validator";
import { startViewServer, type ViewServerHandle } from "../src/view";
import { authFetch } from "./helpers/auth";
import { runCliCaptured } from "./helpers/cli";
import { openTui, screenText } from "./helpers/tui";

let tempDir: string;
let handle: ViewServerHandle | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-v21-store-"));
});

afterEach(async () => {
  await handle?.stop();
  handle = null;
  rmSync(tempDir, { recursive: true, force: true });
});

function seed(dir: string): RoadmapService {
  const svc = new RoadmapService(dir);
  svc.init({ name: "Freeze", summary: "Store gate tests." });
  svc.upsertMilestone({ id: "m1", title: "M1", status: "active", order: 10 });
  svc.addFeature({ id: "base", title: "Base", milestone: "m1", status: "in-progress", ship_criteria: ["one", "two"] });
  svc.addFeature({ id: "other", title: "Other", milestone: "m1", status: "planned", depends_on: ["base"] });
  return svc;
}

/** Gives `other` a dangling dependency by editing its file directly (the store refuses to write one). */
function breakDependency(dir: string): void {
  const path = join(dir, ".project-pulse", "features", "other.md");
  const text = readFileSync(path, "utf8").replace(/depends_on:\n(\s+- base\n)/, "depends_on:\n$1  - does-not-exist\n");
  writeFileSync(path, text);
  expect(readFileSync(path, "utf8")).toContain("does-not-exist");
}

const cli = (...args: string[]) => runCliCaptured([...args, "--root", tempDir]);

describe("SHIPPED_WITH_OPEN_CRITERIA (soft invariant)", () => {
  test("validator warns for a shipped feature with open criteria and names the feature and count", () => {
    const svc = seed(tempDir);
    svc.updateFeature("base", { status: "shipped" });
    const loaded = svc.load();
    const issues = validateStore({
      config: loaded.config,
      milestones: loaded.milestones,
      features: loaded.features,
      currentRoadmapMd: null,
      expectedRoadmapMd: "",
      checkRoadmapSync: false,
    });
    const warn = issues.find((i) => i.code === "SHIPPED_WITH_OPEN_CRITERIA");
    expect(warn).toBeDefined();
    expect(warn!.level).toBe("warning");
    expect(warn!.entityId).toBe("base");
    expect(warn!.message).toContain("'base'");
    expect(warn!.message).toContain("2 of 2");
  });

  test("store mutations return the warning only while criteria are open, and never block the write", () => {
    const svc = seed(tempDir);
    const shipped = svc.updateFeature("base", { status: "shipped" });
    expect(shipped.entity.status).toBe("shipped");
    expect(shipped.warnings.map((w) => w.code)).toContain("SHIPPED_WITH_OPEN_CRITERIA");

    const one = svc.checkFeatureCriterion("base", "1", true);
    expect(one.warnings.find((w) => w.code === "SHIPPED_WITH_OPEN_CRITERIA")?.message).toContain("1 of 2");

    const both = svc.logFeaturePulse({ id: "base", check_criteria: [svc.load().features.find((f) => f.id === "base")!.ship_criteria[1]!.id] });
    expect(both.warnings.map((w) => w.code)).not.toContain("SHIPPED_WITH_OPEN_CRITERIA");
    expect(svc.check().warnings.map((w) => w.code)).not.toContain("SHIPPED_WITH_OPEN_CRITERIA");
  });

  test("CLI: pp check and pp feature update print the warning; --json lists it", async () => {
    seed(tempDir);
    const upd = await cli("feature", "update", "base", "--status", "shipped");
    expect(upd.code).toBe(0);
    expect(upd.stderr + upd.stdout).toContain("WARN [SHIPPED_WITH_OPEN_CRITERIA]");

    const check = await cli("check");
    expect(check.code).toBe(0);
    expect(check.stdout + check.stderr).toMatch(/^OK/m);
    expect(check.stdout + check.stderr).toMatch(/WARN \[SHIPPED_WITH_OPEN_CRITERIA\].*'base'.*2 of 2/);

    const json = await cli("check", "--json");
    const payload = JSON.parse(json.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.warnings.map((w: { code: string }) => w.code)).toContain("SHIPPED_WITH_OPEN_CRITERIA");

    await cli("feature", "check", "base", "1", "--done");
    const done = await cli("feature", "check", "base", "2", "--done");
    expect(done.stdout + done.stderr).not.toContain("SHIPPED_WITH_OPEN_CRITERIA");
    const clean = await cli("check");
    expect(clean.stdout + clean.stderr).not.toContain("SHIPPED_WITH_OPEN_CRITERIA");
  });

  test("MCP roadmap_log_pulse, the web payload and the TUI health badge carry the warning", async () => {
    seed(tempDir);
    const handler = createMcpHandler(tempDir, { resolveRefs: async () => [] });
    const resp = await handler({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "roadmap_log_pulse", arguments: { id: "base", status: "shipped" } },
    });
    const body = JSON.parse((resp!.result as { content: Array<{ text: string }> }).content[0]!.text);
    const mcpWarn = body.warnings.find((w: { code: string }) => w.code === "SHIPPED_WITH_OPEN_CRITERIA");
    expect(mcpWarn.entityId).toBe("base");

    handle = await startViewServer(tempDir, { port: 0, beadsClient: { resolveRefs: async () => [] } });
    const res = await authFetch(handle.accessToken)(`${handle.url}/api/roadmap`);
    const payload = await res.json();
    expect(payload.check.warnings.map((w: { code: string; entityId?: string }) => `${w.code}:${w.entityId}`)).toContain(
      "SHIPPED_WITH_OPEN_CRITERIA:base"
    );

    const { ctrl } = openTui(tempDir, 120, 34);
    try {
      expect(ctrl.getState().payload.check.warnings.map((w) => w.code)).toContain("SHIPPED_WITH_OPEN_CRITERIA");
      expect(screenText(ctrl)).toContain("1 warning");
    } finally {
      ctrl.stop();
    }
  });
});

describe("explicit edit freeze", () => {
  test("store: unrelated writes throw RoadmapFrozenError listing every existing error", () => {
    const svc = seed(tempDir);
    breakDependency(tempDir);
    let caught: unknown;
    try {
      svc.logFeaturePulse({ id: "base", note: "unrelated" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RoadmapFrozenError);
    const frozen = caught as RoadmapFrozenError;
    expect(frozen.issues.map((i) => i.code)).toEqual(["MISSING_DEPENDENCY"]);
    expect(frozen.message).toMatch(/^Roadmap has 1 error; fix it first:\n {2}\[MISSING_DEPENDENCY\] /);
  });

  test("CLI: unrelated update, check and note print the freeze message and exit non-zero", async () => {
    seed(tempDir);
    breakDependency(tempDir);
    for (const args of [
      ["feature", "update", "base", "--status", "paused"],
      ["feature", "check", "base", "1", "--done"],
      ["feature", "note", "base", "probe note"],
    ]) {
      const res = await cli(...args);
      expect(res.code).not.toBe(0);
      expect(res.stderr).toMatch(/^Roadmap has 1 error; fix it first:$/m);
      expect(res.stderr).toMatch(/^ {2}\[MISSING_DEPENDENCY\] Feature 'other' depends on unknown feature 'does-not-exist'$/m);
      expect(res.stderr).not.toContain("Error: Feature 'other'");
    }
    const json = await cli("feature", "note", "base", "probe", "--json");
    const body = JSON.parse(json.stdout);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("ROADMAP_FROZEN");
    expect(body.errors[0].code).toBe("MISSING_DEPENDENCY");
  });

  test("CLI: a repairing write succeeds, and pp render works on an out-of-sync roadmap", async () => {
    seed(tempDir);
    breakDependency(tempDir);
    const repair = await cli("feature", "update", "other", "--depends-on", "base");
    expect(repair.code).toBe(0);
    expect((await cli("check")).code).toBe(0);

    writeFileSync(join(tempDir, "ROADMAP.md"), "stale\n");
    const render = await cli("render");
    expect(render.code).toBe(0);
    expect((await cli("check")).code).toBe(0);
  });

  test("CLI: on a valid store the same commands succeed, and an invalid request reports its own error", async () => {
    seed(tempDir);
    expect((await cli("feature", "note", "base", "fine")).code).toBe(0);
    expect((await cli("feature", "check", "base", "1", "--done")).code).toBe(0);
    expect((await cli("feature", "update", "base", "--status", "paused")).code).toBe(0);

    const unknown = await cli("feature", "note", "nope", "x");
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain("Error: Feature 'nope' not found");

    breakDependency(tempDir);
    const unknownFrozen = await cli("feature", "note", "nope", "x");
    expect(unknownFrozen.stderr).toContain("Feature 'nope' not found");

    const newError = await cli("feature", "update", "base", "--depends-on", "ghost");
    expect(newError.code).not.toBe(0);
    expect(newError.stderr).toContain("Error: Feature 'base' depends on unknown feature 'ghost'");
  });
});

describe("check payload: editable and stale", () => {
  test("write-blocking errors set editable false; a stale ROADMAP.md alone keeps editing on", () => {
    const svc = seed(tempDir);
    let check = svc.check();
    expect(check).toMatchObject({ ok: true, editable: true, stale: false, blocking: [] });

    writeFileSync(join(tempDir, "ROADMAP.md"), "stale\n");
    check = svc.check();
    expect(check.ok).toBe(false);
    expect(check.editable).toBe(true);
    expect(check.stale).toBe(true);
    expect(check.blocking).toEqual([]);
    // and the store indeed accepts the write, re-rendering ROADMAP.md
    svc.logFeaturePulse({ id: "base", note: "accepted while stale" });
    expect(svc.check()).toMatchObject({ ok: true, editable: true, stale: false });

    breakDependency(tempDir);
    check = svc.check();
    expect(check.editable).toBe(false);
    expect(check.blocking!.map((i) => i.code)).toEqual(["MISSING_DEPENDENCY"]);
  });
});
