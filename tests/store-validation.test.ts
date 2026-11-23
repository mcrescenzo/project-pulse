import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateBeadsDrift, type BeadsClient } from "../src/beads";
import { RoadmapService } from "../src/store";
import type { BeadStatusInfo, Feature } from "../src/types";
import { buildRoadmapViewPayload } from "../src/view";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

let tempDir: string;
let svc: RoadmapService;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-storeval-"));
  svc = new RoadmapService(tempDir);
  svc.init({ name: "Store Validation" });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function pulsePath(...parts: string[]): string {
  return join(tempDir, ".project-pulse", ...parts);
}

function featurePath(id: string): string {
  return pulsePath("features", `${id}.md`);
}

function roadmapFile(): string {
  return join(tempDir, "ROADMAP.md");
}

function configRaw(): string {
  return readFileSync(pulsePath("config.yaml"), "utf8");
}

/**
 * Writes a hand-authored feature file (bypassing mutation APIs) to model persisted stores.
 */
function writeFeatureFixture(id: string, yamlLines: string[]): void {
  writeFileSync(featurePath(id), `---\n${yamlLines.join("\n")}\n---\n`);
}

function codesOf(errors: Array<{ code: string }>): string[] {
  return errors.map((e) => e.code);
}

function makeFeature(overrides: Partial<Feature> & { id: string }): Feature {
  return {
    title: overrides.id,
    milestone: "backlog",
    order: 10,
    status: "planned",
    depends_on: [],
    refs: [],
    ship_criteria: [],
    updates: [],
    description: "",
    ...overrides,
  };
}

function stubBeads(status: string): BeadsClient {
  return {
    async resolveRefs(refs: string[]): Promise<BeadStatusInfo[]> {
      return refs.map((ref) => ({
        ref,
        id: ref.slice(3),
        available: true,
        found: true,
        status,
        title: "Stub issue",
      }));
    },
  };
}

