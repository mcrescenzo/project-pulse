import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoadmapService } from "../src/store";
import { TuiController } from "../src/tui/app";
import type { InputEvent, TerminalSession } from "../src/tui/input";
import { TUI_PALETTE, type ColorMode } from "../src/tui/screen";

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
    this.mouseOpts = opts;
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

      // Step down Full -> Compact -> Overview via zoom out button
      expect(ctrl.getState().graphCamera.zoom).toBe("full");
      session.clickDown(ctrl, "graph-zoom-out");
      expect(ctrl.getState().graphCamera.zoom).toBe("compact");
      session.clickDown(ctrl, "graph-zoom-out");
      expect(ctrl.getState().graphCamera.zoom).toBe("overview");

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

  test("traces upstream amber & downstream green on first click (Hover OFF), opens drawer on second click, and supports Hover ON", () => {
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
      session.clickDown(ctrl, "tab-graph");
      expect(ctrl.getState().graphHoverEnabled).toBe(false);

      // Click 1 selects/traces middle node B without opening drawer
      session.clickFull(ctrl, "graph-node-feat-b");
      expect(ctrl.getState().graphSelectedId).toBe("feat-b");
      expect(ctrl.getState().drawerFeatureId).toBeNull();

      // Upstream feat-a highlighted amberSoft; downstream feat-c highlighted greenSoft
      const nodeA = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-a")!;
      const nodeC = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-c")!;
      expect(ctrl.getBuffer().getCell(nodeA.x, nodeA.y)?.fg).toEqual(TUI_PALETTE.amber);
      expect(ctrl.getBuffer().getCell(nodeC.x, nodeC.y)?.fg).toEqual(TUI_PALETTE.green);

      // Click 2 on already-selected node B opens drawer
      session.clickFull(ctrl, "graph-node-feat-b");
      expect(ctrl.getState().drawerFeatureId).toBe("feat-b");
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });

      // Enable Hover ON -> enables ?1003h on session, move traces feat-a, single-click opens feat-c
      session.clickDown(ctrl, "graph-hover-toggle");
      expect(ctrl.getState().graphHoverEnabled).toBe(true);
      expect(session.mouseOpts.hover).toBe(true);

      const boxA = ctrl.getBuffer().getHitRegions().find((r) => r.id === "graph-node-feat-a")!;
      ctrl.handleEvent({ type: "mouse", action: "move", button: "none", x: boxA.x + 1, y: boxA.y });
      expect(ctrl.getState().graphHoverId).toBe("feat-a");

      session.clickFull(ctrl, "graph-node-feat-c");
      expect(ctrl.getState().drawerFeatureId).toBe("feat-c");
    } finally {
      ctrl.stop();
    }
  });
});
