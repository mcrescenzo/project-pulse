import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BeadsClient } from "../src/beads";
import { RoadmapService } from "../src/store";
import { TuiController } from "../src/tui/app";
import type { InputEvent, TerminalSession } from "../src/tui/input";
import type { ColorMode } from "../src/tui/screen";

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
    this.mouseOpts = opts;
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
  });

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
      await new Promise((r) => setTimeout(r, 20));
      expect(ctrl.getState().beadsLoading).toBe(false);

      // Open drawer, confirm hydrated Beads ref displays cleanly, type draft note, and trigger external fs.watch write
      session.click(ctrl, "card-tui-drawer");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("bd:pp-99 — in_progress: Hydrated Bead");

      ctrl.handleEvent({ type: "key", key: "n", raw: "n" });
      session.typeText(ctrl, "Unsaved SSH draft");
      svc.addFeatureNote("tui-drawer", "External agent note");

      await new Promise((r) => setTimeout(r, 320));
      expect(ctrl.getState().noteDrafts["tui-drawer"]).toBe("Unsaved SSH draft");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("External agent note");
    } finally {
      ctrl.stop();
    }
  });

  test("headless PTY smoke test enters alt-screen, renders dashboard, and restores terminal cleanly on q", async () => {
    seedProject(tempDir);
    const repoRoot = resolve(import.meta.dir, "..");
    const cliPath = join(repoRoot, "src", "cli.ts");
    const hasPython = existsSync("/usr/bin/python3") || Bun.which("python3");
    if (!hasPython) return;

    const pyScript = `
import os, pty, select, subprocess, time, sys
master, slave = pty.openpty()
proc = subprocess.Popen(
    ["bun", "run", sys.argv[1], "--root", sys.argv[2], "view", "--tui", "--no-beads"],
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
    const res = Bun.spawnSync(["python3", "-c", pyScript, cliPath, tempDir], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(res.exitCode).toBe(0);
  });
});
