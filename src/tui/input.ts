import { StringDecoder } from "node:string_decoder";
import { detectColorMode, sanitizeTerminalText, type ColorMode } from "./screen";

export interface KeyEvent {
  type: "key";
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  raw: string;
}

export type MouseAction = "down" | "up" | "drag" | "move" | "wheel-up" | "wheel-down";
export type MouseButton = "left" | "middle" | "right" | "none";

export interface MouseEvent {
  type: "mouse";
  action: MouseAction;
  button: MouseButton;
  x: number;
  y: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

export type InputEvent = KeyEvent | MouseEvent;

const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const CSI_SEQ_RE = /^\x1b\[([0-9;]*)([A-Za-z~])/;
const SS3_SEQ_RE = /^\x1bO([A-Za-z])/;

const CSI_KEY_MAP: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  Z: "tab",
};

const TILDE_KEY_MAP: Record<string, string> = {
  "1": "home",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
};

function decodeSgrMouse(cb: number, cx: number, cy: number, kind: string): MouseEvent {
  const shift = (cb & 4) !== 0;
  const alt = (cb & 8) !== 0;
  const ctrl = (cb & 16) !== 0;
  const isMotion = (cb & 32) !== 0;
  const isWheel = (cb & 64) !== 0;
  const btnBits = cb & 3;
  const button: MouseButton =
    btnBits === 0 ? "left" : btnBits === 1 ? "middle" : btnBits === 2 ? "right" : "none";
  const x = Math.max(0, cx - 1);
  const y = Math.max(0, cy - 1);

  if (isWheel) {
    return {
      type: "mouse",
      action: btnBits === 0 ? "wheel-up" : "wheel-down",
      button: "none",
      x,
      y,
      shift,
      ctrl,
      alt,
    };
  }

  let action: MouseAction;
  if (isMotion) {
    action = button === "none" ? "move" : "drag";
  } else {
    action = kind === "m" ? "up" : "down";
  }

  return { type: "mouse", action, button, x, y, shift, ctrl, alt };
}

function decodeCsiKey(params: string, finalCh: string, raw: string): KeyEvent | null {
  const parts = params ? params.split(";") : [];
  const mod = parts.length > 1 ? Number(parts[parts.length - 1]) : 1;
  const shift = finalCh === "Z" || (Number.isFinite(mod) && ((mod - 1) & 1) !== 0);
  const alt = Number.isFinite(mod) && ((mod - 1) & 2) !== 0;
  const ctrl = Number.isFinite(mod) && ((mod - 1) & 4) !== 0;

  if (finalCh === "~") {
    const key = TILDE_KEY_MAP[parts[0] ?? ""];
    if (!key) return null;
    return { type: "key", key, shift, alt, ctrl, raw };
  }

  const key = CSI_KEY_MAP[finalCh];
  if (!key) return null;
  return { type: "key", key, shift, alt, ctrl, raw };
}

function isIncompleteEscPrefix(buf: string): boolean {
  if (buf === "\x1b" || buf === "\x1b[" || buf === "\x1bO" || buf === "\x1b[<") {
    return true;
  }
  if (buf.startsWith("\x1b[<")) {
    return !/[Mm]$/.test(buf) && /^\x1b\[<[0-9;]*$/.test(buf);
  }
  if (buf.startsWith("\x1b[")) {
    return /^\x1b\[[0-9;?]*$/.test(buf);
  }
  return false;
}

/**
 * Stateful keyboard + SGR mouse parser resilient to split TCP/SSH chunks.
 */
export class InputDecoder {
  private readonly utf8 = new StringDecoder("utf8");
  private pending = "";

  hasPendingEscape(): boolean {
    return this.pending === "\x1b" || isIncompleteEscPrefix(this.pending);
  }

  flushPendingEscape(): InputEvent[] {
    if (!this.pending) return [];
    if (this.pending === "\x1b") {
      this.pending = "";
      return [{ type: "key", key: "escape", raw: "\x1b" }];
    }
    this.pending = "";
    return [];
  }

  feed(chunk: string | Buffer): InputEvent[] {
    const text = typeof chunk === "string" ? chunk : this.utf8.write(chunk);
    this.pending += text;
    const events: InputEvent[] = [];

    while (this.pending.length > 0) {
      if (this.pending[0] === "\x1b") {
        if (this.pending.length >= 2 && this.pending[1] === "\x1b") {
          events.push({ type: "key", key: "escape", raw: "\x1b" });
          this.pending = this.pending.slice(1);
          continue;
        }

        const mouseMatch = SGR_MOUSE_RE.exec(this.pending);
        if (mouseMatch) {
          events.push(
            decodeSgrMouse(
              Number(mouseMatch[1]),
              Number(mouseMatch[2]),
              Number(mouseMatch[3]),
              mouseMatch[4]!
            )
          );
          this.pending = this.pending.slice(mouseMatch[0].length);
          continue;
        }

        const csiMatch = CSI_SEQ_RE.exec(this.pending);
        if (csiMatch) {
          const ev = decodeCsiKey(csiMatch[1] ?? "", csiMatch[2]!, csiMatch[0]);
          if (ev) events.push(ev);
          this.pending = this.pending.slice(csiMatch[0].length);
          continue;
        }

        const ss3Match = SS3_SEQ_RE.exec(this.pending);
        if (ss3Match) {
          const mapped = CSI_KEY_MAP[ss3Match[1]!];
          if (mapped) events.push({ type: "key", key: mapped, raw: ss3Match[0] });
          this.pending = this.pending.slice(ss3Match[0].length);
          continue;
        }

        if (isIncompleteEscPrefix(this.pending)) {
          break;
        }

        if (this.pending.length >= 2) {
          const altCh = this.pending[1]!;
          if (altCh >= " " && altCh !== "\x7f") {
            events.push({ type: "key", key: altCh, alt: true, raw: this.pending.slice(0, 2) });
            this.pending = this.pending.slice(2);
            continue;
          }
        }

        this.pending = this.pending.slice(1);
        events.push({ type: "key", key: "escape", raw: "\x1b" });
        continue;
      }

      const cp = this.pending.codePointAt(0)!;
      const ch = String.fromCodePoint(cp);
      this.pending = this.pending.slice(ch.length);

      if (ch === "\r" || ch === "\n") {
        events.push({ type: "key", key: "enter", raw: ch });
      } else if (ch === "\t") {
        events.push({ type: "key", key: "tab", raw: ch });
      } else if (ch === "\x7f" || ch === "\b") {
        events.push({ type: "key", key: "backspace", raw: ch });
      } else if (cp >= 1 && cp <= 26) {
        const letter = String.fromCharCode(96 + cp);
        events.push({ type: "key", key: letter, ctrl: true, raw: ch });
      } else if (cp >= 32) {
        events.push({ type: "key", key: ch, raw: ch });
      }
    }

    return events;
  }
}

/**
 * Encodes clean text into an OSC 52 clipboard escape sequence capped at 4096 bytes.
 */
export function encodeOsc52Copy(text: string): string {
  const clean = sanitizeTerminalText(text);
  const bytes = Buffer.from(clean, "utf8").subarray(0, 4096);
  return `\x1b]52;c;${bytes.toString("base64")}\x07`;
}

export interface TerminalSession {
  readonly width: number;
  readonly height: number;
  readonly colorMode: ColorMode;
  enter(opts: { mouse: boolean; hover: boolean }): void;
  leave(): void;
  write(data: string): void;
  setMouseMode(opts: { enabled: boolean; hover: boolean }): void;
  copyToClipboard(text: string): void;
  onInput(cb: (ev: InputEvent) => void): () => void;
  onResize(cb: (w: number, h: number) => void): () => void;
}

function buildMouseModeEscapes(opts: { enabled: boolean; hover: boolean }): string {
  if (!opts.enabled) {
    return "\x1b[?1003l\x1b[?1006l\x1b[?1002l\x1b[?1000l";
  }
  const base = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
  return base + (opts.hover ? "\x1b[?1003h" : "\x1b[?1003l");
}

export class NodeTerminalSession implements TerminalSession {
  readonly colorMode: ColorMode;
  private readonly decoder = new InputDecoder();
  private readonly inputListeners = new Set<(ev: InputEvent) => void>();
  private readonly resizeListeners = new Set<(w: number, h: number) => void>();
  private entered = false;
  private escTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly handleData = (chunk: Buffer | string) => {
    if (this.escTimer) {
      clearTimeout(this.escTimer);
      this.escTimer = null;
    }
    for (const ev of this.decoder.feed(chunk)) {
      this.emitInput(ev);
    }
    if (this.decoder.hasPendingEscape()) {
      this.escTimer = setTimeout(() => {
        this.escTimer = null;
        for (const ev of this.decoder.flushPendingEscape()) {
          this.emitInput(ev);
        }
      }, 25);
    }
  };

  private readonly handleResize = () => {
    const w = this.width;
    const h = this.height;
    for (const cb of this.resizeListeners) cb(w, h);
  };

  private readonly handleSignal = () => {
    this.leave();
  };

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.colorMode = detectColorMode(env);
  }

  get width(): number {
    return Math.max(20, process.stdout.columns || 80);
  }

  get height(): number {
    return Math.max(10, process.stdout.rows || 24);
  }

  private emitInput(ev: InputEvent): void {
    for (const cb of Array.from(this.inputListeners)) {
      cb(ev);
    }
  }

  enter(opts: { mouse: boolean; hover: boolean }): void {
    if (this.entered) return;
    this.entered = true;
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", this.handleData);
    process.stdout.on("resize", this.handleResize);
    process.on("SIGWINCH", this.handleResize);
    process.on("SIGINT", this.handleSignal);
    process.on("SIGTERM", this.handleSignal);
    process.on("SIGHUP", this.handleSignal);
    process.on("exit", this.handleSignal);
    this.write("\x1b[?1049h\x1b[?25l" + buildMouseModeEscapes({ enabled: opts.mouse, hover: opts.hover }));
  }

  leave(): void {
    if (!this.entered) return;
    this.entered = false;
    if (this.escTimer) {
      clearTimeout(this.escTimer);
      this.escTimer = null;
    }
    process.stdin.off("data", this.handleData);
    process.stdout.off("resize", this.handleResize);
    process.off("SIGWINCH", this.handleResize);
    process.off("SIGINT", this.handleSignal);
    process.off("SIGTERM", this.handleSignal);
    process.off("SIGHUP", this.handleSignal);
    process.off("exit", this.handleSignal);
    try {
      this.write("\x1b[?1003l\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2026l\x1b[?25h\x1b[0m\x1b[?1049l");
    } catch {
      // Ignore write failures during teardown
    }
    try {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    } catch {
      // Ignore stdin teardown errors
    }
  }

  write(data: string): void {
    process.stdout.write(data);
  }

  setMouseMode(opts: { enabled: boolean; hover: boolean }): void {
    if (!this.entered) return;
    this.write(buildMouseModeEscapes(opts));
  }

  copyToClipboard(text: string): void {
    this.write(encodeOsc52Copy(text));
  }

  onInput(cb: (ev: InputEvent) => void): () => void {
    this.inputListeners.add(cb);
    return () => {
      this.inputListeners.delete(cb);
    };
  }

  onResize(cb: (w: number, h: number) => void): () => void {
    this.resizeListeners.add(cb);
    return () => {
      this.resizeListeners.delete(cb);
    };
  }
}