describe("pp-f7m.12: criterion id uniqueness, blank text, and selector disambiguation", () => {
  test("addFeature rejects duplicate explicit criterion ids without partial writes", () => {
    const roadmapBefore = readFileSync(roadmapFile(), "utf8");
    expect(() =>
      svc.addFeature({
        id: "dup-ids",
        title: "Dup",
        ship_criteria: [
          { id: "fast", text: "Fast" },
          { id: "fast", text: "Faster" },
        ],
      })
    ).toThrow(/Duplicate ship criterion id 'fast'/);
    expect(existsSync(featurePath("dup-ids"))).toBe(false);
    expect(readFileSync(roadmapFile(), "utf8")).toBe(roadmapBefore);
  });

  test("explicit criterion ids conflicting with generated ids are rejected", () => {
    expect(() =>
      svc.addFeature({
        id: "collide",
        title: "Collide",
        ship_criteria: [{ text: "≤1%" }, { id: "c-1", text: "Explicit" }],
      })
    ).toThrow(/Duplicate ship criterion id 'c-1'/);
    expect(existsSync(featurePath("collide"))).toBe(false);
  });

  test("explicit numeric criterion ids are rejected at creation and replacement", () => {
    expect(() =>
      svc.addFeature({ id: "num-id", title: "Num", ship_criteria: [{ id: "1", text: "One" }] })
    ).toThrow(/numeric/);
    svc.addFeature({ id: "num-id", title: "Num", ship_criteria: ["Plain"] });
    expect(() =>
      svc.updateFeature("num-id", {
        ship_criteria: [{ id: "2", text: "Two" }],
      })
    ).toThrow(/numeric/);
  });

  test("generated numeric-only ids are prefixed and numeric selectors mean 1-based positions", () => {
    svc.addFeature({
      id: "ord",
      title: "Ordinal",
      ship_criteria: ["Fast", "≤1%"],
    });
    const stored = svc.load().features.find((f) => f.id === "ord")!;
    expect(stored.ship_criteria.map((c) => c.id)).toEqual(["fast", "c-1"]);

    // Selector "1" must mark the first (user-visible) checkbox, not the criterion whose
    // generated id happens to be numeric.
    svc.checkFeatureCriterion("ord", "1", true);
    let after = svc.load().features.find((f) => f.id === "ord")!;
    expect(after.ship_criteria[0]).toMatchObject({ id: "fast", done: true });
    expect(after.ship_criteria[1]).toMatchObject({ id: "c-1", done: false });

    svc.checkFeatureCriterion("ord", "2", true);
    after = svc.load().features.find((f) => f.id === "ord")!;
    expect(after.ship_criteria[1]!.done).toBe(true);
  });

  test("non-numeric ids select by id; out-of-range numeric selectors explain the rule", () => {
    svc.addFeature({ id: "sel", title: "Sel", ship_criteria: ["Alpha", "Beta"] });
    svc.checkFeatureCriterion("sel", "beta", true);
    expect(svc.load().features.find((f) => f.id === "sel")!.ship_criteria[1]!.done).toBe(true);
    expect(() => svc.checkFeatureCriterion("sel", "9", true)).toThrow(/1-based positions \(1-2\)/);
    expect(() => svc.checkFeatureCriterion("sel", "9", true)).toThrow(/non-numeric id/);
  });

  test("updateFeature replacement with duplicate ids throws and leaves the file untouched", () => {
    svc.addFeature({ id: "replace", title: "Replace", ship_criteria: ["One", "Two"] });
    const fileBefore = readFileSync(featurePath("replace"), "utf8");
    const roadmapBefore = readFileSync(roadmapFile(), "utf8");
    expect(() =>
      svc.updateFeature("replace", {
        ship_criteria: [
          { id: "x", text: "X" },
          { id: "x", text: "Y" },
        ],
      })
    ).toThrow(/Duplicate ship criterion id 'x'/);
    expect(readFileSync(featurePath("replace"), "utf8")).toBe(fileBefore);
    expect(readFileSync(roadmapFile(), "utf8")).toBe(roadmapBefore);
  });

  test("blank criterion text is rejected on creation, replacement, and add", () => {
    expect(() =>
      svc.addFeature({ id: "blank-a", title: "A", ship_criteria: ["Real", "   "] })
    ).toThrow(/blank text/);
    expect(() =>
      svc.addFeature({ id: "blank-b", title: "B", ship_criteria: [{ text: "  " }] })
    ).toThrow(/blank text/);
    svc.addFeature({ id: "blank-c", title: "C", ship_criteria: ["Real"] });
    expect(() =>
      svc.updateFeature("blank-c", { ship_criteria: [{ id: "x", text: "" }] })
    ).toThrow(/blank text/);
    expect(() => svc.updateFeature("blank-c", { addCriteria: ["  "] })).toThrow(
      /must be non-empty/
    );
    expect(svc.load().features.find((f) => f.id === "blank-c")!.ship_criteria).toHaveLength(1);
  });

  test("stored YAML with blank criterion text surfaces in pp check", () => {
    writeFeatureFixture("broken-blank", [
      "id: broken-blank",
      "title: Broken Blank",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "ship_criteria:",
      "  - id: keep",
      "    text: Keep",
      "    done: false",
      "  - id: empty",
      '    text: ""',
      "    done: false",
    ]);
    const result = svc.check();
    expect(result.ok).toBe(false);
    expect(codesOf(result.errors)).toContain("INVALID_SHIP_CRITERIA");
    expect(
      result.errors.find((e) => e.message.includes("broken-blank"))?.message
    ).toMatch(/ship_criteria\[1\] text must be a non-empty string/);
    expect(() => svc.checkFeatureCriterion("broken-blank", "1", true)).toThrow(
      /text must be a non-empty string/
    );
  });

  test("stored YAML with duplicate criterion ids surfaces in pp check before aliasing", () => {
    writeFeatureFixture("broken-dup", [
      "id: broken-dup",
      "title: Broken Dup",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "ship_criteria:",
      '  - id: "1"',
      "    text: One",
      "    done: false",
      '  - id: "1"',
      "    text: Two",
      "    done: false",
    ]);
    const result = svc.check();
    expect(result.ok).toBe(false);
    expect(codesOf(result.errors)).toContain("DUPLICATE_SHIP_CRITERION_ID");
    expect(result.errors.find((e) => e.code === "DUPLICATE_SHIP_CRITERION_ID")?.message).toMatch(
      /entries 1 and 2 share id '1'/
    );
    // Duplicate numeric ids are diagnosed (not silently mapped), so mutations stay refused.
    expect(() => svc.checkFeatureCriterion("broken-dup", "1", true)).toThrow(
      /share id '1'/
    );
  });

  test("legacy unique numeric ids normalize to display aliases and the store stays mutable", () => {
    // Legacy store: a digit-only stored id on the criterion at position 2.
    writeFeatureFixture("legacy-num", [
      "id: legacy-num",
      "title: Legacy Num",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "ship_criteria:",
      "  - id: fast",
      "    text: Fast",
      "    done: false",
      '  - id: "1"',
      "    text: ≤1% latency",
      "    done: false",
    ]);
    svc.render();
    expect(svc.check().ok).toBe(true);

    // The stored canonical numeric id stays in the file until this feature is next mutated.
    expect(readFileSync(featurePath("legacy-num"), "utf8")).toContain('id: "1"');

    // In memory (check/show/dashboard payloads) the id is a collision-free display alias.
    const stored = svc.load().features.find((f) => f.id === "legacy-num")!;
    expect(stored.ship_criteria.map((c) => c.id)).toEqual(["fast", "c-2"]);

    // CLI ordinal: "1" toggles the first checkbox, never the criterion whose id was "1".
    svc.checkFeatureCriterion("legacy-num", "1", true);
    let after = svc.load().features.find((f) => f.id === "legacy-num")!;
    expect(after.ship_criteria[0]).toMatchObject({ id: "fast", done: true });
    expect(after.ship_criteria[1]).toMatchObject({ id: "c-2", done: false });

    // UI/service: the exposed display id toggles the second checkbox.
    svc.checkFeatureCriterion("legacy-num", "c-2", true);
    after = svc.load().features.find((f) => f.id === "legacy-num")!;
    expect(after.ship_criteria[1]!.done).toBe(true);

    // That feature's mutation persisted the alias over the stored numeric canonical.
    const persisted = readFileSync(featurePath("legacy-num"), "utf8");
    expect(persisted).toContain("id: c-2");
    expect(persisted).not.toContain('id: "1"');
    expect(svc.check().ok).toBe(true);
  });

  test("aliases avoid existing non-numeric ids deterministically", () => {
    writeFeatureFixture("alias-clash", [
      "id: alias-clash",
      "title: Alias Clash",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "ship_criteria:",
      "  - id: c-2",
      "    text: Keep",
      "    done: false",
      '  - id: "1"',
      "    text: Legacy",
      "    done: false",
    ]);
    const stored = svc.load().features.find((f) => f.id === "alias-clash")!;
    expect(stored.ship_criteria.map((c) => c.id)).toEqual(["c-2", "c-2-2"]);
  });

  test("unquoted numeric YAML ids alias like quoted ones; non-scalar ids are diagnosed", () => {
    writeFeatureFixture("num-yaml", [
      "id: num-yaml",
      "title: Num Yaml",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "ship_criteria:",
      "  - id: 1",
      "    text: First",
    ]);
    const stored = svc.load().features.find((f) => f.id === "num-yaml")!;
    expect(stored.ship_criteria[0]).toMatchObject({ id: "c-1", text: "First", done: false });

    writeFeatureFixture("bool-id", [
      "id: bool-id",
      "title: Bool Id",
      "milestone: backlog",
      "order: 20",
      "status: planned",
      "ship_criteria:",
      "  - id: true",
      "    text: Flag",
    ]);
    const result = svc.check();
    expect(
      result.errors.some((e) => e.message.includes("id must be a string (got boolean)"))
    ).toBe(true);
  });
});

