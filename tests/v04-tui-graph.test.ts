import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoadmapService } from "../src/store";
import { TuiController } from "../src/tui/app";
import { computeWaterfallLayout } from "../src/tui/graph";
import type { InputEvent, TerminalSession } from "../src/tui/input";
import { TUI_PALETTE, type ColorMode, type PaletteColor } from "../src/tui/screen";

class VirtualGraphSession implements TerminalSession {
  width: number;
  height: number;
  colorMode: ColorMode = "truecolor";
  mouseOpts = { enabled: true, hover: false };
  private inputCbs = new Set<(ev: InputEvent) => void>();
  private resizeCbs = new Set<(w: number, h: number) => void>();

  constructor(width = 140, height = 42) {
    this.width = width;
    this.height = height;
  }

  enter(opts: { mouse: boolean; hover: boolean }): void {
    this.mouseOpts = { enabled: opts.mouse, hover: opts.hover };
  }
  leave(): void {}
  write(): void {}
  setMouseMode(opts: { enabled: boolean; hover: boolean }): void {
    this.mouseOpts = opts;
  }
  copyToClipboard(): void {}
  onInput(cb: (ev: InputEvent) => void): () => void {
    this.inputCbs.add(cb);
    return () => this.inputCbs.delete(cb);
  }
  onResize(cb: (w: number, h: number) => void): () => void {
    this.resizeCbs.add(cb);
    return () => this.resizeCbs.delete(cb);
  }

  clickDown(controller: TuiController, id: string): void {
    const r = controller.getBuffer().getHitRegions().find((reg) => reg.id === id);
    if (!r) throw new Error(`Hit region '${id}' not found`);
    controller.handleEvent({ type: "mouse", action: "down", button: "left", x: r.x, y: r.y });
  }

