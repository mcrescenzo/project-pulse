import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMarkdownFile, serializeConfig, serializeFeature, serializeMilestone } from "../src/frontmatter";
import { RoadmapService } from "../src/store";
import type { Feature, Milestone, PulseConfig } from "../src/types";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-yaml-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function runCliCaptured(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "../src/cli.ts"), ...args], {
    cwd: tempDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

// Values whose plain YAML form is ambiguous on supported Bun runtimes:
// numeric/boolean/null/date look-alikes, colon-terminated strings, and
// parser-structure look-alikes.
const AMBIGUOUS_TITLES = [
  "0.5",
  "007",
  "0x1F",
  "1e3",
  "12:30",
  "2026-11-20",
  "true",
  "null",
  "~",
  "",
  "Launch:",
  "a: b",
  "Note with colon: ",
  "line1\nline2",
  " - leading dash",
  "# leading hash",
];

describe("Frontmatter YAML round-trip", () => {
  test("ambiguous titles survive serialize and reload unchanged as strings", () => {
    for (const title of AMBIGUOUS_TITLES) {
      const milestone: Milestone = {
        id: "m",
        title,
        order: 1,
        status: "planned",
        target: "2026-Q4",
        description: "",
      };
      const parsed = parseMarkdownFile(serializeMilestone(milestone));
      expect(parsed.frontmatter.title).toBe(title);
      expect(typeof parsed.frontmatter.title).toBe("string");
    }
  });

  test("ambiguous values survive feature sequences, nested maps, and multiline notes", () => {
    const dependsOn = ["0.5", "Launch:", "", "true"];
    const feature: Feature = {
      id: "f",
      title: "0.5",
      milestone: "m",
      order: 0,
      status: "planned",
      depends_on: dependsOn,
      refs: ["gh:#2", "bd:pp-1"],
      ship_criteria: [
        { id: "c-1", text: "Launch:", done: true },
        { id: "c-2", text: "0.5", done: false },
        { id: "c-3", text: "line1\nline2", done: false },
      ],
      updates: [
        { at: "2026-11-20T14:05:52.853Z", note: "Note with colon: " },
        { at: "2026-11-21T00:00:00Z", note: "0.5" },
      ],
      description: "",
    };
    const fm = parseMarkdownFile(serializeFeature(feature)).frontmatter;
    expect(fm.title).toBe("0.5");
    const loadedDeps = fm.depends_on as unknown[];
    expect(loadedDeps).toEqual(dependsOn);
    expect(loadedDeps.every((v) => typeof v === "string")).toBe(true);
    expect(fm.refs).toEqual(["gh:#2", "bd:pp-1"]);
    expect(fm.ship_criteria).toEqual(feature.ship_criteria);
    expect(fm.updates).toEqual(feature.updates);
    expect(fm.order).toBe(0);
    expect(typeof fm.order).toBe("number");
  });

  test("config round-trips deterministically and republishes byte-identically", () => {
    const config: PulseConfig = {
      version: 1,
      project: { name: "Launch:", summary: "Multi\nline summary." },
      defaults: { milestone: "backlog" },
      integrations: { beads: { enabled: true } },
    };
    const yaml = serializeConfig(config);
    const reparsed = Bun.YAML.parse(yaml) as PulseConfig;
    expect(reparsed).toEqual(config);
    expect(typeof reparsed.project.name).toBe("string");
    expect(reparsed.project.summary).toBe("Multi\nline summary.");
    expect(serializeConfig(reparsed)).toBe(yaml);
  });

  test("milestone files republish byte-identically after reload", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Launch:" });
    const { entity } = svc.upsertMilestone({
      id: "m1",
      title: "0.5",
      target: "2026-12-31",
      description: "Body line.",
    });
    const onDisk = readFileSync(join(tempDir, ".project-pulse", "milestones", "m1.md"), "utf8");
    const parsed = parseMarkdownFile(onDisk);
    const reloaded: Milestone = {
      id: parsed.frontmatter.id as string,
      title: parsed.frontmatter.title as string,
      order: parsed.frontmatter.order as number,
      status: parsed.frontmatter.status as Milestone["status"],
      target: parsed.frontmatter.target as string,
      description: parsed.body,
    };
    expect(serializeMilestone(reloaded)).toBe(onDisk);
    expect(entity.title).toBe("0.5");
  });

  test("milestone with numeric-looking title survives add, reload, and check", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Launch:" });
    svc.upsertMilestone({ id: "m1", title: "0.5" });

    const reloaded = new RoadmapService(tempDir);
    const milestone = reloaded.load().milestones.find((m) => m.id === "m1");
    expect(milestone?.title).toBe("0.5");
    expect(typeof milestone?.title).toBe("string");

    const check = reloaded.check();
    expect(check.errors.filter((e) => e.code === "MISSING_MILESTONE_TITLE")).toEqual([]);
    expect(check.ok).toBe(true);
  });

  test("pp init with name 'Launch:' then pp summary reproduces the value", async () => {
    const init = await runCliCaptured(["init", "--name", "Launch:"]);
    expect(init.code).toBe(0);
    const summary = await runCliCaptured(["summary", "--json"]);
    expect(summary.code).toBe(0);
    expect(JSON.parse(summary.stdout).project.name).toBe("Launch:");
  });
});
