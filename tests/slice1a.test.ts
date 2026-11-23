import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli-main";
import { parseMarkdownFile, serializeFeature, serializeMilestone } from "../src/frontmatter";
import { RoadmapService } from "../src/store";
import type { Feature, Milestone } from "../src/types";
import { runCliCaptured as runCliCapturedImpl } from "./helpers/cli";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-s1a-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Lockstep wrapper: every case in this file runs the CLI with cwd bound to the per-test tempDir.
async function runCliCaptured(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return runCliCapturedImpl(args, { cwd: tempDir });
}

describe("Slice 1a: Store, Frontmatter, Renderer, Validator, CLI Foundation", () => {
  test("canonical frontmatter serialization preserves key order and handles horizontal rules in body", () => {
    const milestone: Milestone = {
      id: "v0.1",
      title: "v0.1 — Core",
      order: 10,
      status: "active",
      target: "2026-Q4",
      description: "First milestone.\n\n---\n\nDetails after HR.",
    };
    const serializedM = serializeMilestone(milestone);
    const keyPositionsM = ["id:", "title:", "order:", "status:", "target:"].map((k) =>
      serializedM.indexOf(k)
    );
    expect(keyPositionsM.every((p, i) => i === 0 || p > keyPositionsM[i - 1]!)).toBe(true);

    const parsedM = parseMarkdownFile(serializedM);
    expect(parsedM.frontmatter.id).toBe("v0.1");
    expect(parsedM.body).toBe("First milestone.\n\n---\n\nDetails after HR.");

    const feature: Feature = {
      id: "core-store",
      title: "Core Store: YAML & Markdown",
      milestone: "v0.1",
      order: 10,
      status: "in-progress",
      area: "Core",
      depends_on: ["init-cmd"],
      refs: ["bd:pp-1", "gh:#2"],
      ship_criteria: [{ id: "c-1", text: "Atomic writes", done: true }],
      updates: [{ at: "2026-11-19T23:00:00Z", note: "Started" }],
      description: "Stores atomic feature files.",
    };
    const serializedF = serializeFeature(feature);
    const keyPositionsF = [
      "id:",
      "title:",
      "milestone:",
      "order:",
      "status:",
      "area:",
      "depends_on:",
      "refs:",
      "ship_criteria:",
      "updates:",
    ].map((k) => serializedF.indexOf(k));
    expect(keyPositionsF.every((p, i) => i === 0 || p > keyPositionsF[i - 1]!)).toBe(true);

    const parsedF = parseMarkdownFile(serializedF);
    expect(parsedF.frontmatter.refs).toEqual(["bd:pp-1", "gh:#2"]);
    expect(parsedF.body).toBe("Stores atomic feature files.");
  });

  test("pp init scaffolds .project-pulse/ and generates ROADMAP.md", async () => {
    const res = await runCliCaptured(["init", "--name", "Alpha App", "--summary", "Test summary", "--json"]);
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.created).toBe(true);
    expect(payload.config.project.name).toBe("Alpha App");

    expect(existsSync(join(tempDir, ".project-pulse/config.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, ".project-pulse/milestones"))).toBe(true);
    expect(existsSync(join(tempDir, ".project-pulse/features"))).toBe(true);
    expect(existsSync(join(tempDir, "ROADMAP.md"))).toBe(true);

    const roadmap = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(roadmap).toContain("# Alpha App — Roadmap");
    expect(roadmap).toContain("Test summary");
  });

  test("deterministic rendering sorts milestones and features by order then id, and pp check detects drift", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Demo" });

    svc.writeMilestoneFile({
      id: "v0.2",
      title: "v0.2 Next",
      order: 20,
      status: "planned",
      description: "Second release",
    });
    svc.writeMilestoneFile({
      id: "v0.1",
      title: "v0.1 First",
      order: 10,
      status: "active",
      description: "First release",
    });

    svc.writeFeatureFile({
      id: "zeta",
      title: "Zeta",
      milestone: "v0.1",
      order: 10,
      status: "planned",
      depends_on: ["alpha"],
      refs: [],
      ship_criteria: [],
      updates: [],
      description: "Zeta desc",
    });
    svc.writeFeatureFile({
      id: "alpha",
      title: "Alpha",
      milestone: "v0.1",
      order: 10,
      status: "shipped",
      area: "Core",
      depends_on: [],
      refs: ["bd:pp-1"],
      ship_criteria: [{ id: "c-1", text: "Works", done: true }],
      updates: [{ at: "2026-11-19T12:00:00Z", note: "Shipped" }],
      description: "Alpha desc",
    });

    svc.render();
    const md = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(md.indexOf("## v0.1 First")).toBeLessThan(md.indexOf("## v0.2 Next"));
    expect(md.indexOf("### Alpha (`alpha`)")).toBeLessThan(md.indexOf("### Zeta (`zeta`)"));

    const okRes = await runCliCaptured(["check", "--json"]);
    expect(okRes.code).toBe(0);
    expect(JSON.parse(okRes.stdout).ok).toBe(true);

    // Corrupt ROADMAP.md -> pp check fails with ROADMAP_OUT_OF_SYNC
    writeFileSync(join(tempDir, "ROADMAP.md"), "# Hand edited\n", "utf8");
    const staleRes = await runCliCaptured(["check", "--json"]);
    expect(staleRes.code).toBe(1);
    const staleJson = JSON.parse(staleRes.stdout);
    expect(staleJson.ok).toBe(false);
    expect(staleJson.errors.some((e: { code: string }) => e.code === "ROADMAP_OUT_OF_SYNC")).toBe(true);

    // pp render restores ROADMAP.md
    const renderCode = await runCli(["render", "--root", tempDir]);
    expect(renderCode).toBe(0);
    expect(svc.check().ok).toBe(true);
  });

  test("pp check catches missing milestone, missing dependency, dependency cycle, invalid status, and warns on >6 ship_criteria", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Checks" });
    svc.writeMilestoneFile({
      id: "v0.1",
      title: "v0.1",
      order: 10,
      status: "bogus" as Milestone["status"],
      description: "",
    });
    svc.writeFeatureFile({
      id: "feat-a",
      title: "Feat A",
      milestone: "missing-m",
      order: 10,
      status: "invalid-status" as Feature["status"],
      depends_on: ["feat-b", "ghost"],
      refs: [],
      ship_criteria: Array.from({ length: 7 }, (_, i) => ({
        id: `c-${i + 1}`,
        text: `Criterion ${i + 1}`,
        done: false,
      })),
      updates: [],
      description: "",
    });
    svc.writeFeatureFile({
      id: "feat-b",
      title: "Feat B",
      milestone: "v0.1",
      order: 20,
      status: "planned",
      depends_on: ["feat-a"],
      refs: [],
      ship_criteria: [],
      updates: [],
      description: "",
    });
    svc.render();

    const check = svc.check();
    expect(check.ok).toBe(false);
    const errorCodes = check.errors.map((e) => e.code);
    expect(errorCodes).toContain("INVALID_MILESTONE_STATUS");
    expect(errorCodes).toContain("INVALID_FEATURE_STATUS");
    expect(errorCodes).toContain("MISSING_MILESTONE");
    expect(errorCodes).toContain("MISSING_DEPENDENCY");
    expect(errorCodes).toContain("DEPENDENCY_CYCLE");

    expect(check.warnings.some((w) => w.code === "TOO_MANY_SHIP_CRITERIA")).toBe(true);
  });
});