describe("pp-f7m.26: removal rollback leaves prior entities and roadmap consistent", () => {
  test.skipIf(isRoot)(
    "read-only milestones directory fails remove --reassign before any feature moves",
    () => {
      svc.upsertMilestone({ id: "m1", title: "M1" });
      svc.upsertMilestone({ id: "m2", title: "M2" });
      svc.addFeature({ id: "f1", title: "F1", milestone: "m1", ship_criteria: ["A"] });
      svc.addFeature({ id: "f2", title: "F2", milestone: "m1", ship_criteria: ["B"] });
      const f1Before = readFileSync(featurePath("f1"), "utf8");
      const f2Before = readFileSync(featurePath("f2"), "utf8");
      const roadmapBefore = readFileSync(roadmapFile(), "utf8");

      chmodSync(pulsePath("milestones"), 0o500);
      let thrown: unknown;
      try {
        try {
          svc.removeMilestone("m1", { reassignTo: "m2" });
        } catch (error) {
          thrown = error;
        }
      } finally {
        chmodSync(pulsePath("milestones"), 0o755);
      }

      expect((thrown as Error).message).toMatch(/milestones.*not writable/);
      expect(readFileSync(featurePath("f1"), "utf8")).toBe(f1Before);
      expect(readFileSync(featurePath("f2"), "utf8")).toBe(f2Before);
      expect(readFileSync(roadmapFile(), "utf8")).toBe(roadmapBefore);
      expect(existsSync(pulsePath("milestones", "m1.md"))).toBe(true);
      expect(svc.load().features.every((f) => f.milestone === "m1")).toBe(true);
      expect(svc.check().ok).toBe(true);
    }
  );

  test("forced feature removal rolls back written dependents when a later write fails", () => {
    svc.addFeature({ id: "base", title: "Base", ship_criteria: ["A"] });
    svc.addFeature({ id: "dep1", title: "Dep1", depends_on: ["base"], order: 10 });
    svc.addFeature({ id: "dep2", title: "Dep2", depends_on: ["base"], order: 20 });
    const dep1Before = readFileSync(featurePath("dep1"), "utf8");
    const dep2Before = readFileSync(featurePath("dep2"), "utf8");
    const roadmapBefore = readFileSync(roadmapFile(), "utf8");

    const real = svc.writeFeatureFile.bind(svc);
    let calls = 0;
    svc.writeFeatureFile = (feature: Feature): void => {
      calls += 1;
      if (calls === 2) throw new Error("simulated EIO while writing dependent");
      real(feature);
    };

    expect(() => svc.removeFeature("base", { force: true })).toThrow(/simulated EIO/);

    expect(readFileSync(featurePath("dep1"), "utf8")).toBe(dep1Before);
    expect(readFileSync(featurePath("dep2"), "utf8")).toBe(dep2Before);
    expect(existsSync(featurePath("base"))).toBe(true);
    expect(readFileSync(roadmapFile(), "utf8")).toBe(roadmapBefore);
    expect(svc.check().ok).toBe(true);
    expect(readdirSync(pulsePath("features")).every((f) => !f.startsWith(".tmp."))).toBe(true);
  });

  test("staged removal restores a removed milestone's permissions on failure", () => {
    svc.upsertMilestone({ id: "m1", title: "M1" });
    svc.addFeature({ id: "mf", title: "MF", milestone: "m1" });
    const milestonePath = pulsePath("milestones", "m1.md");
    chmodSync(milestonePath, 0o600);
    const roadmapBefore = readFileSync(roadmapFile(), "utf8");

    svc.render = (): never => {
      throw new Error("simulated render failure");
    };

    expect(() => svc.removeMilestone("m1", { reassignTo: "backlog" })).toThrow(
      /simulated render failure/
    );

    // Rename-back preserves file metadata (mode), unlike rewriting restored UTF-8 contents.
    expect(existsSync(milestonePath)).toBe(true);
    expect(statSync(milestonePath).mode & 0o777).toBe(0o600);
    expect(readFileSync(milestonePath, "utf8")).toContain("id: m1");
    expect(readFileSync(roadmapFile(), "utf8")).toBe(roadmapBefore);
    expect(svc.load().features.find((f) => f.id === "mf")!.milestone).toBe("m1");
    expect(readdirSync(pulsePath("milestones")).filter((f) => f.startsWith(".tmp."))).toEqual([]);
    expect(svc.check().ok).toBe(true);
  });

  test("remove --reassign succeeds end to end and leaves no staged files", () => {
    svc.upsertMilestone({ id: "m1", title: "M1" });
    svc.upsertMilestone({ id: "m2", title: "M2" });
    svc.addFeature({ id: "mf", title: "MF", milestone: "m1", ship_criteria: ["A"] });
    const result = svc.removeMilestone("m1", { reassignTo: "m2" });
    expect(result.reassignedFeatures).toEqual(["mf"]);
    expect(existsSync(pulsePath("milestones", "m1.md"))).toBe(false);
    expect(readdirSync(pulsePath("milestones")).every((f) => !f.startsWith(".tmp."))).toBe(true);
    expect(svc.load().features.find((f) => f.id === "mf")!.milestone).toBe("m2");
    expect(svc.check().ok).toBe(true);
  });
});

