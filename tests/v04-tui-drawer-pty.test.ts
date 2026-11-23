import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeadsClient } from "../src/beads";
import { RoadmapService } from "../src/store";
import { TuiController } from "../src/tui/app";
import { getDrawerRect } from "../src/tui/drawer";
import { NodeTerminalSession, type InputEvent, type TerminalSession } from "../src/tui/input";
import type { ColorMode } from "../src/tui/screen";
import { cliCommand, REPO_ROOT, which } from "./helpers/cli";
import { waitFor } from "./helpers/wait";

class VirtualDrawerSession implements TerminalSession {
  width: number;
  height: number;
  colorMode: ColorMode = "truecolor";
  entered = false;
  mouseOpts = { enabled: true, hover: false };
  copied: string[] = [];
  private inputCbs = new Set<(ev: InputEvent) => void>();
  private resizeCbs = new Set<(w: number, h: number) => void>();

  constructor(width = 140, height = 42) {
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
  write(): void {}
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

  click(controller: TuiController, id: string): void {
    const r = controller.getBuffer().getHitRegions().find((reg) => reg.id === id);
    if (!r) throw new Error(`Hit region '${id}' not found`);
    controller.handleEvent({ type: "mouse", action: "down", button: "left", x: r.x, y: r.y });
    controller.handleEvent({ type: "mouse", action: "up", button: "left", x: r.x, y: r.y });
  }

  typeText(controller: TuiController, text: string): void {
    for (const ch of text) {
      controller.handleEvent({ type: "key", key: ch, raw: ch });
    }
  }
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-tui-drawer-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function seedProject(dir: string): RoadmapService {
  const svc = new RoadmapService(dir);
  svc.init({ name: "Drawer TUI Project", summary: "Drawer persistence & live watch suite." });
  svc.upsertMilestone({ id: "v0.1", title: "v0.1 Foundation", status: "active", order: 10 });
  svc.addFeature({
    id: "base-core",
    title: "Base Core",
    milestone: "v0.1",
    status: "shipped",
    area: "Core",
    ship_criteria: ["Store works"],
  });
  svc.checkFeatureCriterion("base-core", "1", true);
  svc.addFeature({
    id: "tui-drawer",
    title: "Interactive Drawer",
    milestone: "v0.1",
    status: "in-progress",
    area: "UI",
    depends_on: ["base-core"],
    refs: ["bd:pp-99"],
    description: "Split-pane on wide terminals and modal overlay on narrow panes.",
    ship_criteria: ["Toggle criteria", "Submit pulse notes"],
  });
  return svc;
}

describe("v0.4 TUI Detail Drawer, Persistence, Async Beads & PTY", () => {
  test("renders responsive split (>=120) vs modal (<120) drawer, persists criteria/status/notes, jumps deps, and supports m/y/?", () => {
    const svc = seedProject(tempDir);
    const session = new VirtualDrawerSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      // Open drawer in wide terminal -> split-pane mode keeping cards visible on left
      session.click(ctrl, "card-tui-drawer");
      expect(ctrl.getState().drawerFeatureId).toBe("tui-drawer");
      const panelHit = ctrl.getBuffer().getHitRegions().find((r) => r.id === "drawer-panel")!;
      expect(panelHit.x).toBeGreaterThanOrEqual(70);
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("Base Core");

      // Toggle criterion #1 via click -> persists to .project-pulse/ & ROADMAP.md
      session.click(ctrl, "drawer-criterion-toggle-criteria");
      expect(svc.load().features.find((f) => f.id === "tui-drawer")?.ship_criteria[0]?.done).toBe(true);
      expect(readFileSync(join(tempDir, "ROADMAP.md"), "utf8")).toContain("- [x] Toggle criteria");

      // Click status pill "shipped" -> updates status on disk
      session.click(ctrl, "drawer-status-shipped");
      expect(svc.load().features.find((f) => f.id === "tui-drawer")?.status).toBe("shipped");

      // Type and submit inline pulse note (including 'q' and 'n' characters)
      ctrl.handleEvent({ type: "key", key: "n", raw: "n" });
      session.typeText(ctrl, "Quick note saved");
      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      const updates = svc.load().features.find((f) => f.id === "tui-drawer")?.updates ?? [];
      expect(updates.at(-1)?.note).toBe("Quick note saved");

      // Click Depends On chip jumps drawer to upstream base-core
      session.click(ctrl, "drawer-jump-base-core");
      expect(ctrl.getState().drawerFeatureId).toBe("base-core");

      // y copies active feature ID via OSC 52 hook; m toggles mouse mode
      ctrl.handleEvent({ type: "key", key: "y", raw: "y" });
      expect(session.copied).toEqual(["base-core"]);
      ctrl.handleEvent({ type: "key", key: "m", raw: "m" });
      expect(ctrl.getState().mouseEnabled).toBe(false);
      expect(session.mouseOpts.enabled).toBe(false);

      // ? opens Help overlay cleanly
      ctrl.handleEvent({ type: "key", key: "?", raw: "?" });
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("Controls & SSH Tips");
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      expect(ctrl.getState().helpOpen).toBe(false);

      // Resize narrow (< 120 cols) switches drawer to centered modal with backdrop
      session.width = 96;
      session.height = 30;
      ctrl.render();
      expect(ctrl.getBuffer().getHitRegions().some((r) => r.id === "drawer-backdrop")).toBe(true);
      session.click(ctrl, "drawer-backdrop");
      expect(ctrl.getState().drawerFeatureId).toBeNull();
    } finally {
      ctrl.stop();
    }
  }, 15000);

  test("paints immediately before async Beads completes, hydrates Beads later, and preserves unsaved draft across live fs.watch reload", async () => {
    const svc = seedProject(tempDir);
    let resolveBeads!: (infos: Array<{ ref: string; id: string; available: boolean; found: boolean; status?: string; title?: string }>) => void;
    const deferredClient: BeadsClient = {
      async resolveRefs() {
        return await new Promise((res) => {
          resolveBeads = res;
        });
      },
    };

    const session = new VirtualDrawerSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, beadsClient: deferredClient, session });
    ctrl.start();

    try {
      // Instant first paint already rendered before async Beads resolved
      expect(ctrl.getState().beadsLoading).toBe(true);
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("Beads…");

      // Resolve delayed Beads client -> hydrates bd:pp-99 cleanly
      resolveBeads([
        {
          ref: "bd:pp-99",
          id: "pp-99",
          available: true,
          found: true,
          status: "in_progress",
          title: "Hydrated Bead",
        },
      ]);
      await waitFor(() => !ctrl.getState().beadsLoading, "beads hydration");
      expect(ctrl.getState().beadsLoading).toBe(false);

      // Open drawer, confirm hydrated Beads ref displays cleanly, type draft note, and trigger external fs.watch write
      session.click(ctrl, "card-tui-drawer");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("bd:pp-99 — in_progress: Hydrated Bead");

      ctrl.handleEvent({ type: "key", key: "n", raw: "n" });
      session.typeText(ctrl, "Unsaved SSH draft");
      svc.addFeatureNote("tui-drawer", "External agent note");

      await waitFor(
        () => ctrl.getBuffer().toPlainLines().join("\n").includes("External agent note"),
        "fs.watch reload to render external note"
      );
      expect(ctrl.getState().noteDrafts["tui-drawer"]).toBe("Unsaved SSH draft");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("External agent note");
    } finally {
      ctrl.stop();
    }
  });

