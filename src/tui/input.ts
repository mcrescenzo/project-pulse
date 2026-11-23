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

const X10_MOUSE_PREFIX = "\x1b[M";

function decodeX10Mouse(cbByte: number, cxByte: number, cyByte: number): MouseEvent {
  const cb = Math.max(0, cbByte - 32);
  const shift = (cb & 4) !== 0;
  const alt = (cb & 8) !== 0;
  const ctrl = (cb & 16) !== 0;
  const isMotion = (cb & 32) !== 0;
  const isWheel = (cb & 64) !== 0;
  const btnBits = cb & 3;
  const x = Math.max(0, cxByte - 33);
  const y = Math.max(0, cyByte - 33);

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

  const button: MouseButton =
    btnBits === 0 ? "left" : btnBits === 1 ? "middle" : btnBits === 2 ? "right" : "none";
  const action: MouseAction = isMotion
    ? button === "none"
      ? "move"
      : "drag"
    : btnBits === 3
    ? "up"
    : "down";
  return { type: "mouse", action, button, x, y, shift, ctrl, alt };
}

function isIncompleteEscPrefix(buf: string): boolean {
  if (buf === "\x1b" || buf === "\x1b[" || buf === "\x1bO" || buf === "\x1b[<") {
    return true;
  }
  if (buf.startsWith(X10_MOUSE_PREFIX)) {
    return buf.length < 6;
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
 * Byte length of the UTF-8 code point starting at `bytes[i]` (stray continuation bytes count as 1).
 */
function utf8CodePointLength(bytes: Uint8Array, i: number): number {
  const b = bytes[i]!;
  if (b < 0x80) return 1;
  if (b >= 0xf0) return 4;
  if (b >= 0xe0) return 3;
  if (b >= 0xc0) return 2;
  return 1;
}

function emitPlainText(text: string, events: InputEvent[]): void {
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (ch === "\r" || ch === "\n") {
      events.push({ type: "key", key: "enter", raw: ch });
    } else if (ch === "\t") {
      events.push({ type: "key", key: "tab", raw: ch });
    } else if (ch === "\x7f" || ch === "\b") {
      events.push({ type: "key", key: "backspace", raw: ch });
    } else if (cp >= 1 && cp <= 26) {
      events.push({ type: "key", key: String.fromCharCode(96 + cp), ctrl: true, raw: ch });
    } else if (cp >= 32) {
      events.push({ type: "key", key: ch, raw: ch });
    }
  }
}

/**
 * Stateful keyboard + SGR mouse parser resilient to split TCP/SSH chunks.
 *
 * Escape sequences are framed on raw bytes before UTF-8 decoding so legacy X10 mouse
 * coordinate bytes (>= 0x80) are never mangled by text decoding.
 */
export class InputDecoder {
  private readonly utf8 = new StringDecoder("utf8");
  private pending = Buffer.alloc(0);

  hasPendingEscape(): boolean {
    if (this.pending.length === 0 || this.pending[0] !== 0x1b) return false;
    if (this.pending.length === 1) return true;
    return isIncompleteEscPrefix(this.pending.toString("latin1"));
  }

  flushPendingEscape(): InputEvent[] {
    // Only a lone ESC resolves to an Escape key press. Recognized incomplete CSI/SS3/SGR/X10
    // prefixes stay buffered so a delayed suffix still completes into its one intended input.
    if (this.pending.length === 1 && this.pending[0] === 0x1b) {
      this.pending = Buffer.alloc(0);
      return [{ type: "key", key: "escape", raw: "\x1b" }];
    }
    return [];
  }

  feed(chunk: string | Buffer): InputEvent[] {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.pending =
      this.pending.length === 0 ? Buffer.from(bytes) : Buffer.concat([this.pending, bytes]);
    const events: InputEvent[] = [];
    let pos = 0;

    while (pos < this.pending.length) {
      if (this.pending[pos] !== 0x1b) {
        // Plain text run: decode bytes up to the next ESC via the stateful UTF-8 decoder
        // (safe to split mid-run: ESC bytes never occur inside multi-byte UTF-8 sequences).
        let end = pos + 1;
        while (end < this.pending.length && this.pending[end] !== 0x1b) end++;
        emitPlainText(this.utf8.write(this.pending.subarray(pos, end)), events);
        pos = end;
        continue;
      }

      const rest = this.pending.subarray(pos);
      if (rest.length >= 2 && rest[1] === 0x1b) {
        events.push({ type: "key", key: "escape", raw: "\x1b" });
        pos += 1;
        continue;
      }

      const latin = rest.toString("latin1");

      const mouseMatch = SGR_MOUSE_RE.exec(latin);
      if (mouseMatch) {
        events.push(
          decodeSgrMouse(
            Number(mouseMatch[1]),
            Number(mouseMatch[2]),
            Number(mouseMatch[3]),
            mouseMatch[4]!
          )
        );
        pos += mouseMatch[0].length;
        continue;
      }

      if (latin.startsWith(X10_MOUSE_PREFIX)) {
        if (rest.length < 6) {
          break;
        }
        events.push(decodeX10Mouse(rest[3]!, rest[4]!, rest[5]!));
        pos += 6;
        continue;
      }

      const csiMatch = CSI_SEQ_RE.exec(latin);
      if (csiMatch) {
        const ev = decodeCsiKey(csiMatch[1] ?? "", csiMatch[2]!, csiMatch[0]);
        if (ev) events.push(ev);
        pos += csiMatch[0].length;
        continue;
      }

      const ss3Match = SS3_SEQ_RE.exec(latin);
      if (ss3Match) {
        const mapped = CSI_KEY_MAP[ss3Match[1]!];
        if (mapped) events.push({ type: "key", key: mapped, raw: ss3Match[0] });
        pos += ss3Match[0].length;
        continue;
      }

      if (isIncompleteEscPrefix(latin)) {
        break;
      }

      if (rest.length >= 2 && rest[1]! >= 0x20 && rest[1]! !== 0x7f) {
        // Alt+char: decode exactly one code point's worth of bytes.
        const len = Math.min(utf8CodePointLength(rest, 1), rest.length - 1);
        events.push({
          type: "key",
          key: rest.subarray(1, 1 + len).toString("utf8"),
          alt: true,
          raw: latin.slice(0, 1 + len),
        });
        pos += 1 + len;
        continue;
      }

      pos += 1;
      events.push({ type: "key", key: "escape", raw: "\x1b" });
    }

    if (pos >= this.pending.length) {
      this.pending = Buffer.alloc(0);
    } else {
      this.pending = Buffer.from(this.pending.subarray(pos));
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
  /**
   * Registers a callback fired after the session restored the terminal on SIGINT/SIGTERM/SIGHUP
   * so the owner can finish teardown (cancel pending work, resolve its run promise). Optional:
   * test doubles may omit it.
   */
  onSignal?(cb: () => void): () => void;
}

export function buildMouseModeEscapes(opts: { enabled: boolean; hover: boolean }): string {
  if (!opts.enabled) {
    return "\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l";
  }
  if (opts.hover) {
    return "\x1b[?1000l\x1b[?1002l\x1b[?1003h\x1b[?1006h";
  }
  return "\x1b[?1003l\x1b[?1000h\x1b[?1002h\x1b[?1006h";
}

export class NodeTerminalSession implements TerminalSession {
  readonly colorMode: ColorMode;
  private readonly decoder = new InputDecoder();
  private readonly inputListeners = new Set<(ev: InputEvent) => void>();
  private readonly resizeListeners = new Set<(w: number, h: number) => void>();
  private readonly signalListeners = new Set<() => void>();
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
    // Restore the terminal FIRST, then notify so teardown (cancelling pending reloads,
    // resolving the run promise) completes before any late frame could be written.
    this.leave();
    for (const cb of Array.from(this.signalListeners)) cb();
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

  onSignal(cb: () => void): () => void {
    this.signalListeners.add(cb);
    return () => {
      this.signalListeners.delete(cb);
    };
  }
}
