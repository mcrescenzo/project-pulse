import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliBeadsClient, type BeadsClient } from "../src/beads";
import { runCli } from "../src/cli";
import { formatSummaryText, RoadmapService } from "../src/store";
import type { BeadStatusInfo } from "../src/types";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-s2-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createStubBeadsClient(map: Record<string, Omit<BeadStatusInfo, "ref">>): BeadsClient {
  return {
    async resolveRefs(refs: string[]): Promise<BeadStatusInfo[]> {
      return refs
        .filter((r) => r.startsWith("bd:"))
        .map((ref) => {
          const id = ref.slice(3);
          const entry = map[id];
          if (!entry) {
            return { ref, id, available: true, found: false, error: "not found" };
          }
          return { ref, ...entry };
        });
    },
  };
}

describe("Slice 2: Orientation Commands & Read-Only Beads Drift Resolver", () => {
  test("pp summary remains under 500 words on a 15-feature / 3-milestone fixture and supports filtering", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Large Platform", summary: "End-to-end developer platform." });

    for (let m = 1; m <= 3; m++) {
      svc.upsertMilestone({
        id: `v0.${m}`,
        title: `v0.${m} Release`,
        order: m * 10,
        status: m === 1 ? "shipped" : m === 2 ? "active" : "planned",
        target: `2026-Q${m}`,
      });
      for (let f = 1; f <= 5; f++) {
        const fid = `m${m}-feat-${f}`;
        svc.addFeature({
          id: fid,
          title: `Capability ${m}.${f}`,
          milestone: `v0.${m}`,
          order: f * 10,
          status: m === 1 ? "shipped" : f <= 2 ? "in-progress" : "planned",
          area: f % 2 === 0 ? "API" : "Core",
          depends_on: f > 1 ? [`m${m}-feat-${f - 1}`] : [],
          refs: [`bd:pp-${m}${f}`],
          ship_criteria: ["Outcome one works reliably", "Outcome two passes verification"],
        });
        svc.addFeatureNote(fid, `Progress checkpoint ${m}.${f} completed cleanly`);
      }
    }

    const summary = svc.summary();
    expect(summary.totals.milestones).toBe(3);
    expect(summary.totals.features).toBe(15);
    expect(summary.milestones.length).toBe(3);

    const text = formatSummaryText(summary);
    const wordCount = text.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThan(500);
    expect(text).toContain("m1-feat-1");
    expect(text).toContain("m3-feat-5");

    const filtered = svc.summary({ milestone: "v0.2", status: "in-progress" });
    expect(filtered.milestones.length).toBe(1);
    expect(filtered.milestones[0]!.features.length).toBe(2);
  });

  test("pp show returns full feature details and resolved Beads refs", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Show Demo" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active" });
    svc.addFeature({
      id: "sync-engine",
      title: "Sync Engine",
      milestone: "v0.1",
      status: "in-progress",
      area: "Core",
      refs: ["bd:pp-42", "gh:#7"],
      ship_criteria: ["Queue offline mutations", "Flush on reconnect"],
      description: "Handles offline queuing and conflict-free replay.",
    });
    svc.checkFeatureCriterion("sync-engine", "1", true);
    svc.addFeatureNote("sync-engine", "Queue prototype working", "2026-11-19T10:00:00Z");

    const beadsClient = createStubBeadsClient({
      "pp-42": { id: "pp-42", available: true, found: true, status: "in_progress", title: "Implement queue" },
    });

    const detail = await svc.showFeature("sync-engine", { beads: true, beadsClient });
    expect(detail.feature.id).toBe("sync-engine");
    expect(detail.milestone?.id).toBe("v0.1");
    expect(detail.beads.length).toBe(1);
    expect(detail.beads[0]!.status).toBe("in_progress");

    const cliExit = await runCli(["show", "sync-engine", "--beads", "--root", tempDir], { beadsClient });
    expect(cliExit).toBe(0);
  });

  test("pp check --beads flags drift conditions and missing refs, and stays green when aligned", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Drift Demo" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active" });

    svc.addFeature({
      id: "all-closed-drift",
      title: "Should Be Shipped",
      milestone: "v0.1",
      status: "in-progress",
      refs: ["bd:pp-1"],
    });
    svc.addFeature({
      id: "open-shipped-drift",
      title: "Marked Shipped Early",
      milestone: "v0.1",
      status: "shipped",
      refs: ["bd:pp-2"],
    });
    svc.addFeature({
      id: "missing-bead",
      title: "Missing Bead Ref",
      milestone: "v0.1",
      status: "planned",
      refs: ["bd:pp-404"],
    });
    svc.addFeature({
      id: "aligned-feat",
      title: "Aligned Feature",
      milestone: "v0.1",
      status: "in-progress",
      refs: ["bd:pp-3"],
    });

    const beadsClient = createStubBeadsClient({
      "pp-1": { id: "pp-1", available: true, found: true, status: "closed", title: "Done" },
      "pp-2": { id: "pp-2", available: true, found: true, status: "in_progress", title: "Still WIP" },
      "pp-3": { id: "pp-3", available: true, found: true, status: "in_progress", title: "Active" },
    });

    const res = await svc.checkWithBeads({ beads: true, beadsClient });
    expect(res.ok).toBe(false);
    const errorCodes = res.errors.map((e) => e.code);
    expect(errorCodes).toContain("BEADS_DRIFT_ALL_CLOSED");
    expect(errorCodes).toContain("BEADS_DRIFT_UNCLOSED_SHIPPED");
    expect(errorCodes).toContain("BEADS_REF_NOT_FOUND");
    expect(res.errors.some((e) => e.entityId === "aligned-feat")).toBe(false);

    const cliExit = await runCli(["check", "--beads", "--root", tempDir], { beadsClient });
    expect(cliExit).toBe(1);
  });

  test("CliBeadsClient handles stubbed bd executable and degrades gracefully when bd binary is absent", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Real Spawn Demo" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1" });
    svc.addFeature({
      id: "f1",
      title: "F1",
      milestone: "v0.1",
      status: "shipped",
      refs: ["bd:pp-9", "bd:pp-missing"],
    });

    // 1. Missing bd binary degrades cleanly with warning and ok=true
    const missingClient = new CliBeadsClient({ bdBin: "/nonexistent/path/to/bd-missing" });
    const fallbackCheck = await svc.checkWithBeads({ beads: true, beadsClient: missingClient });
    expect(fallbackCheck.ok).toBe(true);
    expect(fallbackCheck.warnings.some((w) => w.code === "BEADS_UNAVAILABLE")).toBe(true);

    // 2. Stub bd script returning closed for pp-9 and not found for pp-missing
    const stubScript = join(tempDir, "fake-bd.sh");
    writeFileSync(
      stubScript,
      `#!/usr/bin/env bash
if [[ "$3" == "pp-9" ]]; then
  echo '[{"id":"pp-9","status":"closed","title":"Completed bead"}]'
  exit 0
fi
echo '{"error":"no issues found matching the provided IDs","schema_version":1}'
exit 1
`,
      "utf8"
    );
    chmodSync(stubScript, 0o755);

    const stubClient = new CliBeadsClient({ bdBin: stubScript });
    const resolved = await stubClient.resolveRefs(["bd:pp-9", "bd:pp-missing", "gh:#12"], tempDir);
    expect(resolved.length).toBe(2);
    expect(resolved[0]).toMatchObject({ id: "pp-9", available: true, found: true, status: "closed" });
    expect(resolved[1]).toMatchObject({ id: "pp-missing", available: true, found: false });

    const checkStub = await svc.checkWithBeads({ beads: true, beadsClient: stubClient });
    expect(checkStub.ok).toBe(false);
    expect(checkStub.errors.some((e) => e.code === "BEADS_REF_NOT_FOUND")).toBe(true);
  });
});