  clickFull(controller: TuiController, id: string): void {
    const r = controller.getBuffer().getHitRegions().find((reg) => reg.id === id);
    if (!r) throw new Error(`Hit region '${id}' not found`);
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2);
    controller.handleEvent({ type: "mouse", action: "down", button: "left", x: cx, y: cy });
    controller.handleEvent({ type: "mouse", action: "up", button: "left", x: cx, y: cy });
  }
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-tui-graph-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("v0.4 TUI Waterfall Dependency Graph", () => {
  test("arranges features top-to-bottom waterfall, fits 9-layer graph, and pans via click-and-drag", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Graph TUI App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "shipped", order: 10 });
    for (let i = 1; i <= 9; i++) {
      svc.addFeature({
        id: `layer-${i}`,
        title: `Layer ${i}`,
        milestone: "v0.1",
        status: i < 5 ? "shipped" : "planned",
        area: "Core",
        depends_on: i === 1 ? [] : [`layer-${i - 1}`],
      });
    }

    const session = new VirtualGraphSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickDown(ctrl, "tab-graph");
      const regions = ctrl.getBuffer().getHitRegions();
      const n1 = regions.find((r) => r.id === "graph-node-layer-1")!;
      const n2 = regions.find((r) => r.id === "graph-node-layer-2")!;
      const n3 = regions.find((r) => r.id === "graph-node-layer-3")!;
      expect(n1.y).toBeLessThan(n2.y);
      expect(n2.y).toBeLessThan(n3.y);

      // Viewport expands significantly in Graph mode (>= 80% of 42 rows)
      const vp = regions.find((r) => r.id === "graph-viewport")!;
      expect(vp.h).toBeGreaterThanOrEqual(33);

      // The graph fits on open: nine layers only fit at the overview density.
      expect(ctrl.getState().graphCamera.zoom).toBe("overview");
      session.clickDown(ctrl, "graph-zoom-in");
      expect(ctrl.getState().graphCamera.zoom).toBe("compact");
      session.clickDown(ctrl, "graph-zoom-in");
      expect(ctrl.getState().graphCamera.zoom).toBe("full");
      session.clickDown(ctrl, "graph-zoom-out");
      expect(ctrl.getState().graphCamera.zoom).toBe("compact");

      // Reset restores full
      session.clickDown(ctrl, "graph-zoom-reset");
      expect(ctrl.getState().graphCamera.zoom).toBe("full");

      // Fit fits all 9 layers cleanly in 140x42 viewport
      session.clickDown(ctrl, "graph-zoom-fit");
      expect(ctrl.getState().graphCamera.zoom).toBe("overview");
      for (let i = 1; i <= 9; i++) {
        expect(ctrl.getBuffer().getHitRegions().some((r) => r.id === `graph-node-layer-${i}`)).toBe(true);
      }

      // Click-and-drag panning starting on a node pans camera WITHOUT selecting or opening drawer
      const nodeRegion = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-layer-5")!;
      const beforeTx = ctrl.getState().graphCamera.tx;
      const beforeTy = ctrl.getState().graphCamera.ty;
      ctrl.handleEvent({ type: "mouse", action: "down", button: "left", x: nodeRegion.x + 2, y: nodeRegion.y });
      ctrl.handleEvent({ type: "mouse", action: "drag", button: "left", x: nodeRegion.x + 10, y: nodeRegion.y + 4 });
      ctrl.handleEvent({ type: "mouse", action: "up", button: "left", x: nodeRegion.x + 10, y: nodeRegion.y + 4 });
      expect(ctrl.getState().graphCamera.tx).not.toBe(beforeTx);
      expect(ctrl.getState().graphCamera.ty).not.toBe(beforeTy);
      expect(ctrl.getState().drawerFeatureId).toBeNull();
    } finally {
      ctrl.stop();
    }
  });

  test("enables Hover tracing by default in Graph view (move traces amber/green, single-click opens drawer) and supports Hover OFF mode", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Trace App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active", order: 10 });
    svc.addFeature({ id: "feat-a", title: "Base Store", milestone: "v0.1", status: "shipped" });
    svc.addFeature({ id: "feat-b", title: "Mid Layer", milestone: "v0.1", status: "in-progress", depends_on: ["feat-a"] });
    svc.addFeature({ id: "feat-c", title: "Top UI", milestone: "v0.1", status: "planned", depends_on: ["feat-b"] });

    const session = new VirtualGraphSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      // Hover tracking starts inactive in Cards view and enables automatically on Graph view switch
      expect(ctrl.getState().graphHoverEnabled).toBe(true);
      expect(session.mouseOpts.hover).toBe(false);

      session.clickDown(ctrl, "tab-graph");
      expect(ctrl.getState().graphHoverEnabled).toBe(true);
      expect(session.mouseOpts.hover).toBe(true);

      // Moving pointer over middle node B traces upstream feat-a (amber) and downstream feat-c (green)
      const boxB = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-b")!;
      ctrl.handleEvent({ type: "mouse", action: "move", button: "none", x: boxB.x + 1, y: boxB.y });
      expect(ctrl.getState().graphHoverId).toBe("feat-b");
      let nodeA = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-a")!;
      let nodeC = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-c")!;
      expect(ctrl.getBuffer().getCell(nodeA.x, nodeA.y)?.fg).toEqual(TUI_PALETTE.amber);
      expect(ctrl.getBuffer().getCell(nodeC.x, nodeC.y)?.fg).toEqual(TUI_PALETTE.green);

      // Single-click opens drawer when Hover is ON
      session.clickFull(ctrl, "graph-node-feat-c");
      expect(ctrl.getState().drawerFeatureId).toBe("feat-c");
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });

      // Toggle Hover OFF -> disables ?1003h on session; click-1 traces feat-b, click-2 opens drawer
      session.clickDown(ctrl, "graph-hover-toggle");
      expect(ctrl.getState().graphHoverEnabled).toBe(false);
      expect(session.mouseOpts.hover).toBe(false);

      session.clickFull(ctrl, "graph-node-feat-b");
      expect(ctrl.getState().graphSelectedId).toBe("feat-b");
      expect(ctrl.getState().drawerFeatureId).toBeNull();
      nodeA = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-a")!;
      nodeC = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-c")!;
      expect(ctrl.getBuffer().getCell(nodeA.x, nodeA.y)?.fg).toEqual(TUI_PALETTE.amber);
      expect(ctrl.getBuffer().getCell(nodeC.x, nodeC.y)?.fg).toEqual(TUI_PALETTE.green);

      session.clickFull(ctrl, "graph-node-feat-b");
      expect(ctrl.getState().drawerFeatureId).toBe("feat-b");
    } finally {
      ctrl.stop();
    }
  });

  const EDGE_GLYPHS: Record<string, true> = {
    "│": true,
    "─": true,
    "╭": true,
    "╮": true,
    "╰": true,
    "╯": true,
    "┬": true,
    "├": true,
    "┤": true,
    "┴": true,
    "┼": true,
    "▼": true,
  };

  type EdgeCellSnapshot = {
    ch: string;
    fg?: PaletteColor;
    bg?: PaletteColor;
    bold: boolean;
    dim: boolean;
  };
  type NodeRegion = { x: number; y: number; w: number; h: number };
  type GraphBuffer = { getCell(x: number, y: number): EdgeCellSnapshot | null };

  function isHighlightedEdgeCell(buf: GraphBuffer, x: number, y: number, fg: PaletteColor): boolean {
    const cell = buf.getCell(x, y);
    return Boolean(
      cell && cell.bold && cell.fg === fg && cell.bg === TUI_PALETTE.bg && EDGE_GLYPHS[cell.ch]
    );
  }

  /** Asserts a continuous visible highlighted-edge path from `from` to `to` (4-connected). */
  function assertAmberTraceConnected(
    buf: GraphBuffer,
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): void {
    expect(isHighlightedEdgeCell(buf, from.x, from.y, TUI_PALETTE.amber)).toBe(true);
    expect(isHighlightedEdgeCell(buf, to.x, to.y, TUI_PALETTE.amber)).toBe(true);
    const seen = new Set([`${from.x},${from.y}`]);
    const queue: Array<{ x: number; y: number }> = [from];
    let reached = false;
    while (queue.length > 0 && !reached) {
      const point = queue.shift()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = point.x + dx;
        const ny = point.y + dy;
        if (nx === to.x && ny === to.y) {
          reached = true;
          break;
        }
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        if (isHighlightedEdgeCell(buf, nx, ny, TUI_PALETTE.amber)) {
          seen.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    if (!reached) {
      throw new Error(`no continuous highlighted edge path from ${from.x},${from.y} to ${to.x},${to.y}`);
    }
  }

  /** The highlighted arrowhead into a node (arrivals are spread along its top edge). */
  function amberArrowInto(buf: GraphBuffer, reg: NodeRegion): { x: number; y: number } {
    for (let x = reg.x; x < reg.x + reg.w; x++) {
      const cell = buf.getCell(x, reg.y - 1);
      if (cell?.ch === "▼" && isHighlightedEdgeCell(buf, x, reg.y - 1, TUI_PALETTE.amber)) return { x, y: reg.y - 1 };
    }
    throw new Error("no highlighted arrowhead into the node");
  }

  /** Asserts no highlighted edge glyph in the row band from one row above the box through it. */
  function assertNoHighlightInNodeBand(buf: GraphBuffer, reg: NodeRegion): void {
    const offenders: string[] = [];
    for (let y = reg.y - 1; y < reg.y + reg.h; y++) {
      for (let x = reg.x; x < reg.x + reg.w; x++) {
        if (isHighlightedEdgeCell(buf, x, y, TUI_PALETTE.amber)) offenders.push(`${x},${y}`);
      }
    }
    expect(offenders).toEqual([]);
  }

  /** Asserts every incoming arrowhead of the node is a plain dim border arrow (not illuminated). */
  function assertDimIncomingArrow(buf: GraphBuffer, reg: NodeRegion): void {
    const arrows: EdgeCellSnapshot[] = [];
    for (let x = reg.x; x < reg.x + reg.w; x++) {
      const cell = buf.getCell(x, reg.y - 1);
      if (cell?.ch === "▼") arrows.push(cell);
    }
    expect(arrows.length).toBeGreaterThan(0);
    for (const cell of arrows) {
      expect(cell.fg).toEqual(TUI_PALETTE.border);
      expect(cell.dim).toBe(true);
    }
  }

  test("routes blocked skip-layer A→Z trace around unrelated X without crossing it or highlighting B→X", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Skip Route App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active", order: 10 });
    svc.addFeature({ id: "feat-a", title: "Root A", milestone: "v0.1", status: "planned" });
    svc.addFeature({ id: "feat-b", title: "Root B", milestone: "v0.1", status: "planned" });
    svc.addFeature({ id: "feat-x", title: "B Child X", milestone: "v0.1", status: "planned", depends_on: ["feat-b"] });
    svc.addFeature({ id: "feat-y", title: "B Child Y", milestone: "v0.1", status: "planned", depends_on: ["feat-b"] });
    svc.addFeature({ id: "feat-z", title: "Deep Z", milestone: "v0.1", status: "planned", depends_on: ["feat-a", "feat-y"] });

    // Premise established from the exported layout (not pinned columns): X's box intersects
    // the A→Z parent-center drop column and X is unrelated to Z, so the trace must dodge.
    const loaded = svc.load();
    const layout = computeWaterfallLayout(loaded.features, loaded.milestones, "full");
    const nodeA = layout.nodes.get("feat-a")!;
    const nodeX = layout.nodes.get("feat-x")!;
    const nodeZ = layout.nodes.get("feat-z")!;
    const dropCol = nodeA.x + Math.floor(nodeA.w / 2);
    const dropTop = nodeA.y + nodeA.h;
    const dropBottom = nodeZ.y - 2;
    expect(nodeX.x).toBeLessThanOrEqual(dropCol);
    expect(nodeX.x + nodeX.w).toBeGreaterThan(dropCol);
    expect(nodeX.y + nodeX.h - 1).toBeGreaterThanOrEqual(dropTop);
    expect(nodeX.y).toBeLessThanOrEqual(dropBottom);
    expect(layout.ancestors.get("feat-z")!.has("feat-x")).toBe(false);

    const session = new VirtualGraphSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickDown(ctrl, "tab-graph");

      const assertTrace = () => {
        const buf = ctrl.getBuffer();
        const regions = buf.getHitRegions();
        const regA = regions.find((r) => r.id === "graph-node-feat-a")!;
        const regX = regions.find((r) => r.id === "graph-node-feat-x")!;
        const regZ = regions.find((r) => r.id === "graph-node-feat-z")!;

        // The highlighted A→Z trace is continuously visible from A's drop cell to Z's arrowhead.
        assertAmberTraceConnected(buf, { x: regA.x + Math.floor(regA.w / 2), y: regA.y + regA.h }, amberArrowInto(buf, regZ));

        // The trace never traverses the unrelated X box (entry row through its bottom row).
        assertNoHighlightInNodeBand(buf, regX);

        // The unrelated B→X edge stays dim border: its arrowhead into X is not illuminated.
        // Y's incoming edge is deliberately NOT asserted dim: Y depends on B, so B is part
        // of Z's ancestry and B→Y legitimately highlights as part of the trace.
        assertDimIncomingArrow(buf, regX);
      };

      const hoverZ = () => {
        const regZ = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-z")!;
        ctrl.handleEvent({ type: "mouse", action: "move", button: "none", x: regZ.x + 1, y: regZ.y });
        expect(ctrl.getState().graphHoverId).toBe("feat-z");
      };

      hoverZ();
      assertTrace();

      // Pan the camera; the dodged shape must stay identical relative to the nodes.
      const regA = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-a")!;
      const beforeTx = ctrl.getState().graphCamera.tx;
      ctrl.handleEvent({ type: "mouse", action: "down", button: "left", x: regA.x + 2, y: regA.y });
      ctrl.handleEvent({ type: "mouse", action: "drag", button: "left", x: regA.x + 12, y: regA.y + 6 });
      ctrl.handleEvent({ type: "mouse", action: "up", button: "left", x: regA.x + 12, y: regA.y + 6 });
      expect(ctrl.getState().graphCamera.tx).not.toBe(beforeTx);
      expect(ctrl.getState().drawerFeatureId).toBeNull();

      hoverZ();
      assertTrace();
    } finally {
      ctrl.stop();
    }
  });

  test("keeps skip-layer drops on their straight path when the drop column is clear", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Clear Skip App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active", order: 10 });
    svc.addFeature({ id: "feat-a", title: "Root A", milestone: "v0.1", status: "planned" });
    svc.addFeature({ id: "feat-b", title: "Root B", milestone: "v0.1", status: "planned" });
    svc.addFeature({ id: "feat-c", title: "Root C", milestone: "v0.1", status: "planned" });
    svc.addFeature({ id: "feat-y", title: "A Child", milestone: "v0.1", status: "planned", depends_on: ["feat-a"] });
    svc.addFeature({ id: "feat-z", title: "Deep Z", milestone: "v0.1", status: "planned", depends_on: ["feat-c", "feat-y"] });

    const session = new VirtualGraphSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickDown(ctrl, "tab-graph");
      const buf = ctrl.getBuffer();
      const regions = buf.getHitRegions();
      const regB = regions.find((r) => r.id === "graph-node-feat-b")!;
      const regC = regions.find((r) => r.id === "graph-node-feat-c")!;
      const regY = regions.find((r) => r.id === "graph-node-feat-y")!;
      const regZ = regions.find((r) => r.id === "graph-node-feat-z")!;
      // Fixture sanity: single-node rows center on the stage, so Y and Z share B's column and
      // the C→Z bent two-layer skip drops down C's center column, clear of Y's box.
      expect(regY.x).toBe(regB.x);
      expect(regZ.x).toBe(regB.x);

      const cCx = regC.x + Math.floor(regC.w / 2);
      const dropTop = regC.y + regC.h;
      const arrowRow = regZ.y - 1;

      // Straight routing: drop down C's own column (clear of Y's box), turn once in the gap above
      // Z, and run to one of Z's arrowheads.
      let y = dropTop;
      while (y < arrowRow && ["│", "┼"].includes(buf.getCell(cCx, y)?.ch ?? "")) y++;
      expect(y).toBeGreaterThan(regY.y + regY.h - 1);
      expect(["╯", "╰"]).toContain(buf.getCell(cCx, y)?.ch ?? "");
      expect(y).toBeLessThan(arrowRow);
      // C's drop column never enters Y's box.
      expect(cCx < regY.x || cCx >= regY.x + regY.w).toBe(true);
      const zArrows = [...Array(regZ.w).keys()].filter((i) => buf.getCell(regZ.x + i, arrowRow)?.ch === "▼");
      expect(zArrows.length).toBe(2);

      // Adjacent-layer A→Y keeps its single arrowhead into Y's centre (A is selected on entry,
      // so the edge is drawn as a traced downstream edge).
      const yArrow = buf.getCell(regY.x + Math.floor(regY.w / 2), regY.y - 1);
      expect(yArrow?.ch).toBe("▼");
      expect(ctrl.getState().graphSelectedId).toBe("feat-a");
    } finally {
      ctrl.stop();
    }
  });

  test("dodges blocked straight skip-layer drops through free channels on both sides", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Dodge Straight App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active", order: 10 });
    svc.addFeature({ id: "feat-a", title: "Root A", milestone: "v0.1", status: "planned" });
    svc.addFeature({ id: "feat-b", title: "Root B", milestone: "v0.1", status: "planned" });
    svc.addFeature({ id: "feat-y", title: "A Child Y", milestone: "v0.1", status: "planned", depends_on: ["feat-a"] });
    svc.addFeature({ id: "feat-x", title: "B Child X", milestone: "v0.1", status: "planned", depends_on: ["feat-b"] });
    svc.addFeature({ id: "feat-z", title: "Deep Z", milestone: "v0.1", status: "planned", depends_on: ["feat-a", "feat-y"] });
    svc.addFeature({ id: "feat-v", title: "Deep V", milestone: "v0.1", status: "planned", depends_on: ["feat-b", "feat-x"] });

    // Premise established from the exported layout (no pinned columns): Z drops straight
    // down A's center through Y's box, and V drops straight down B's center through X's
    // box — both skip-layer drops are blocked and must dodge. X and V are unrelated to Z.
    const loaded = svc.load();
    const layout = computeWaterfallLayout(loaded.features, loaded.milestones, "full");
    const nodeA = layout.nodes.get("feat-a")!;
    const nodeB = layout.nodes.get("feat-b")!;
    const nodeY = layout.nodes.get("feat-y")!;
    const nodeX = layout.nodes.get("feat-x")!;
    const nodeZ = layout.nodes.get("feat-z")!;
    const nodeV = layout.nodes.get("feat-v")!;
    const aDropCol = nodeA.x + Math.floor(nodeA.w / 2);
    const bDropCol = nodeB.x + Math.floor(nodeB.w / 2);
    expect(nodeZ.x + Math.floor(nodeZ.w / 2)).toBe(aDropCol);
    expect(nodeY.x).toBeLessThanOrEqual(aDropCol);
    expect(nodeY.x + nodeY.w).toBeGreaterThan(aDropCol);
    expect(nodeY.y + nodeY.h - 1).toBeGreaterThanOrEqual(nodeA.y + nodeA.h);
    expect(nodeY.y).toBeLessThanOrEqual(nodeZ.y - 2);
    expect(nodeV.x + Math.floor(nodeV.w / 2)).toBe(bDropCol);
    expect(nodeX.x).toBeLessThanOrEqual(bDropCol);
    expect(nodeX.x + nodeX.w).toBeGreaterThan(bDropCol);
    expect(nodeX.y + nodeX.h - 1).toBeGreaterThanOrEqual(nodeB.y + nodeB.h);
    expect(nodeX.y).toBeLessThanOrEqual(nodeV.y - 2);
    expect(layout.ancestors.get("feat-z")!.has("feat-x")).toBe(false);
    expect(layout.ancestors.get("feat-z")!.has("feat-v")).toBe(false);

    const session = new VirtualGraphSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.clickDown(ctrl, "tab-graph");

      const regZ0 = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-z")!;
      ctrl.handleEvent({ type: "mouse", action: "move", button: "none", x: regZ0.x + 1, y: regZ0.y });
      expect(ctrl.getState().graphHoverId).toBe("feat-z");

      const buf = ctrl.getBuffer();
      const regions = buf.getHitRegions();
      const regA = regions.find((r) => r.id === "graph-node-feat-a")!;
      const regX = regions.find((r) => r.id === "graph-node-feat-x")!;
      const regV = regions.find((r) => r.id === "graph-node-feat-v")!;
      const regZ = regions.find((r) => r.id === "graph-node-feat-z")!;

      // The highlighted A→Z trace reaches Z's arrowhead continuously despite the dodge.
      assertAmberTraceConnected(buf, { x: regA.x + Math.floor(regA.w / 2), y: regA.y + regA.h }, amberArrowInto(buf, regZ));

      // The highlight never traverses the unrelated X and V boxes.
      assertNoHighlightInNodeBand(buf, regX);
      assertNoHighlightInNodeBand(buf, regV);

      // Their incoming edges stay dim border.
      assertDimIncomingArrow(buf, regX);
      assertDimIncomingArrow(buf, regV);
    } finally {
      ctrl.stop();
    }
  });
});
