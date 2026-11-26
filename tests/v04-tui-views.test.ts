import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoadmapService } from "../src/store";
import { TuiController } from "../src/tui/app";
import { layoutForCamera } from "../src/tui/graph";
import type { InputEvent, TerminalSession } from "../src/tui/input";
import type { ColorMode } from "../src/tui/screen";

class VirtualSession implements TerminalSession {
  width: number;
  height: number;
  colorMode: ColorMode = "truecolor";
  entered = false;
  mouseOpts = { enabled: true, hover: false };
  writes: string[] = [];
  copied: string[] = [];
  private inputCbs = new Set<(ev: InputEvent) => void>();
  private resizeCbs = new Set<(w: number, h: number) => void>();

  constructor(width = 140, height = 40) {
    this.width = width;
    this.height = height;
  }

  enter(opts: { mouse: boolean; hover: boolean }): void {
    this.entered = true;
    this.mouseOpts = { enabled: opts.mouse, hover: opts.hover };
  }

  leave(): void {
    this.entered = false;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  setMouseMode(opts: { enabled: boolean; hover: boolean }): void {
    this.mouseOpts = opts;
  }

  copyToClipboard(text: string): void {
    this.copied.push(text);
  }

  onInput(cb: (ev: InputEvent) => void): () => void {
    this.inputCbs.add(cb);
    return () => this.inputCbs.delete(cb);
  }

  onResize(cb: (w: number, h: number) => void): () => void {
    this.resizeCbs.add(cb);
    return () => this.resizeCbs.delete(cb);
  }

  clickRegion(controller: TuiController, id: string): void {
    const r = controller.getBuffer().getHitRegions().find((reg) => reg.id === id);
    if (!r) throw new Error(`Hit region '${id}' not found`);
    controller.handleEvent({
      type: "mouse",
      action: "down",
      button: "left",
      x: r.x,
      y: r.y,
    });
  }

  typeText(controller: TuiController, text: string): void {
    for (const ch of text) {
      controller.handleEvent({ type: "key", key: ch, raw: ch });
    }
  }
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-tui-views-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function seedRoadmap(dir: string): RoadmapService {
  const svc = new RoadmapService(dir);
  svc.init({ name: "TUI Test Project", summary: "Terminal roadmap parity verification." });
  svc.upsertMilestone({
    id: "v0.1",
    title: "v0.1 Core",
    status: "shipped",
    order: 10,
    description: "Shipped foundation.",
  });
  svc.upsertMilestone({
    id: "v0.2",
    title: "v0.2 Next",
    status: "planned",
    order: 20,
    description: "Upcoming work.",
  });
  svc.addFeature({
    id: "core-store",
    title: "Core Store Engine",
    milestone: "v0.1",
    status: "shipped",
    area: "Core",
    ship_criteria: ["Atomic writes"],
  });
  svc.checkFeatureCriterion("core-store", "1", true);
  svc.addFeature({
    id: "remote-tui",
    title: "Remote Terminal UI",
    milestone: "v0.2",
    status: "in-progress",
    area: "UI",
    depends_on: ["core-store"],
    ship_criteria: ["Mouse support", "Keyboard nav"],
  });
  svc.addFeature({
    id: "docs-guide",
    title: "Docs Polish",
    milestone: "v0.2",
    status: "planned",
    area: "Docs",
    ship_criteria: ["Write SSH guide"],
  });
  return svc;
}

describe("v0.4 TUI Views, Filters & Health Diagnostics", () => {
  test("renders header and distribution, hides empty milestones on status/search filter, and resets cleanly", () => {
    seedRoadmap(tempDir);
    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("TUI Test Project");
      expect(screen).toContain("v0.1 Core");
      expect(screen).toContain("v0.2 Next");
      expect(screen).toContain("Core Store Engine");

      // Open Status floating dropdown and click "planned" -> v0.1 Core hides!
      session.clickRegion(ctrl, "picker-status");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Filter status");

      session.clickRegion(ctrl, "picker-opt-1"); // planned
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).not.toContain("v0.1 Core");
      expect(screen).toContain("v0.2 Next");
      expect(screen).toContain("Docs Polish");
      expect(screen).toContain("0/2 shipped");

      // Click Reset restores both milestones
      session.clickRegion(ctrl, "filter-reset");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("v0.1 Core");
      expect(screen).toContain("v0.2 Next");

      // Clicking the "planned" count filters to planned (hiding shipped v0.1 Core); clicking again toggles off
      session.clickRegion(ctrl, "dist-planned");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).not.toContain("v0.1 Core");
      expect(screen).toContain("v0.2 Next");

      session.clickRegion(ctrl, "dist-planned");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("v0.1 Core");
      expect(screen).toContain("v0.2 Next");

      // Clicking live pill triggers disk refresh toast
      session.clickRegion(ctrl, "refresh-btn");
      expect(ctrl.getState().toast?.message).toContain("Refreshed");

      // Live search via / hides non-matching milestones
      ctrl.handleEvent({ type: "key", key: "/", raw: "/" });
      session.typeText(ctrl, "Terminal");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).not.toContain("v0.1 Core");
      expect(screen).toContain("Remote Terminal UI");
      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
    } finally {
      ctrl.stop();
    }
  });

  test("Activity replaces the Status Board: no-git notes, window key, and filters", () => {
    const svc = seedRoadmap(tempDir);
    svc.logFeaturePulse({ id: "remote-tui", note: "Mouse support landed." });
    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickRegion(ctrl, "tab-activity");
      expect(ctrl.getState().viewMode).toBe("activity");
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Changes in the last 7 days");
      expect(screen).toContain("Status and criteria changes need git history; showing notes.");
      expect(screen).toContain("Mouse support landed.");
      expect(ctrl.getBuffer().getHitRegions().some((r) => r.kind === "board-col" || r.kind === "board-tab")).toBe(false);

      ctrl.handleEvent({ type: "key", key: "w", raw: "w" });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Changes in the last 30 days");

      // Filters apply to Activity too: an area with no events names the filter.
      ctrl.handleEvent({ type: "key", key: "/", raw: "/" });
      session.typeText(ctrl, "zzz");
      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain('No changes match search: "zzz".');
      ctrl.handleEvent({ type: "key", key: "c", raw: "c" });
      expect(ctrl.getState().search).toBe("");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("Mouse support landed.");
    } finally {
      ctrl.stop();
    }
  });

  test("opens clickable Health overlay showing ROADMAP_OUT_OF_SYNC and jumps to feature", () => {
    seedRoadmap(tempDir);
    writeFileSync(join(tempDir, "ROADMAP.md"), "# Manually dirtied\n", "utf8");
    const session = new VirtualSession(120, 34);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("1 error");

      session.clickRegion(ctrl, "health-toggle");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(ctrl.getState().healthPanelOpen).toBe(true);
      expect(screen).toContain("ROADMAP_OUT_OF_SYNC");
      expect(screen).toContain("run 'pp render'");

      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(ctrl.getState().healthPanelOpen).toBe(false);
      expect(screen).not.toContain("ROADMAP_OUT_OF_SYNC");
    } finally {
      ctrl.stop();
    }
  });

  test("centers view tabs in row 0 on wide/medium terminals and falls back cleanly on narrow terminals", () => {
    seedRoadmap(tempDir);
    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      const regions = ctrl.getBuffer().getHitRegions();
      const tabCards = regions.find((r) => r.id === "tab-roadmap");
      const tabGraph = regions.find((r) => r.id === "tab-graph");
      const tabBoard = regions.find((r) => r.id === "tab-activity");
      const refreshBtn = regions.find((r) => r.id === "refresh-btn");

      expect(tabCards).toBeDefined();
      expect(tabGraph).toBeDefined();
      expect(tabBoard).toBeDefined();
      expect(refreshBtn).toBeDefined();

      expect(tabCards!.y).toBe(0);
      expect(tabGraph!.y).toBe(0);
      expect(tabBoard!.y).toBe(0);
      expect(tabCards!.x).toBeGreaterThan("TUI Test Project".length + 1);
      expect(tabBoard!.x + tabBoard!.w).toBeLessThan(refreshBtn!.x);
      expect(Math.abs((tabCards!.x + tabBoard!.x + tabBoard!.w) / 2 - 70)).toBeLessThanOrEqual(2);

      const row0Wide = ctrl.getBuffer().toPlainLines()[0]!;
      expect(row0Wide).toContain("TUI Test Project");
      expect(row0Wide).toContain("1 Roadmap");
      expect(row0Wide).toContain("2 Graph");
      expect(row0Wide).toContain("3 Activity");
      expect(row0Wide).toContain("Check OK");

      session.clickRegion(ctrl, "tab-graph");
      expect(ctrl.getState().viewMode).toBe("graph");
      session.clickRegion(ctrl, "tab-activity");
      expect(ctrl.getState().viewMode).toBe("activity");
      session.clickRegion(ctrl, "tab-roadmap");
      expect(ctrl.getState().viewMode).toBe("roadmap");

      // Medium width (96 cols): compact tabs sit in row 0 without overlapping right pills or truncating title
      session.width = 96;
      session.height = 30;
      ctrl.render();
      const medRegions = ctrl.getBuffer().getHitRegions();
      const medCards = medRegions.find((r) => r.id === "tab-roadmap")!;
      const medBoard = medRegions.find((r) => r.id === "tab-activity")!;
      const medRefresh = medRegions.find((r) => r.id === "refresh-btn")!;
      expect(medCards.y).toBe(0);
      expect(medBoard.y).toBe(0);
      expect(medCards.x).toBeGreaterThan("TUI Test Project".length + 1);
      expect(medBoard.x + medBoard.w).toBeLessThan(medRefresh.x);
      const row0Med = ctrl.getBuffer().toPlainLines()[0]!;
      expect(row0Med).toContain("TUI Test Project");
      expect(row0Med).toContain("1 Roadmap");
      expect(row0Med).toContain("2 Graph");
      expect(row0Med).toContain("3 Activity");

      // Ultra-narrow width (78 cols): tabs fall back below row 0 and keep project title untruncated
      session.width = 78;
      session.height = 24;
      ctrl.render();
      const narrowRegions = ctrl.getBuffer().getHitRegions();
      const narrowCards = narrowRegions.find((r) => r.id === "tab-roadmap")!;
      const narrowGraph = narrowRegions.find((r) => r.id === "tab-graph")!;
      const narrowBoard = narrowRegions.find((r) => r.id === "tab-activity")!;
      expect(narrowCards.y).toBeGreaterThan(0);
      expect(narrowGraph.y).toBeGreaterThan(0);
      expect(narrowBoard.y).toBeGreaterThan(0);
      expect(ctrl.getBuffer().toPlainLines()[0]!).toContain("TUI Test Project");
    } finally {
      ctrl.stop();
    }
  });

  test("distribution counts filter exactly the features they count; zero counts take no segment", () => {
    seedRoadmap(tempDir);
    const svc = new RoadmapService(tempDir);
    svc.addFeature({ id: "paused-auth", title: "Paused Auth Rework", milestone: "v0.2", status: "paused", area: "Core" });
    svc.addFeature({ id: "cut-legacy", title: "Cut Legacy Import", milestone: "v0.2", status: "cut", area: "Docs" });

    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      const distRow = () => ctrl.getBuffer().toPlainLines().find((line) => line.includes("planned ·"))!;
      expect(distRow()).toContain("1 planned · 1 in progress · 1 shipped · 1 paused · 1 cut");

      session.clickRegion(ctrl, "dist-paused");
      expect(ctrl.getState().statusFilter).toBe("paused");
      expect(ctrl.getState().drawerFeatureId).toBeNull();
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Paused Auth Rework");
      expect(screen).not.toContain("Cut Legacy Import");
      expect(screen).not.toContain("Docs Polish");
      // The counts stay visible (scoped by the other filters, not by status).
      expect(distRow()).toContain("1 cut");

      // Graph shows the same filtered set.
      ctrl.handleEvent({ type: "key", key: "2", raw: "2" });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(ctrl.getBuffer().getHitRegions().filter((r) => r.kind === "graph-node").map((r) => r.data)).toEqual(["paused-auth"]);

      ctrl.handleEvent({ type: "key", key: "1", raw: "1" });
      session.clickRegion(ctrl, "dist-paused");
      expect(ctrl.getState().statusFilter).toBe("");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("Docs Polish");

      // Keyboard path: s opens the status filter, Enter applies.
      ctrl.handleEvent({ type: "key", key: "s", raw: "s" });
      expect(ctrl.getState().openPicker?.kind).toBe("status");
      ctrl.handleEvent({ type: "key", key: "down", raw: "" });
      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      expect(ctrl.getState().statusFilter).toBe("planned");
    } finally {
      ctrl.stop();
    }

    // Cut-only roadmap: one segment, and it filters to exactly those features.
    const cutDir = join(tempDir, "cut-only");
    const cutSvc = new RoadmapService(cutDir);
    cutSvc.init({ name: "Cut Only" });
    cutSvc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "planned", order: 10 });
    for (const [id, title] of [["cut-a", "Cut Alpha"], ["cut-b", "Cut Beta"], ["cut-c", "Cut Gamma"]]) {
      cutSvc.addFeature({ id: id!, title: title!, milestone: "v0.1", status: "cut" });
    }
    const cutSession = new VirtualSession(140, 40);
    const cutCtrl = new TuiController({ rootDir: cutDir, noBeads: true, session: cutSession });
    cutCtrl.start();
    try {
      const regions = cutCtrl.getBuffer().getHitRegions().filter((r) => r.kind === "dist-filter");
      expect([...new Set(regions.map((r) => r.data))]).toEqual(["cut"]);
      cutSession.clickRegion(cutCtrl, "dist-cut");
      const screen = cutCtrl.getBuffer().toPlainLines().join("\n");
      expect(cutCtrl.getState().statusFilter).toBe("cut");
      for (const t of ["Cut Alpha", "Cut Beta", "Cut Gamma"]) expect(screen).toContain(t);
    } finally {
      cutCtrl.stop();
    }
  });

  test("long milestone picker keeps keyboard focus visible and wheels without moving the background", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Long Picker Project" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "planned", order: 10 });
    svc.addFeature({ id: "base-feature", title: "Base Feature", milestone: "v0.1", status: "planned" });
    for (let i = 1; i <= 30; i++) {
      const id = `m${String(i).padStart(2, "0")}`;
      svc.upsertMilestone({ id, title: `Later ${i}`, status: "planned", order: 100 + i });
    }

    const session = new VirtualSession(100, 24);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickRegion(ctrl, "picker-milestone");
      const opts = ctrl.getState().openPicker!.options;
      const lastOpt = opts[opts.length - 1]!;
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain(opts[0]!.label);
      expect(screen).not.toContain(lastOpt.label);

      // Wheel over the picker overlay scrolls the option list; the cards view stays put.
      ctrl.handleEvent({ type: "mouse", action: "wheel-down", button: "none", x: 0, y: 0 });
      ctrl.handleEvent({ type: "mouse", action: "wheel-down", button: "none", x: 0, y: 0 });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(ctrl.getState().pickerScrollY).toBe(6);
      expect(ctrl.getState().roadmapScrollY).toBe(0);
      expect(screen).toContain(opts[6]!.label);
      expect(screen).not.toContain(opts[5]!.label);

      // Keyboard focus walking past the bottom moves the window so the last option shows.
      for (let i = 0; i < opts.length - 1; i++) {
        ctrl.handleEvent({ type: "key", key: "down", raw: "\x1b[B" });
      }
      expect(ctrl.getState().pickerSelectedIndex).toBe(opts.length - 1);
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain(lastOpt.label);
      expect(
        ctrl.getBuffer().getHitRegions().find((r) => r.id === `picker-opt-${opts.length - 1}`)
      ).toBeDefined();

      session.clickRegion(ctrl, `picker-opt-${opts.length - 1}`);
      expect(ctrl.getState().milestoneFilter).toBe(lastOpt.value);
      expect(ctrl.getState().openPicker).toBeNull();
    } finally {
      ctrl.stop();
    }
  });

  test("Health overlay scrolls to the final diagnostic and its Inspect pill stays clickable", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Drift Flood Project" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "planned", order: 10 });
    for (let i = 1; i <= 30; i++) {
      const id = `f${String(i).padStart(2, "0")}`;
      // Genuine validation warning (recommended max is 6 criteria) per feature, so the
      // overlay holds more diagnostics than a 24-row terminal can paint at once.
      svc.addFeature({
        id,
        title: `Feature ${i}`,
        milestone: "v0.1",
        ship_criteria: ["c1", "c2", "c3", "c4", "c5", "c6", "c7"],
      });
    }

    const session = new VirtualSession(100, 24);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickRegion(ctrl, "health-toggle");
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(ctrl.getState().healthPanelOpen).toBe(true);
      expect(screen).toContain("'f01'");
      expect(screen).not.toContain("'f30'");
      expect(screen).toContain("more · PgDn");

      // Wheel over the overlay brings the final diagnostic into view with a live pill.
      for (let i = 0; i < 60 && !ctrl.getBuffer().toPlainLines().join("\n").includes("'f30'"); i++) {
        ctrl.handleEvent({ type: "mouse", action: "wheel-down", button: "none", x: 0, y: 0 });
      }
      expect(ctrl.getState().roadmapScrollY).toBe(0);
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("'f30'");
      expect(ctrl.getBuffer().getHitRegions().find((r) => r.id === "health-jump-f30")).toBeDefined();

      // Keyboard page keys scroll too.
      const atBottom = ctrl.getState().healthScrollY;
      ctrl.handleEvent({ type: "key", key: "pageup", raw: "" });
      expect(ctrl.getState().healthScrollY).toBe(atBottom - 4);
      ctrl.handleEvent({ type: "key", key: "pagedown", raw: "" });
      expect(ctrl.getState().healthScrollY).toBe(atBottom);

      // Inspecting the final diagnostic opens its drawer and dismisses only the overlay.
      session.clickRegion(ctrl, "health-jump-f30");
      expect(ctrl.getState().healthPanelOpen).toBe(false);
      expect(ctrl.getState().drawerFeatureId).toBe("f30");
    } finally {
      ctrl.stop();
    }
  });

  test("Enter and copy address only visible features after filtering and never auto-open on reconcile", () => {
    seedRoadmap(tempDir);
    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      // Selection starts on the shipped core-store; filtering to planned must move the
      // highlight without opening a drawer.
      expect(ctrl.getState().selectedFeatureId).toBe("core-store");
      session.clickRegion(ctrl, "picker-status");
      session.clickRegion(ctrl, "picker-opt-1"); // planned
      expect(ctrl.getState().selectedFeatureId).toBe("docs-guide");
      expect(ctrl.getState().drawerFeatureId).toBeNull();

      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      expect(ctrl.getState().drawerFeatureId).toBe("docs-guide");
      expect(ctrl.getState().drawerFeatureId).not.toBe("core-store");

      ctrl.handleEvent({ type: "key", key: "y", raw: "y" });
      expect(session.copied).toContain("docs-guide");
    } finally {
      ctrl.stop();
    }
  });

  test("feature removal during note entry releases the editor and keyboard input", () => {
    const svc = seedRoadmap(tempDir);
    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickRegion(ctrl, "row-docs-guide");
      expect(ctrl.getState().drawerFeatureId).toBe("docs-guide");
      ctrl.handleEvent({ type: "key", key: "n", raw: "n" });
      expect(ctrl.getState().drawerFocus).toBe("note");
      session.typeText(ctrl, "draft text");
      expect(ctrl.getState().noteDrafts["docs-guide"]).toBe("draft text");

      // The feature disappears on disk; the drawer must close and release the draft.
      svc.removeFeature("docs-guide");
      session.clickRegion(ctrl, "refresh-btn");
      expect(ctrl.getState().drawerFeatureId).toBeNull();
      expect(ctrl.getState().drawerFocus).toBe("criteria");
      expect(ctrl.getState().noteDrafts["docs-guide"]).toBeUndefined();

      // Keys reach the normal handlers again instead of an invisible editor.
      const before = ctrl.getState().selectedFeatureId;
      ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      expect(ctrl.getState().selectedFeatureId).not.toBe(before);
      expect(ctrl.getState().noteDrafts["docs-guide"]).toBeUndefined();

      // Copy after removal addresses a present feature only.
      ctrl.handleEvent({ type: "key", key: "y", raw: "y" });
      expect(session.copied).not.toContain("docs-guide");
      expect(session.copied.length).toBeGreaterThan(0);
    } finally {
      ctrl.stop();
    }
  });

  test("graph Enter opens the drawer fully initialized on the first criterion", () => {
    seedRoadmap(tempDir);
    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      // Dirty the shared drawer state on a first visit, then close it. Escape first
      // releases the note editor, a second Escape closes the drawer.
      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      ctrl.handleEvent({ type: "key", key: "n", raw: "n" });
      ctrl.getState().drawerScrollY = 5;
      ctrl.getState().drawerCriterionIndex = 1;
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      expect(ctrl.getState().drawerFocus).toBe("criteria");
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      expect(ctrl.getState().drawerFeatureId).toBeNull();

      // Graph keyboard movement lands on remote-tui; Enter must re-initialize, not resume.
      ctrl.handleEvent({ type: "key", key: "2", raw: "2" });
      ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      expect(ctrl.getState().graphSelectedId).toBe("remote-tui");

      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      expect(ctrl.getState().drawerFeatureId).toBe("remote-tui");
      expect(ctrl.getState().selectedFeatureId).toBe("remote-tui");
      expect(ctrl.getState().drawerScrollY).toBe(0);
      expect(ctrl.getState().drawerFocus).toBe("criteria");
      expect(ctrl.getState().drawerCriterionIndex).toBe(0);
      expect(ctrl.getState().drawerFeedback).toBeNull();
    } finally {
      ctrl.stop();
    }
  });

  test("keyboard selection reveals itself in the ledger", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Reveal Project" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "planned", order: 10 });
    svc.upsertMilestone({ id: "v0.2", title: "v0.2", status: "planned", order: 20 });
    const titles = [
      "Feature One", "Feature Two", "Feature Three", "Feature Four", "Feature Five", "Feature Six",
      "Feature Seven", "Feature Eight", "Feature Nine", "Feature Ten", "Feature Eleven", "Feature Twelve",
    ];
    const statuses = ["planned", "in-progress", "shipped"] as const;
    titles.forEach((title, i) => {
      svc.addFeature({
        id: `f${String(i + 1).padStart(2, "0")}`,
        title,
        milestone: i < 6 ? "v0.1" : "v0.2",
        status: statuses[i % 3]!,
      });
    });

    const session = new VirtualSession(100, 14);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      expect(ctrl.getState().selectedFeatureId).toBe("f01");
      for (let i = 0; i < 4; i++) {
        ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      }
      expect(ctrl.getState().selectedFeatureId).toBe("f05");
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Feature Five");

      for (let i = 0; i < 7; i++) {
        ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      }
      expect(ctrl.getState().selectedFeatureId).toBe("f12");
      expect(ctrl.getState().roadmapScrollY).toBeGreaterThan(0);
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Feature Twelve");
      expect(screen).not.toContain("Feature One ");
    } finally {
      ctrl.stop();
    }
  });

  test("graph keyboard movement pans the camera so the selected node is fully visible", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Deep Chain" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "planned", order: 10 });
    for (let i = 1; i <= 8; i++) {
      svc.addFeature({
        id: `a${i}`,
        title: `Chain ${i}`,
        milestone: "v0.1",
        depends_on: i > 1 ? [`a${i - 1}`] : [],
      });
    }

    const session = new VirtualSession(100, 24);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      ctrl.handleEvent({ type: "key", key: "2", raw: "2" });
      const startTy = ctrl.getState().graphCamera.ty;

      for (let i = 0; i < 7; i++) {
        ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      }
      expect(ctrl.getState().graphSelectedId).toBe("a8");
      expect(ctrl.getState().graphCamera.ty).not.toBe(startTy);

      // A chain this deep cannot fit 24 rows: the overflow cue shows and keyboard
      // selection pans to each node. Full (unclipped) node hit region == on screen.
      expect(ctrl.getState().graphCamera.overflow).toBe(true);
      expect(ctrl.getBuffer().getHitRegions().some((r) => r.id === "graph-overflow")).toBe(true);
      const cam = ctrl.getState().graphCamera;
      const loaded = svc.load();
      const node = layoutForCamera(loaded.features, loaded.milestones, cam).nodes.get("a8")!;
      const region = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-a8")!;
      expect(region).toBeDefined();
      expect(region.h).toBe(node.h);
      expect(region.w).toBe(node.w);

      // Moving back up pans the camera the other way; what matters is that the
      // top node is fully on screen again, not that the camera offset matches.
      const tyAtBottom = ctrl.getState().graphCamera.ty;
      for (let i = 0; i < 7; i++) {
        ctrl.handleEvent({ type: "key", key: "k", raw: "k" });
      }
      expect(ctrl.getState().graphSelectedId).toBe("a1");
      const top = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-a1")!;
      expect(top.h).toBe(node.h);
      expect(ctrl.getState().graphCamera.ty).toBeGreaterThan(tyAtBottom);
    } finally {
      ctrl.stop();
    }
  });
});