describe("pp-f7m.27: config and field type strictness", () => {
  test("init rejects a blank name before writing anything", () => {
    const fresh = join(tempDir, "fresh");
    expect(() => new RoadmapService(fresh).init({ name: "   " })).toThrow(
      /Project name must be non-empty/
    );
    expect(existsSync(join(fresh, ".project-pulse"))).toBe(false);
    expect(existsSync(join(fresh, "ROADMAP.md"))).toBe(false);
  });

  test("blank summary is a valid explicit clear on re-init", () => {
    expect(() => svc.init({ summary: "   " })).not.toThrow();
    expect(svc.load().config.project.summary).toBe("");
    // Re-init without --summary keeps the stored (empty) summary; a new name still applies.
    expect(() => svc.init({ name: "Renamed Again" })).not.toThrow();
    expect(svc.load().config.project.summary).toBe("");
    expect(svc.load().config.project.name).toBe("Renamed Again");
  });

  test("fresh init with a blank summary falls back to the default summary", () => {
    const fresh = join(tempDir, "fresh-summary");
    const result = new RoadmapService(fresh).init({ summary: "  " });
    expect(result.config.project.summary).toBe(
      "High-level product roadmap managed with project-pulse."
    );
  });

  test("init rejects a blank name on an existing store without rewriting config", () => {
    const before = configRaw();
    expect(() => svc.init({ name: " " })).toThrow(/Project name must be non-empty/);
    expect(configRaw()).toBe(before);
  });

  test("re-init refuses unsupported schema versions before touching user files", () => {
    writeFileSync(pulsePath("config.yaml"), configRaw().replace("version: 1", "version: 2"));
    const before = configRaw();
    expect(() => svc.init({ name: "Renamed" })).toThrow(/Unsupported config version 2/);
    expect(configRaw()).toBe(before);
  });

  test("re-init refuses lossy rewrites of ill-typed config fields", () => {
    writeFileSync(
      pulsePath("config.yaml"),
      configRaw().replace("enabled: true", 'enabled: "false"')
    );
    const before = configRaw();
    expect(() => svc.init({ name: "Renamed" })).toThrow(
      /Refusing to rewrite.*integrations\.beads\.enabled/
    );
    expect(configRaw()).toBe(before);
  });

  test("check diagnoses ill-typed stored config fields, including disabled integrations", () => {
    writeFileSync(
      pulsePath("config.yaml"),
      configRaw().replace("enabled: true", 'enabled: "false"')
    );
    const result = svc.check();
    expect(result.ok).toBe(false);
    expect(codesOf(result.errors)).toContain("INVALID_CONFIG_FIELD");
    expect(
      result.errors.find((e) => e.message.includes("integrations.beads.enabled"))?.message
    ).toMatch(/must be a boolean \(got string\)/);
  });

  test("null fields and non-object sections are diagnosed; omitted sections keep defaults", () => {
    // null is a present wrong type, not an omitted field.
    writeFileSync(pulsePath("config.yaml"), configRaw().replace("enabled: true", "enabled:"));
    let result = svc.check();
    expect(
      result.errors.some(
        (e) => e.message.includes("integrations.beads.enabled") && e.message.includes("got null")
      )
    ).toBe(true);

    writeFileSync(
      pulsePath("config.yaml"),
      ["version: 1", "project: oops", "defaults:", "  milestone: backlog", "", ""].join("\n")
    );
    result = svc.check();
    expect(
      result.errors.some((e) => e.message.includes("section 'project' must be a mapping"))
    ).toBe(true);

    // Omitted sections keep their documented defaults without any diagnosis.
    writeFileSync(
      pulsePath("config.yaml"),
      "version: 1\nproject:\n  name: Store Validation\n"
    );
    result = svc.check();
    expect(result.errors.filter((e) => e.code === "INVALID_CONFIG_FIELD")).toEqual([]);
    expect(svc.load().config.integrations.beads.enabled).toBe(true);
    expect(svc.load().config.defaults.milestone).toBe("backlog");
  });

  test("check diagnoses ill-typed depends_on and refs", () => {
    writeFeatureFixture("bad-deps", [
      "id: bad-deps",
      "title: Bad Deps",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      'depends_on: "oops"',
      "refs: []",
    ]);
    writeFeatureFixture("bad-refs", [
      "id: bad-refs",
      "title: Bad Refs",
      "milestone: backlog",
      "order: 20",
      "status: planned",
      "depends_on: []",
      "refs: 42",
    ]);
    const result = svc.check();
    expect(codesOf(result.errors)).toContain("INVALID_DEPENDS_ON");
    expect(codesOf(result.errors)).toContain("INVALID_REFS");
    expect(
      result.errors.find((e) => e.message.includes("bad-deps") && e.message.includes("depends_on"))
        ?.message
    ).toMatch(/must be a list of strings/);
  });

  test("non-string dependency items are diagnosed while valid strings are kept", () => {
    writeFeatureFixture("mixed-deps", [
      "id: mixed-deps",
      "title: Mixed Deps",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "depends_on:",
      "  - 7",
      "  - ok-dep",
      "refs: []",
    ]);
    const result = svc.check();
    expect(
      result.errors.some((e) => e.message.includes("depends_on[0] must be a string"))
    ).toBe(true);
    expect(svc.load().features.find((f) => f.id === "mixed-deps")!.depends_on).toEqual(["ok-dep"]);
  });

  test("ill-typed criterion done flags are diagnosed and never flip to true", () => {
    writeFeatureFixture("bad-done", [
      "id: bad-done",
      "title: Bad Done",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "ship_criteria:",
      "  - id: gated",
      "    text: Gated",
      '    done: "false"',
    ]);
    const result = svc.check();
    expect(result.errors.some((e) => e.message.includes("done must be a boolean"))).toBe(true);
    expect(svc.load().features.find((f) => f.id === "bad-done")!.ship_criteria[0]!.done).toBe(
      false
    );
  });

  test("valid legacy formatting keeps passing: null lists, absent done, disabled integration", () => {
    writeFileSync(pulsePath("config.yaml"), configRaw().replace("enabled: true", "enabled: false"));
    writeFeatureFixture("legacy-ok", [
      "id: legacy-ok",
      "title: Legacy Ok",
      "milestone: backlog",
      "order: 10",
      "status: planned",
      "depends_on:",
      "refs:",
      "ship_criteria:",
      "  - id: plain",
      "    text: Plain",
    ]);
    svc.render();
    expect(svc.check().ok).toBe(true);
    const feature = svc.load().features.find((f) => f.id === "legacy-ok")!;
    expect(feature.depends_on).toEqual([]);
    expect(feature.refs).toEqual([]);
    expect(feature.ship_criteria[0]).toMatchObject({ id: "plain", text: "Plain", done: false });
    expect(svc.load().config.integrations.beads.enabled).toBe(false);
  });
});

