import { TuiController, type TuiControllerOptions } from "../../src/tui/app";
import type { InputEvent, TerminalSession } from "../../src/tui/input";
import type { ColorMode } from "../../src/tui/screen";

/** In-memory terminal for driving the real TuiController in tests. */
export class VirtualSession implements TerminalSession {
  colorMode: ColorMode = "truecolor";
  entered = false;
  mouseOpts = { enabled: true, hover: false };
  writes: string[] = [];
  copied: string[] = [];
  private inputCbs = new Set<(ev: InputEvent) => void>();
  private resizeCbs = new Set<(w: number, h: number) => void>();

  constructor(
    public width = 80,
    public height = 24
  ) {}

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
}

export function openTui(
  rootDir: string,
  width = 80,
  height = 24,
  options: Partial<TuiControllerOptions> = {}
): { ctrl: TuiController; session: VirtualSession } {
  const session = new VirtualSession(width, height);
  const ctrl = new TuiController({ rootDir, session, noBeads: true, ...options });
  ctrl.start();
  return { ctrl, session };
}

export function press(ctrl: TuiController, key: string, times = 1): void {
  for (let i = 0; i < times; i++) ctrl.handleEvent({ type: "key", key, raw: key.length === 1 ? key : "" });
}

export function typeText(ctrl: TuiController, text: string): void {
  for (const ch of text) ctrl.handleEvent({ type: "key", key: ch, raw: ch });
}

export function screenText(ctrl: TuiController): string {
  return ctrl.getBuffer().toPlainLines().join("\n");
}

export function clickHit(ctrl: TuiController, predicate: (r: { id: string; kind: string; data?: unknown }) => boolean): boolean {
  const r = ctrl.getBuffer().getHitRegions().find(predicate);
  if (!r) return false;
  ctrl.handleEvent({ type: "mouse", action: "down", button: "left", x: r.x, y: r.y });
  ctrl.handleEvent({ type: "mouse", action: "up", button: "left", x: r.x, y: r.y });
  return true;
}
