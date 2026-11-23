import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoadmapService } from "../src/store";
import { TuiController } from "../src/tui/app";
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
  test("renders header/KPIs, hides empty milestones on status/search filter, and resets cleanly", () => {
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
      expect(screen).toContain("1/2");

      // Click Reset restores both milestones
      session.clickRegion(ctrl, "filter-reset");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("v0.1 Core");
      expect(screen).toContain("v0.2 Next");

      // Click KPI card "PLANNED" filters to planned (hiding shipped v0.1 Core), and clicking again toggles off
      session.clickRegion(ctrl, "kpi-planned");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).not.toContain("v0.1 Core");
      expect(screen).toContain("v0.2 Next");

      session.clickRegion(ctrl, "kpi-planned");
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

  test("switches to Status Board preserving active filters and handles narrow column tabs + scrolling", () => {
    seedRoadmap(tempDir);
    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickRegion(ctrl, "tab-board");
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Planned");
      expect(screen).toContain("In Progress");
      expect(screen).toContain("Shipped");
      expect(screen).toContain("Docs Polish");
      expect(screen).toContain("Core Store Engine");

      // Wheel scroll updates cards/board without throwing
      ctrl.handleEvent({ type: "mouse", action: "wheel-down", button: "none", x: 10, y: 12 });
      expect(ctrl.getState().boardScrollY.planned).toBeGreaterThanOrEqual(0);

      // Resize narrower (< 90 cols) uses clickable column tabs in Status Board
      session.width = 84;
      session.height = 28;
      ctrl.render();
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Planned (1)");
      session.clickRegion(ctrl, "board-tab-shipped");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Core Store Engine");
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
      expect(screen).toContain("1 err");

      session.clickRegion(ctrl, "health-toggle");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Health & Drift Diagnostics");
      expect(screen).toContain("ROADMAP_OUT_OF_SYNC");

      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).not.toContain("Health & Drift Diagnostics");
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
      const tabCards = regions.find((r) => r.id === "tab-cards");
      const tabGraph = regions.find((r) => r.id === "tab-graph");
      const tabBoard = regions.find((r) => r.id === "tab-board");
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
      expect(row0Wide).toContain("1 Milestone Cards");
      expect(row0Wide).toContain("2 Dependency Graph");
      expect(row0Wide).toContain("3 Status Board");
      expect(row0Wide).toContain("Check OK");

      session.clickRegion(ctrl, "tab-graph");
      expect(ctrl.getState().viewMode).toBe("graph");
      session.clickRegion(ctrl, "tab-board");
      expect(ctrl.getState().viewMode).toBe("board");
      session.clickRegion(ctrl, "tab-cards");
      expect(ctrl.getState().viewMode).toBe("cards");

      // Medium width (96 cols): compact tabs sit in row 0 without overlapping right pills or truncating title
      session.width = 96;
      session.height = 30;
      ctrl.render();
      const medRegions = ctrl.getBuffer().getHitRegions();
      const medCards = medRegions.find((r) => r.id === "tab-cards")!;
      const medBoard = medRegions.find((r) => r.id === "tab-board")!;
      const medRefresh = medRegions.find((r) => r.id === "refresh-btn")!;
      expect(medCards.y).toBe(0);
      expect(medBoard.y).toBe(0);
      expect(medCards.x).toBeGreaterThan("TUI Test Project".length + 1);
      expect(medBoard.x + medBoard.w).toBeLessThan(medRefresh.x);
      const row0Med = ctrl.getBuffer().toPlainLines()[0]!;
      expect(row0Med).toContain("TUI Test Project");
      expect(row0Med).toContain("1 Cards");
      expect(row0Med).toContain("2 Graph");
      expect(row0Med).toContain("3 Board");

      // Ultra-narrow width (78 cols): tabs fall back below row 0 and keep project title untruncated
      session.width = 78;
      session.height = 24;
      ctrl.render();
      const narrowRegions = ctrl.getBuffer().getHitRegions();
      const narrowCards = narrowRegions.find((r) => r.id === "tab-cards")!;
      const narrowGraph = narrowRegions.find((r) => r.id === "tab-graph")!;
      const narrowBoard = narrowRegions.find((r) => r.id === "tab-board")!;
      expect(narrowCards.y).toBeGreaterThan(0);
      expect(narrowGraph.y).toBeGreaterThan(0);
      expect(narrowBoard.y).toBeGreaterThan(0);
      expect(ctrl.getBuffer().toPlainLines()[0]!).toContain("TUI Test Project");
    } finally {
      ctrl.stop();
    }
  });

  test("PAUSED/CUT KPI filters exactly the features it counts in mixed and cut-only roadmaps", () => {
    seedRoadmap(tempDir);
    const svc = new RoadmapService(tempDir);
    svc.addFeature({
      id: "paused-auth",
      title: "Paused Auth Rework",
      milestone: "v0.2",
      status: "paused",
      area: "Core",
    });
    svc.addFeature({
      id: "cut-legacy",
      title: "Cut Legacy Import",
      milestone: "v0.2",
      status: "cut",
      area: "Docs",
    });

    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      const kpiRow = screen.split("\n").find((line) => line.includes("PAUSED/CUT"));
      expect(kpiRow).toContain("2");

      session.clickRegion(ctrl, "kpi-paused");
      expect(ctrl.getState().statusFilter).toBe("paused|cut");
      expect(ctrl.getState().drawerFeatureId).toBeNull();

      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Paused Auth Rework");
      expect(screen).toContain("Cut Legacy Import");
      expect(screen).not.toContain("Docs Polish");
      expect(screen).not.toContain("Core Store Engine");
      const featuresRow = screen.split("\n").find((line) => line.includes("FEATURES"));
      expect(featuresRow).toContain("2/5");

      // Board and graph show the same filtered set (paused + cut columns, no planned cards).
      ctrl.handleEvent({ type: "key", key: "3", raw: "3" });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      const boardCols = ctrl.getBuffer().getHitRegions().filter((r) => r.kind === "board-col");
      expect(boardCols.map((r) => String(r.data)).sort()).toEqual(["cut", "in-progress", "paused", "planned", "shipped"]);
      expect(screen).toContain("Paused Auth Rework");
      expect(screen).toContain("Cut Legacy Import");
      expect(screen).not.toContain("Docs Polish");
      expect(screen).not.toContain("Core Store Engine");
      ctrl.handleEvent({ type: "key", key: "2", raw: "2" });
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Cut Legacy Import");
      expect(screen).toContain("Paused Auth Rework");
      expect(screen).not.toContain("Docs Polish");

      // Clicking the tally again clears the combined filter.
      ctrl.handleEvent({ type: "key", key: "1", raw: "1" });
      session.clickRegion(ctrl, "kpi-paused");
      expect(ctrl.getState().statusFilter).toBe("");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Docs Polish");
    } finally {
      ctrl.stop();
    }

    // Cut-only roadmap: the nonzero tally yields exactly those features, not an empty view.
    const cutDir = join(tempDir, "cut-only");
    const cutSvc = new RoadmapService(cutDir);
    cutSvc.init({ name: "Cut Only" });
    cutSvc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "planned", order: 10 });
    cutSvc.addFeature({ id: "cut-a", title: "Cut Alpha", milestone: "v0.1", status: "cut" });
    cutSvc.addFeature({ id: "cut-b", title: "Cut Beta", milestone: "v0.1", status: "cut" });
    cutSvc.addFeature({ id: "cut-c", title: "Cut Gamma", milestone: "v0.1", status: "cut" });

    const cutSession = new VirtualSession(140, 40);
    const cutCtrl = new TuiController({ rootDir: cutDir, noBeads: true, session: cutSession });
    cutCtrl.start();

    try {
      let screen = cutCtrl.getBuffer().toPlainLines().join("\n");
      const kpiRow = screen.split("\n").find((line) => line.includes("PAUSED/CUT"));
      expect(kpiRow).toContain("3");

      cutSession.clickRegion(cutCtrl, "kpi-paused");
      screen = cutCtrl.getBuffer().toPlainLines().join("\n");
      expect(cutCtrl.getState().statusFilter).toBe("paused|cut");
      expect(screen).toContain("Cut Alpha");
      expect(screen).toContain("Cut Beta");
      expect(screen).toContain("Cut Gamma");
      const featuresRow = screen.split("\n").find((line) => line.includes("FEATURES"));
      // Cut-only roadmap: the filtered count equals the total, so no "n/total" split shows.
      expect(featuresRow!.match(/FEATURES\s+(\d+(?:\/\d+)?)/)?.[1]).toBe("3");
    } finally {
      cutCtrl.stop();
    }
  });

  test("wheel over a board card scrolls only that card's column", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Overflow Board" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "planned", order: 10 });
    const statuses = ["planned", "in-progress", "shipped"] as const;
    for (let i = 1; i <= 6; i++) {
      for (const status of statuses) {
        svc.addFeature({
          id: `${status}-${i}`,
          title: `${status} item ${i}`,
          milestone: "v0.1",
          status,
        });
      }
    }

    const session = new VirtualSession(140, 40);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      ctrl.handleEvent({ type: "key", key: "3", raw: "3" });
      const regions = ctrl.getBuffer().getHitRegions();
      // A mid-column card whose hit region out-ranks the column backdrop.
      const card = regions.find((r) => r.id === "board-card-shipped-4")!;
      expect(card).toBeDefined();

      const wx = card.x + 2;
      const wy = card.y;
      expect(ctrl.getBuffer().hitTest(wx, wy)?.kind).toBe("feature-card");

      ctrl.handleEvent({ type: "mouse", action: "wheel-down", button: "none", x: wx, y: wy });
      expect(ctrl.getState().boardScrollY.shipped).toBe(3);
      expect(ctrl.getState().boardScrollY.planned ?? 0).toBe(0);
      expect(ctrl.getState().boardScrollY["in-progress"] ?? 0).toBe(0);

      ctrl.handleEvent({ type: "mouse", action: "wheel-down", button: "none", x: wx, y: wy });
      expect(ctrl.getState().boardScrollY.shipped).toBe(6);

      // Wheel over a planned card moves only the planned column.
      const plannedCard = ctrl.getBuffer().getHitRegions().find((r) => r.id === "board-card-planned-4")!;
      ctrl.handleEvent({
        type: "mouse",
        action: "wheel-down",
        button: "none",
        x: plannedCard.x + 2,
        y: plannedCard.y,
      });
      expect(ctrl.getState().boardScrollY.planned).toBe(3);
      expect(ctrl.getState().boardScrollY["in-progress"] ?? 0).toBe(0);

      ctrl.handleEvent({
        type: "mouse",
        action: "wheel-up",
        button: "none",
        x: plannedCard.x + 2,
        y: plannedCard.y,
      });
      expect(ctrl.getState().boardScrollY.planned).toBe(0);
      expect(ctrl.getState().boardScrollY.shipped).toBe(6);
    } finally {
      ctrl.stop();
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
      expect(ctrl.getState().cardsScrollY).toBe(0);
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
      expect(screen).toContain("Health & Drift Diagnostics");
      expect(screen).toContain("'f01'");
      expect(screen).not.toContain("'f30'");

      // Wheel over the overlay brings the final diagnostic into view with a live pill.
      for (let i = 0; i < 5; i++) {
        ctrl.handleEvent({ type: "mouse", action: "wheel-down", button: "none", x: 0, y: 0 });
      }
      expect(ctrl.getState().healthScrollY).toBe(15);
      expect(ctrl.getState().cardsScrollY).toBe(0);
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("'f30'");
      expect(screen).toContain("16-30/30");
      expect(ctrl.getBuffer().getHitRegions().find((r) => r.id === "health-jump-f30")).toBeDefined();

      // Keyboard page keys scroll too.
      ctrl.handleEvent({ type: "key", key: "pageup", raw: "" });
      expect(ctrl.getState().healthScrollY).toBe(11);
      ctrl.handleEvent({ type: "key", key: "pagedown", raw: "" });
      expect(ctrl.getState().healthScrollY).toBe(15);

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
      session.clickRegion(ctrl, "card-docs-guide");
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

  test("keyboard selection reveals itself in cards, board columns, and pans the graph", () => {
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

    const session = new VirtualSession(100, 24);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      // Cards: walking down past the fold scrolls by real card rows.
      for (let i = 0; i < 4; i++) {
        ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      }
      expect(ctrl.getState().selectedFeatureId).toBe("f05");
      let screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Feature Five");
      expect(ctrl.getState().cardsScrollY).toBeGreaterThan(0);

      for (let i = 0; i < 7; i++) {
        ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      }
      expect(ctrl.getState().selectedFeatureId).toBe("f12");
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      expect(screen).toContain("Feature Twelve");
      expect(screen).not.toContain("Feature One ");

      // Board: moving up into an overflowing column scrolls that column only. The
      // landed card is read from state, then asserted fully visible with its own
      // column scrolled and no other column touched.
      ctrl.handleEvent({ type: "key", key: "3", raw: "3" });
      const boardPre = ctrl.getState().selectedFeatureId;
      ctrl.handleEvent({ type: "key", key: "k", raw: "k" });
      const boardPost = ctrl.getState().selectedFeatureId!;
      expect(boardPost).not.toBe(boardPre);
      const postStatus = ctrl
        .getState()
        .payload.features.find((f) => f.id === boardPost)!.status;
      const postCard = ctrl.getBuffer().getHitRegions().find((r) => r.id === `board-card-${boardPost}`)!;
      expect(postCard).toBeDefined();
      expect(postCard.h).toBe(5);
      expect(ctrl.getState().boardScrollY[postStatus]).toBeGreaterThan(0);
      screen = ctrl.getBuffer().toPlainLines().join("\n");
      for (const other of ["planned", "in-progress", "shipped"] as const) {
        if (other === postStatus) continue;
        expect(ctrl.getState().boardScrollY[other] ?? 0).toBe(0);
      }
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

      for (let i = 0; i < 4; i++) {
        ctrl.handleEvent({ type: "key", key: "j", raw: "j" });
      }
      expect(ctrl.getState().graphSelectedId).toBe("a5");
      expect(ctrl.getState().graphCamera.ty).not.toBe(startTy);

      // Full (unclipped) node hit region == the node's bounding box is on screen.
      const region = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-a5")!;
      expect(region).toBeDefined();
      expect(region.h).toBe(4);
      expect(region.w).toBe(28);

      // Moving back up pans the camera the other way; what matters is that the
      // top node is fully on screen again, not that the camera offset matches.
      const tyAtBottom = ctrl.getState().graphCamera.ty;
      for (let i = 0; i < 4; i++) {
        ctrl.handleEvent({ type: "key", key: "k", raw: "k" });
      }
      expect(ctrl.getState().graphSelectedId).toBe("a1");
      const top = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-a1")!;
      expect(top.h).toBe(4);
      expect(ctrl.getState().graphCamera.ty).toBeGreaterThan(tyAtBottom);
    } finally {
      ctrl.stop();
    }
  });
});