  test.skipIf(which("python3") === null)("headless PTY smoke test enters alt-screen, renders dashboard, and restores terminal cleanly on q", async () => {
    seedProject(tempDir);
    const repoRoot = REPO_ROOT;
    // The Python script launches exactly the argv this runtime/tests config selects (source CLI
    // under Bun, the built bundle under Node or PP_TEST_CLI) — it never reinserts a `run` arg.
    const prefixArgv = JSON.stringify([cliCommand().execPath, ...cliCommand().args]);

    const pyScript = `
import json, os, pty, select, subprocess, time, sys
master, slave = pty.openpty()
prefix = json.loads(sys.argv[1])
proc = subprocess.Popen(
    prefix + ["--root", sys.argv[2], "view", "--tui", "--no-beads"],
    stdin=slave, stdout=slave, stderr=slave, close_fds=True,
    env={**os.environ, "TERM": "xterm-256color"}
)
os.close(slave)
chunks = []
deadline = time.time() + 5.0
sent_q = False
while time.time() < deadline:
    r, _, _ = select.select([master], [], [], 0.1)
    if r:
        try:
            data = os.read(master, 8192)
            if not data:
                break
            chunks.append(data)
            joined = b"".join(chunks)
            if not sent_q and b"Drawer TUI Project" in joined:
                os.write(master, b"q")
                sent_q = True
        except OSError:
            break
    if proc.poll() is not None and not r:
        break
rc = proc.wait(timeout=3)
os.close(master)
out = b"".join(chunks).decode("utf-8", errors="replace")
assert "\\x1b[?1049h" in out, "missing alt-screen enter"
assert "\\x1b[?1049l" in out, "missing alt-screen leave"
assert "Drawer TUI Project" in out, "missing rendered project title"
sys.exit(rc)
`;
    const res = spawnSync("python3", ["-c", pyScript, prefixArgv, tempDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(res.status, res.stderr).toBe(0);
  });

  test("health modal out-ranks open drawer: Close click dismisses only Health, covered status/criteria untouched on disk", () => {
    const svc = seedProject(tempDir);
    const session = new VirtualDrawerSession(140, 42); // split drawer overlaps the centered health modal
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.click(ctrl, "card-tui-drawer");
      expect(ctrl.getState().drawerFeatureId).toBe("tui-drawer");
      const roadmapBefore = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");

      session.click(ctrl, "health-toggle");
      expect(ctrl.getState().healthPanelOpen).toBe(true);

      // The Health Close pill paints over drawer controls; the covered drawer pill must lose the hitTest
      const closePill = ctrl.getBuffer().getHitRegions().find((r) => r.id === "health-close")!;
      expect(closePill).toBeDefined();
      expect(ctrl.getBuffer().hitTest(closePill.x, closePill.y)?.id).toBe("health-close");

      // Real click on the Close pill at its rendered coordinates
      ctrl.handleEvent({ type: "mouse", action: "down", button: "left", x: closePill.x, y: closePill.y });
      ctrl.handleEvent({ type: "mouse", action: "up", button: "left", x: closePill.x, y: closePill.y });
      expect(ctrl.getState().healthPanelOpen).toBe(false);
      expect(ctrl.getState().drawerFeatureId).toBe("tui-drawer");

      // A covered criterion is equally protected: backdrop click over it dismisses Health without toggling
      session.click(ctrl, "health-toggle");
      expect(ctrl.getState().healthPanelOpen).toBe(true);
      const criterion = ctrl
        .getBuffer()
        .getHitRegions()
        .find((r) => r.id === "drawer-criterion-toggle-criteria")!;
      expect(criterion).toBeDefined();
      ctrl.handleEvent({ type: "mouse", action: "down", button: "left", x: criterion.x, y: criterion.y });
      ctrl.handleEvent({ type: "mouse", action: "up", button: "left", x: criterion.x, y: criterion.y });
      expect(ctrl.getState().healthPanelOpen).toBe(false);

      // Feature status and criteria unchanged on disk
      const feature = svc.load().features.find((f) => f.id === "tui-drawer")!;
      expect(feature.status).toBe("in-progress");
      expect(feature.ship_criteria.every((c) => !c.done)).toBe(true);
      expect(feature.updates ?? []).toEqual([]);
      expect(readFileSync(join(tempDir, "ROADMAP.md"), "utf8")).toBe(roadmapBefore);
    } finally {
      ctrl.stop();
    }
  });

  test("filter picker out-ranks open drawer: click over covered drawer control dismisses picker without mutating disk", () => {
    const svc = seedProject(tempDir);
    const session = new VirtualDrawerSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      session.click(ctrl, "card-tui-drawer");
      expect(ctrl.getState().drawerFeatureId).toBe("tui-drawer");

      // Status filter dropdown opens above the split drawer
      session.click(ctrl, "picker-status");
      expect(ctrl.getState().openPicker?.kind).toBe("status");

      // Clicking where a covered drawer status pill sits must dismiss the picker only —
      // never leak into the covered control or persist a status change
      const coveredPill = ctrl.getBuffer().getHitRegions().find((r) => r.id === "drawer-status-shipped")!;
      expect(coveredPill).toBeDefined();
      ctrl.handleEvent({ type: "mouse", action: "down", button: "left", x: coveredPill.x, y: coveredPill.y });
      ctrl.handleEvent({ type: "mouse", action: "up", button: "left", x: coveredPill.x, y: coveredPill.y });
      expect(ctrl.getState().openPicker).toBeNull();
      expect(ctrl.getState().statusFilter).toBe("");
      expect(ctrl.getState().drawerFeatureId).toBe("tui-drawer");
      expect(svc.load().features.find((f) => f.id === "tui-drawer")?.status).toBe("in-progress");

      // The picker itself remains fully usable above the drawer
      session.click(ctrl, "picker-status");
      const firstOpt = ctrl.getBuffer().getHitRegions().find((r) => r.id === "picker-opt-0")!;
      expect(firstOpt).toBeDefined();
      // HitRegion.data is set in-process by renderFloatingPicker as { kind, value }
      const opt = firstOpt.data as { kind: string; value: string };
      session.click(ctrl, "picker-opt-0");
      expect(ctrl.getState().openPicker).toBeNull();
      expect(ctrl.getState().statusFilter).toBe(opt.value);
    } finally {
      ctrl.stop();
    }
  });

