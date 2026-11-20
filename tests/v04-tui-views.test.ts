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
});