describe("pp-f7m.28: CRLF-only roadmap conversions pass check", () => {
  test("CRLF conversion passes pp check", () => {
    expect(svc.check().ok).toBe(true);
    const content = readFileSync(roadmapFile(), "utf8");
    writeFileSync(roadmapFile(), content.replace(/\n/g, "\r\n"));
    const result = svc.check();
    expect(result.ok).toBe(true);
    expect(codesOf(result.errors)).not.toContain("ROADMAP_OUT_OF_SYNC");
  });

  test("substantive content changes still fail under CRLF", () => {
    const content = readFileSync(roadmapFile(), "utf8");
    const changed = content
      .replace(/\n/g, "\r\n")
      .replace("Store Validation", "Store Validation Edited");
    writeFileSync(roadmapFile(), changed);
    const result = svc.check();
    expect(result.ok).toBe(false);
    expect(codesOf(result.errors)).toContain("ROADMAP_OUT_OF_SYNC");
  });

  test("LF content that matches still passes (control)", () => {
    expect(svc.check().ok).toBe(true);
  });
});

describe("pp-f7m.29: feature-to-Beads mapping is own-key safe", () => {
  test("checkWithBeads stays healthy for feature id 'constructor' without refs", async () => {
    svc.addFeature({ id: "constructor", title: "Constructor" });
    const result = await svc.checkWithBeads({ beads: true, beadsClient: stubBeads("open") });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(Object.hasOwn(result.beads ?? {}, "constructor")).toBe(false);
  });

  test("checkWithBeads resolves drift for feature id 'constructor' with refs", async () => {
    svc.addFeature({ id: "constructor", title: "Constructor", refs: ["bd:pp-9"] });
    const result = await svc.checkWithBeads({ beads: true, beadsClient: stubBeads("closed") });
    expect(codesOf(result.errors)).toContain("BEADS_DRIFT_ALL_CLOSED");
    expect(Object.hasOwn(result.beads ?? {}, "constructor")).toBe(true);
    expect(result.beads!["constructor"]).toHaveLength(1);
    expect(result.beads!["constructor"]![0]).toMatchObject({ ref: "bd:pp-9", id: "pp-9" });
  });

  test("dashboard payload beads lookups are own-key safe", async () => {
    svc.addFeature({ id: "constructor", title: "Constructor", refs: ["bd:pp-9"] });
    const withBeads = await buildRoadmapViewPayload(svc, {
      beads: true,
      beadsClient: stubBeads("open"),
    });
    expect(Object.getPrototypeOf(withBeads.beads)).toBeNull();
    expect(withBeads.beads["constructor"]).toHaveLength(1);

    const withoutBeads = await buildRoadmapViewPayload(svc, {
      beads: false,
      beadsClient: stubBeads("open"),
    });
    expect(Object.getPrototypeOf(withoutBeads.beads)).toBeNull();
    expect(Object.hasOwn(withoutBeads.beads, "constructor")).toBe(false);
  });

  test("evaluateBeadsDrift uses own-key lookup on plain-object indexes", () => {
    const features = [makeFeature({ id: "constructor", refs: ["bd:x"] })];

    const withOwnEntry: Record<string, BeadStatusInfo[]> = {
      constructor: [{ ref: "bd:x", id: "x", available: true, found: true, status: "closed" }],
    };
    const drift = evaluateBeadsDrift(features, withOwnEntry);
    expect(codesOf(drift)).toContain("BEADS_DRIFT_ALL_CLOSED");

    const empty: Record<string, BeadStatusInfo[]> = {};
    expect(evaluateBeadsDrift(features, empty)).toEqual([]);

    const toStringFeature = [makeFeature({ id: "toString", refs: ["bd:y"] })];
    expect(evaluateBeadsDrift(toStringFeature, empty)).toEqual([]);
  });
});