  test("NodeTerminalSession reports the real pane size instead of inflated minimums", () => {
    const session = new NodeTerminalSession();
    const out = process.stdout as unknown as { columns?: number; rows?: number };
    const prevCols = out.columns;
    const prevRows = out.rows;
    try {
      // An eight-row pane must yield height 8 so the frame can never write past
      // the terminal's last row (previously floored at 10).
      out.columns = 100;
      out.rows = 8;
      expect(session.width).toBe(100);
      expect(session.height).toBe(8);

      out.columns = undefined;
      out.rows = undefined;
      expect(session.width).toBe(80);
      expect(session.height).toBe(24);
    } finally {
      out.columns = prevCols;
      out.rows = prevRows;
    }
  });

  test("getDrawerRect clamps to small panes instead of imposing 36x14", () => {
    // Modal on a 100x8 pane: centered with margins, footer row free.
    const modal = getDrawerRect(100, 8, 3);
    expect(modal.mode).toBe("modal");
    expect(modal.x).toBeGreaterThanOrEqual(1);
    expect(modal.y).toBeGreaterThanOrEqual(1);
    expect(modal.x + modal.w).toBeLessThanOrEqual(99);
    expect(modal.y + modal.h).toBeLessThanOrEqual(7);

    // Wide but eight-row pane falls back to the modal: the split area is too
    // short for frame + pinned header + a body row.
    const wideShort = getDrawerRect(140, 8, 3);
    expect(wideShort.mode).toBe("modal");
    expect(wideShort.y).toBeGreaterThanOrEqual(1);
    expect(wideShort.y + wideShort.h).toBeLessThanOrEqual(7);

    // Split on a wide pane with real vertical space below the tabs.
    const split = getDrawerRect(140, 14, 3);
    expect(split.mode).toBe("split");
    expect(split.y).toBe(3);
    expect(split.h).toBeGreaterThanOrEqual(6);
    expect(split.y + split.h).toBeLessThanOrEqual(13);
    expect(split.x + split.w).toBeLessThanOrEqual(140);

    // Narrow pane shrinks the modal width below the old 36 floor.
    const narrow = getDrawerRect(30, 24, 3);
    expect(narrow.mode).toBe("modal");
    expect(narrow.x + narrow.w).toBeLessThanOrEqual(29);
    expect(narrow.y + narrow.h).toBeLessThanOrEqual(23);
  });

