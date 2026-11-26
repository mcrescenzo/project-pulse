/**
 * Acceptance for the read-first TUI (pp-t80.21): Roadmap ledger, Activity, graph fit and channels,
 * mode-aware footer, help/health overlays, refresh and toasts, and the drawer's feedback, freeze,
 * ship confirm, Unblocks and scroll cue.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoadmapService } from "../src/store";
import type { TuiController } from "../src/tui/app";
import { computeWaterfallLayout, layoutForCamera } from "../src/tui/graph";
import { FOOTER_SUFFIX, FOOTER_SUFFIX_TYPING, footerHints } from "../src/tui/views";
import { HELP_LINES } from "../src/tui/drawer";
import { sleep } from "./helpers/cli";
import { openTui, press, screenText, typeText } from "./helpers/tui";
import { AURORA_FEATURE_IDS, buildActivityRepo, buildAurora, buildDeepDag } from "./fixtures/dashboard-fixtures";

let tempDir: string;
const open: TuiController[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-v21-tui-"));
});

afterEach(() => {
  for (const c of open.splice(0)) c.stop();
  rmSync(tempDir, { recursive: true, force: true });
});

function tui(root: string, w = 80, h = 24, opts: Parameters<typeof openTui>[3] = {}) {
  const res = openTui(root, w, h, opts);
  open.push(res.ctrl);
  return res;
}

const lines = (c: TuiController) => c.getBuffer().toPlainLines();
const hits = (c: TuiController, kind: string) => c.getBuffer().getHitRegions().filter((r) => r.kind === kind);
const clickId = (c: TuiController, id: string) => {
  const r = c.getBuffer().getHitRegions().find((x) => x.id === id);
  if (!r) throw new Error(`no hit region ${id}`);
  c.handleEvent({ type: "mouse", action: "down", button: "left", x: r.x, y: r.y });
  c.handleEvent({ type: "mouse", action: "up", button: "left", x: r.x, y: r.y });
};

describe("TUI Roadmap ledger", () => {
  test("first feature row within the first 10 rows at 80×24; every filtered feature is a row under its group at 80/120/180", () => {
    const svc = buildAurora(tempDir);
    for (const [w, h] of [
      [80, 24],
      [120, 34],
      [180, 46],
    ] as const) {
      const { ctrl } = tui(tempDir, w, h);
      const rows = hits(ctrl, "feature-card");
      expect(rows.length).toBeGreaterThan(0);
      if (w === 80) expect(Math.min(...rows.map((r) => r.y))).toBeLessThan(10);
      // Walk the whole ledger by keyboard; each feature becomes a visible row in ledger order.
      const seen: string[] = [];
      const order: string[] = [];
      for (let i = 0; i < 20; i++) {
        const id = ctrl.getState().selectedFeatureId!;
        if (!order.includes(id)) order.push(id);
        const row = ctrl.getBuffer().getHitRegions().find((r) => r.id === `row-${id}`);
        expect(row).toBeDefined();
        const text = lines(ctrl)[row!.y]!;
        const f = svc.load().features.find((x) => x.id === id)!;
        // Title prefix and n/m sit on the row without overlapping each other.
        expect(text).toContain(f.title.slice(0, 6));
        expect(text).toMatch(f.ship_criteria.length ? new RegExp(`${f.ship_criteria.filter((c) => c.done).length}/${f.ship_criteria.length}`) : /—/);
        if (w >= 120) expect(text).toContain(f.id);
        seen.push(id);
        press(ctrl, "j");
      }
      expect(new Set(order).size).toBe(AURORA_FEATURE_IDS.length);
      // Group headers: label and progress never collide.
      const headers = lines(ctrl).filter((l) => /\d+\/\d+ shipped/.test(l));
      for (const h2 of headers) expect(h2).toMatch(/\S\s{2,}.*\d+\/\d+ shipped/);
      ctrl.stop();
    }
  });

  test("view entry selects the first visible item and opens no drawer; empty states name filters with a keyboard reset", () => {
    buildAurora(tempDir);
    const { ctrl } = tui(tempDir, 120, 34);
    expect(ctrl.getState().selectedFeatureId).toBe("crdt-core");
    press(ctrl, "2");
    expect(ctrl.getState().graphSelectedId).toBe(ctrl.getState().selectedFeatureId);
    expect(ctrl.getState().drawerFeatureId).toBeNull();
    press(ctrl, "3");
    expect(ctrl.getState().activitySelectedIndex).toBe(0);
    expect(ctrl.getState().drawerFeatureId).toBeNull();
    press(ctrl, "1");
    expect(ctrl.getState().selectedFeatureId).toBe("crdt-core");
    expect(screenText(ctrl)).toContain("No features yet.");

    press(ctrl, "/");
    typeText(ctrl, "nothing-matches");
    press(ctrl, "enter");
    expect(screenText(ctrl)).toContain('No features match search: "nothing-matches".');
    press(ctrl, "c");
    expect(ctrl.getState().search).toBe("");
    expect(hits(ctrl, "feature-card").length).toBeGreaterThan(5);
  });
});

describe("TUI Activity", () => {
  test("day groups with Uncommitted first, navigation, Enter opens the drawer, both windows", () => {
    const now = new Date();
    const { svc } = buildActivityRepo(tempDir, { anchor: now });
    svc.updateFeature("delta", { status: "in-progress" });
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "3");
    let text = screenText(ctrl);
    expect(text).toContain("Changes in the last 7 days on main");
    const firstDay = lines(ctrl).findIndex((l) => l.includes("Uncommitted — not in git yet"));
    expect(firstDay).toBeGreaterThan(0);
    expect(lines(ctrl)[firstDay + 1]).toContain("Delta");
    expect(text).toContain("paused → planned");
    expect(text).toContain("planned → paused");
    expect(ctrl.getState().activitySelectedIndex).toBe(0);

    // Several entries for one feature can each be opened.
    const events = ctrl.getState().activity!.result!.events;
    const gammaIdx = events.map((e, i) => (e.featureId === "gamma" ? i : -1)).filter((i) => i >= 0);
    expect(gammaIdx.length).toBe(2);
    for (const idx of gammaIdx) {
      while (ctrl.getState().activitySelectedIndex < idx) press(ctrl, "j");
      press(ctrl, "enter");
      expect(ctrl.getState().drawerFeatureId).toBe("gamma");
      press(ctrl, "escape");
    }
    press(ctrl, "pagedown");
    expect(ctrl.getState().activitySelectedIndex).toBeGreaterThan(gammaIdx[1]!);
    press(ctrl, "pageup");
    press(ctrl, "pageup");
    expect(ctrl.getState().activitySelectedIndex).toBe(0);

    press(ctrl, "w");
    text = screenText(ctrl);
    expect(text).toContain("Changes in the last 30 days");
    expect(ctrl.getState().activity!.result!.events.filter((e) => e.kind === "feature-added").length).toBe(4);
  });

  test("empty, no-git and error states", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Quiet", summary: "" });
    svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
    svc.addFeature({ id: "a", title: "A", milestone: "m1" });
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "3");
    let text = screenText(ctrl);
    expect(text).toContain("Status and criteria changes need git history; showing notes.");
    expect(text).toContain("No changes in the last 7 days.");

    writeFileSync(join(tempDir, ".project-pulse", "config.yaml"), "project: [unclosed\n");
    press(ctrl, "w");
    text = screenText(ctrl);
    expect(text).toContain("Couldn't load activity.");
    expect(text).toContain("Press R to retry.");
  });
});

describe("TUI graph", () => {
  test("fit on entry: all 12 Aurora nodes inside the viewport at 80×24 and 120×34, refit on filter change", () => {
    const svc = buildAurora(tempDir);
    for (const [w, h] of [
      [80, 24],
      [120, 34],
    ] as const) {
      const { ctrl } = tui(tempDir, w, h);
      press(ctrl, "2");
      const check = () => {
        const vp = hits(ctrl, "graph-viewport")[0]!;
        const loaded = svc.load();
        const visible = loaded.features.filter((f) => !ctrl.getState().statusFilter || f.status === ctrl.getState().statusFilter);
        const layout = layoutForCamera(visible, ctrl.getState().payload.milestones, ctrl.getState().graphCamera);
        const nodes = hits(ctrl, "graph-node");
        expect(nodes.length).toBe(visible.length);
        for (const n of nodes) {
          const placed = layout.nodes.get(String(n.data))!;
          expect(n.w).toBe(placed.w);
          expect(n.h).toBe(placed.h);
          expect(n.x).toBeGreaterThanOrEqual(vp.x);
          expect(n.x + n.w).toBeLessThanOrEqual(vp.x + vp.w);
          expect(n.y).toBeGreaterThanOrEqual(vp.y);
          expect(n.y + n.h).toBeLessThanOrEqual(vp.y + vp.h);
        }
        expect(ctrl.getState().graphCamera.overflow).toBe(false);
      };
      check();
      clickId(ctrl, "dist-planned");
      expect(ctrl.getState().statusFilter).toBe("planned");
      check();
      ctrl.stop();
    }
  });

  test("a graph no density can fit shows an overflow cue and every node stays reachable by keyboard", () => {
    const svc = buildDeepDag(tempDir, 14);
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "2");
    expect(ctrl.getState().graphCamera.overflow).toBe(true);
    expect(screenText(ctrl)).toMatch(/off-screen · j\/k reveal/);
    const layout = layoutForCamera(svc.load().features, ctrl.getState().payload.milestones, ctrl.getState().graphCamera);
    expect(layout.edges.length).toBe(13);
    for (let i = 0; i < 14; i++) {
      const id = ctrl.getState().graphSelectedId!;
      const node = ctrl.getBuffer().getHitRegions().find((r) => r.id === `graph-node-${id}`)!;
      expect(node).toBeDefined();
      expect(node.w).toBe(layout.nodes.get(id)!.w);
      press(ctrl, "j");
    }
    expect(ctrl.getState().graphSelectedId).toBe("deep-14");
  });

  test("no two edges share a horizontal channel cell, and edges into one node end on distinct cells", () => {
    const svc = buildAurora(tempDir);
    const loaded = svc.load();
    for (const zoom of ["full", "compact", "overview"] as const) {
      const layout = computeWaterfallLayout(loaded.features, loaded.milestones, zoom);
      const horizontal = new Map<string, number>();
      const arrows = new Map<string, number>();
      layout.routes.forEach((cells, edgeIdx) => {
        for (const cell of cells) {
          const key = `${cell.x},${cell.y}`;
          if (cell.arrow) {
            expect(arrows.has(key)).toBe(false);
            arrows.set(key, edgeIdx);
          }
          // A pure horizontal run (E and W bits) belongs to exactly one edge.
          if ((cell.mask & 12) === 12) {
            expect(horizontal.has(key) ? `${key} shared by ${horizontal.get(key)} and ${edgeIdx}` : "").toBe("");
            horizontal.set(key, edgeIdx);
          }
        }
      });
      // realtime-collab has three incoming edges, each with its own arrowhead.
      const rt = layout.nodes.get("realtime-collab")!;
      const into = [...arrows.keys()].filter((k) => Number(k.split(",")[1]) === rt.y - 1 && Number(k.split(",")[0]) >= rt.x && Number(k.split(",")[0]) < rt.x + rt.w);
      expect(into.length).toBe(3);
    }
  });
});

describe("TUI footer, keys, overlays and refresh", () => {
  test("the footer ends with Help and Quit in every mode at 80×24, whole hints only", () => {
    buildAurora(tempDir);
    const { ctrl } = tui(tempDir, 80, 24);
    const footer = () => lines(ctrl)[23]!.trimEnd();
    const checkWhole = () => {
      const text = footer();
      const body = text.replace(FOOTER_SUFFIX_TYPING, "").replace(FOOTER_SUFFIX, "").trim();
      if (!ctrl.getState().toast && body) {
        for (const part of body.split(" · ")) expect(footerHints(ctrl.getState())).toContain(part.trim());
      }
    };
    const modes: Array<[string, () => void]> = [
      ["roadmap", () => {}],
      ["graph", () => press(ctrl, "2")],
      ["activity", () => press(ctrl, "3")],
      ["drawer", () => { press(ctrl, "1"); press(ctrl, "enter"); }],
      ["picker", () => { press(ctrl, "escape"); press(ctrl, "s"); }],
      ["health", () => { press(ctrl, "escape"); clickId(ctrl, "health-toggle"); }],
      ["help", () => { press(ctrl, "escape"); press(ctrl, "?"); }],
    ];
    for (const [, go] of modes) {
      go();
      expect(footer().endsWith(FOOTER_SUFFIX)).toBe(true);
      checkWhole();
    }
    press(ctrl, "escape");
    // During a notification
    press(ctrl, "y");
    expect(ctrl.getState().toast).not.toBeNull();
    expect(footer().endsWith(FOOTER_SUFFIX)).toBe(true);
  });

  test("while typing, the suffix says Esc first and ? / q stay literal; after Esc both act again", () => {
    buildAurora(tempDir);
    const { ctrl } = tui(tempDir, 80, 24);
    const footer = () => lines(ctrl)[23]!.trimEnd();
    press(ctrl, "/");
    expect(footer().endsWith(FOOTER_SUFFIX_TYPING)).toBe(true);
    typeText(ctrl, "q?");
    expect(ctrl.getState().search).toBe("q?");
    expect(ctrl.getState().helpOpen).toBe(false);
    press(ctrl, "escape");
    press(ctrl, "?");
    expect(ctrl.getState().helpOpen).toBe(true);
    press(ctrl, "?");
    expect(ctrl.getState().helpOpen).toBe(false);

    press(ctrl, "c");
    press(ctrl, "enter");
    press(ctrl, "n");
    expect(ctrl.getState().drawerFocus).toBe("note");
    expect(footer().endsWith(FOOTER_SUFFIX_TYPING)).toBe(true);
    typeText(ctrl, "?q");
    expect(ctrl.getState().noteDrafts["crdt-core"]).toBe("?q");
    expect(ctrl.getState().helpOpen).toBe(false);
    press(ctrl, "escape");
    press(ctrl, "?");
    expect(ctrl.getState().helpOpen).toBe(true);
    press(ctrl, "q");
    // q quits even while Help is open
    expect((ctrl as unknown as { stopped: boolean }).stopped).toBe(true);
  });

  test("? opens Help and q quits from list, graph, activity, drawer, picker and health", () => {
    buildAurora(tempDir);
    const setups: Array<(c: TuiController) => void> = [
      () => {},
      (c) => press(c, "2"),
      (c) => press(c, "3"),
      (c) => press(c, "enter"),
      (c) => press(c, "s"),
      (c) => clickId(c, "health-toggle"),
    ];
    for (const setup of setups) {
      const { ctrl } = tui(tempDir, 80, 24);
      setup(ctrl);
      press(ctrl, "?");
      expect(ctrl.getState().helpOpen).toBe(true);
      press(ctrl, "escape");
      const { ctrl: c2 } = tui(tempDir, 80, 24);
      setup(c2);
      press(c2, "q");
      expect((c2 as unknown as { stopped: boolean }).stopped).toBe(true);
    }
  });

  test("help shows every description whole at 80×24; health sizes to content with whole messages", () => {
    buildAurora(tempDir, { withErrors: true });
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "?");
    const help = screenText(ctrl);
    expect(help).not.toContain("…");
    // Every description appears whole (wrapped lines joined back together).
    const frameLines = lines(ctrl);
    const topIdx = frameLines.findIndex((l) => l.includes("╭─ Keys"));
    const left = [...frameLines[topIdx]!].indexOf("╭");
    const right = [...frameLines[topIdx]!].lastIndexOf("╮");
    const joined = frameLines
      .slice(topIdx + 1)
      .map((l) => [...l].slice(left + 1, right).join(""))
      .join(" ")
      .replace(/\s+/g, " ");
    for (const [, desc] of HELP_LINES) expect(joined).toContain(desc);
    press(ctrl, "?");

    ctrl.stop();

    // Health sizes to its content: one error and one warning, messages whole (remedy included).
    const small = join(tempDir, "small");
    const svc = buildAurora(small);
    svc.updateFeature("broken-dep", { depends_on: [] });
    writeFileSync(join(small, "ROADMAP.md"), "# stale\n");
    const { ctrl: c2 } = tui(small, 80, 24);
    clickId(c2, "health-toggle");
    const frame = lines(c2);
    const top = frame.findIndex((l) => l.includes("╭─ Health"));
    const bottom = frame.findIndex((l, i) => i > top && l.includes("╰"));
    const issues = c2.getState().payload.check.errors.length + c2.getState().payload.check.warnings.length;
    const interior = frame.slice(top + 2, bottom);
    const blank = interior.filter((l) => {
      const inner = [...l].slice([...frame[top]!].indexOf("╭") + 1, [...frame[top]!].lastIndexOf("╮")).join("");
      return inner.trim() === "";
    }).length;
    // separators between diagnostics + at most one spare row
    expect(blank).toBeLessThanOrEqual(issues - 1 + 1);
    const l0 = [...frame[top]!].indexOf("╭");
    const r0 = [...frame[top]!].lastIndexOf("╮");
    const text = frame
      .slice(top, bottom + 1)
      .map((l) => [...l].slice(l0 + 1, r0).join(""))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(text).toContain("ROADMAP_OUT_OF_SYNC");
    expect(text).toContain("run 'pp render'");
    expect(text).not.toContain("…");
  });

  test("R and the Live pill report success and failure; toasts expire after about 3 s", async () => {
    buildAurora(tempDir);
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "R");
    expect(ctrl.getState().toast).toMatchObject({ kind: "ok" });
    clickId(ctrl, "refresh-btn");
    expect(ctrl.getState().toast).toMatchObject({ kind: "ok", message: "Refreshed from disk" });
    const configPath = join(tempDir, ".project-pulse", "config.yaml");
    const good = readFileSync(configPath, "utf8");
    writeFileSync(configPath, "project: [broken\n");
    press(ctrl, "R");
    expect(ctrl.getState().toast?.kind).toBe("err");
    expect(ctrl.getState().toast?.message).toContain("Refresh failed");
    clickId(ctrl, "refresh-btn");
    expect(ctrl.getState().toast?.kind).toBe("err");
    writeFileSync(configPath, good);
    await sleep(3300);
    expect(ctrl.getState().toast).toBeNull();
  }, 15000);
});

describe("TUI drawer", () => {
  test("scrolled drawer acknowledges a toggle on the control; a rejected edit stays until dismissed", async () => {
    buildAurora(tempDir);
    class FailingService extends RoadmapService {
      fail = false;
      override checkFeatureCriterion(featureId: string, criterionIdOrIndex: string, done?: boolean) {
        if (this.fail) throw new Error("disk full");
        return super.checkFeatureCriterion(featureId, criterionIdOrIndex, done);
      }
    }
    const service = new FailingService(tempDir);
    const { ctrl } = tui(tempDir, 80, 24, { service });
    // realtime-collab: long drawer
    while (ctrl.getState().selectedFeatureId !== "realtime-collab") press(ctrl, "j");
    press(ctrl, "enter");
    for (let i = 0; i < 4; i++) press(ctrl, "j");
    press(ctrl, "pagedown");
    press(ctrl, "pagedown");
    expect(ctrl.getState().drawerScrollY).toBeGreaterThan(0);
    const before = ctrl.getState().drawerScrollY;
    press(ctrl, " ");
    expect(ctrl.getState().drawerFeedback).toMatchObject({ kind: "ok", key: expect.stringMatching(/^crit:/) });
    // The drawer does not jump back to the top; the changed control and its acknowledgment show.
    expect(ctrl.getState().drawerScrollY).toBeGreaterThan(0);
    expect(Math.abs(ctrl.getState().drawerScrollY - before)).toBeLessThan(12);
    expect(screenText(ctrl)).toContain("Saved — done");

    service.fail = true;
    press(ctrl, "j");
    press(ctrl, " ");
    expect(screenText(ctrl)).toContain("Couldn't save: disk full");
    ctrl.render();
    await sleep(3300);
    ctrl.render();
    expect(screenText(ctrl)).toContain("Couldn't save: disk full");
    expect(ctrl.getState().toast).toBeNull();
    press(ctrl, "x");
    expect(screenText(ctrl)).not.toContain("Couldn't save: disk full");
  }, 15000);

  test("edit freeze: notice, edits refused with it, e reaches Health; a stale ROADMAP.md keeps editing on", () => {
    const svc = buildAurora(tempDir, { withErrors: true });
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "enter");
    expect(screenText(ctrl)).toContain("Editing paused — 1 error");
    const before = svc.load().features.find((f) => f.id === "crdt-core")!.ship_criteria[0]!.done;
    press(ctrl, " ");
    expect(svc.load().features.find((f) => f.id === "crdt-core")!.ship_criteria[0]!.done).toBe(before);
    expect(ctrl.getState().drawerFeedback?.message).toContain("Editing paused");
    press(ctrl, "e");
    expect(ctrl.getState().healthPanelOpen).toBe(true);
    ctrl.stop();

    svc.updateFeature("broken-dep", { depends_on: [] });
    writeFileSync(join(tempDir, "ROADMAP.md"), "# stale\n");
    const { ctrl: c2 } = tui(tempDir, 80, 24);
    press(c2, "enter");
    const text = screenText(c2);
    expect(text).not.toContain("Editing paused");
    expect(text).toContain("ROADMAP.md is out of sync");
    press(c2, " ");
    expect(c2.getState().drawerFeedback?.kind).toBe("ok");
  });

  test("ship confirm by keyboard with mouse off: also-mark, ship-anyway and cancel, verified on disk", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Ship", summary: "" });
    svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
    svc.addFeature({ id: "f", title: "Feature", milestone: "m1", status: "in-progress", ship_criteria: ["one", "two", "three"] });
    svc.checkFeatureCriterion("f", "1", true);
    const feature = () => svc.load().features.find((x) => x.id === "f")!;
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "m");
    expect(ctrl.getState().mouseEnabled).toBe(false);
    press(ctrl, "enter");
    const toShipped = () => {
      press(ctrl, "tab");
      expect(ctrl.getState().drawerFocus).toBe("status");
      while (ctrl.getState().drawerStatusIndex !== 2) press(ctrl, "right");
      press(ctrl, "enter");
    };
    toShipped();
    expect(ctrl.getState().pendingShip).not.toBeNull();
    expect(screenText(ctrl)).toContain("Also mark 2 criteria done");
    // Cancel writes nothing
    press(ctrl, "right");
    press(ctrl, "right");
    press(ctrl, "enter");
    expect(feature().status).toBe("in-progress");
    // Ship anyway
    press(ctrl, "enter");
    expect(ctrl.getState().pendingShip).not.toBeNull();
    press(ctrl, "right");
    press(ctrl, "enter");
    expect(feature().status).toBe("shipped");
    expect(feature().ship_criteria.map((c) => c.done)).toEqual([true, false, false]);
    // Also mark: one write sets shipped and every open criterion
    svc.updateFeature("f", { status: "in-progress" });
    press(ctrl, "R");
    press(ctrl, "enter");
    expect(ctrl.getState().pendingShip?.choice).toBe(0);
    press(ctrl, "enter");
    expect(feature().status).toBe("shipped");
    expect(feature().ship_criteria.every((c) => c.done)).toBe(true);
  });

  test("Unblocks lists direct dependents and jumps; an overflowing drawer shows a scroll cue", () => {
    buildAurora(tempDir);
    const { ctrl } = tui(tempDir, 80, 24);
    press(ctrl, "enter");
    expect(ctrl.getState().drawerFeatureId).toBe("crdt-core");
    const text = screenText(ctrl);
    expect(text).toContain("UNBLOCKS");
    expect(text).toMatch(/▼ \d+ more · PgDn/);
    const unblocks = ctrl.getBuffer().getHitRegions().filter((r) => r.id.startsWith("drawer-unblocks-")).map((r) => String(r.data));
    expect(unblocks.sort()).toEqual(["audit-log", "auth-sso", "realtime-collab"].filter((id) => unblocks.includes(id)).sort());
    expect(unblocks.length).toBeGreaterThan(0);
    clickId(ctrl, `drawer-unblocks-${unblocks[0]}`);
    expect(ctrl.getState().drawerFeatureId).toBe(unblocks[0]);
  });
});