  test("eight-row pane: drawer fits, paging reaches the bottom, focusing the note reveals the input", () => {
    seedProject(tempDir);
    const session = new VirtualDrawerSession(100, 8);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      ctrl.getState().selectedFeatureId = "tui-drawer";
      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      expect(ctrl.getState().drawerFeatureId).toBe("tui-drawer");

      // No hit region may reach outside the 8-row pane.
      for (const r of ctrl.getBuffer().getHitRegions()) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(100);
        expect(r.y + r.h).toBeLessThanOrEqual(8);
      }

      const panel = ctrl.getBuffer().getHitRegions().find((r) => r.id === "drawer-panel")!;
      expect(panel).toBeDefined();
      // Footer row stays free and the drawer's bottom border is painted in-pane.
      expect(panel.y + panel.h).toBeLessThanOrEqual(7);
      const bottomRow = ctrl.getBuffer().toPlainLines()[panel.y + panel.h - 1]!;
      expect(bottomRow).toContain("╰");
      expect(bottomRow).toContain("╯");

      // The inline note input sits far below the one visible body row.
      expect(
        ctrl.getBuffer().getHitRegions().find((r) => r.id === "drawer-note-input")
      ).toBeUndefined();

      // Page down until clamped: the bottom of the drawer is reachable.
      let last = -1;
      for (let i = 0; i < 40 && ctrl.getState().drawerScrollY !== last; i++) {
        last = ctrl.getState().drawerScrollY;
        ctrl.handleEvent({ type: "key", key: "pagedown", raw: "\x1b[6~" });
      }
      expect(ctrl.getState().drawerScrollY).toBe(last);
      expect(last).toBeGreaterThan(0);

      // Focusing the note auto-reveals the input row inside the drawer body.
      ctrl.handleEvent({ type: "key", key: "n", raw: "n" });
      expect(ctrl.getState().drawerFocus).toBe("note");
      const noteInput = ctrl
        .getBuffer()
        .getHitRegions()
        .find((r) => r.id === "drawer-note-input")!;
      expect(noteInput).toBeDefined();
      expect(noteInput.y).toBe(panel.y + 4); // body row under the pinned divider
      const noteSubmit = ctrl
        .getBuffer()
        .getHitRegions()
        .find((r) => r.id === "drawer-note-submit")!;
      expect(noteSubmit).toBeDefined();
      expect(noteSubmit.y).toBe(noteInput.y);
      expect(ctrl.getState().drawerScrollY).toBeGreaterThan(0);

      // Escape returns to criteria (keys route to the note editor while it is
      // focused); Tab re-enters the note and keeps it revealed.
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      expect(ctrl.getState().drawerFocus).toBe("criteria");
      ctrl.handleEvent({ type: "key", key: "tab", raw: "\t" });
      expect(ctrl.getState().drawerFocus).toBe("note");
      expect(
        ctrl.getBuffer().getHitRegions().find((r) => r.id === "drawer-note-input")
      ).toBeDefined();
    } finally {
      ctrl.stop();
    }
  });

  test("long dependency chips truncate inside the drawer while keeping a full-width click target", () => {
    const svc = seedProject(tempDir);
    svc.addFeature({
      id: "upstream-feature-with-a-very-long-identifier-for-truncation",
      title: "Long Upstream",
      milestone: "v0.1",
      status: "planned",
    });
    svc.addFeature({
      id: "chip-truncation",
      title: "Chip Truncation",
      milestone: "v0.1",
      status: "planned",
      depends_on: ["upstream-feature-with-a-very-long-identifier-for-truncation"],
    });
    const session = new VirtualDrawerSession(140, 42);
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();

    try {
      ctrl.getState().selectedFeatureId = "chip-truncation";
      ctrl.handleEvent({ type: "key", key: "enter", raw: "\r" });
      const panel = ctrl.getBuffer().getHitRegions().find((r) => r.id === "drawer-panel")!;
      expect(panel).toBeDefined();

      const depId = "upstream-feature-with-a-very-long-identifier-for-truncation";
      const chip = ctrl
        .getBuffer()
        .getHitRegions()
        .find((r) => r.id === `drawer-jump-${depId}`)!;
      // The chip is rendered (not skipped) and clipped to the drawer's own rect.
      expect(chip).toBeDefined();
      expect(chip.x).toBeGreaterThanOrEqual(panel.x + 1);
      expect(chip.x + chip.w).toBeLessThanOrEqual(panel.x + panel.w - 1);
      expect(chip.w).toBe(panel.w - 3); // fills the full inner width when truncated

      const row = ctrl.getBuffer().toPlainLines()[chip.y]!;
      const inside = row.slice(chip.x, chip.x + chip.w);
      expect(inside.trim().startsWith("→ ")).toBe(true);
      expect(inside).toContain("…");
      // The untruncated tail never paints past the drawer border.
      expect(row).not.toContain("for-truncation");

      // The truncated chip keeps its full click target and still jumps.
      session.click(ctrl, `drawer-jump-${depId}`);
      expect(ctrl.getState().drawerFeatureId).toBe(depId);
    } finally {
      ctrl.stop();
    }
  });

  test("long card area labels truncate inside their card instead of painting into neighbors", () => {
    const svc = seedProject(tempDir);
    svc.addFeature({
      id: "area-overflow-card",
      title: "Area Overflow",
      milestone: "v0.1",
      status: "planned",
      area: "Platform Infrastructure and Developer Experience Group",
    });
    const ctrl = new TuiController({
      rootDir: tempDir,
      noBeads: true,
      session: new VirtualDrawerSession(140, 42),
    });
    ctrl.start();

    try {
      const card = ctrl
        .getBuffer()
        .getHitRegions()
        .find((r) => r.id === "card-area-overflow-card")!;
      expect(card).toBeDefined();

      const row = ctrl.getBuffer().toPlainLines()[card.y + 2]!;
      // Interior slice: skip the left border plus padding and the right border.
      const inside = row.slice(card.x + 2, card.x + card.w - 2);
      // ID keeps its reserved cells on the left; 4 cells hold a truncated
      // prefix plus the ellipsis ("are…"), never spilling into the label.
      expect(inside.startsWith("are…")).toBe(true);
      // The area label is ellipsis-truncated within the card rectangle.
      expect(inside).toContain("…");
      expect(row).not.toContain("Experience Group");

      // Nothing bleeds through the gap into the neighboring card.
      expect(row.slice(card.x + card.w, card.x + card.w + 2)).toMatch(/^[\s│]*$/);

      // The whole card stays the click target where the truncated label sits.
      expect(ctrl.getBuffer().hitTest(card.x + card.w - 3, card.y + 2)?.id).toBe(
        "card-area-overflow-card"
      );
    } finally {
      ctrl.stop();
    }
  });
});
