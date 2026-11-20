import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { RoadmapService } from "../src/store";
import { buildMouseModeEscapes, encodeOsc52Copy, InputDecoder } from "../src/tui/input";
import {
  detectColorMode,
  diffBuffers,
  sanitizeTerminalText,
  ScreenBuffer,
  TUI_PALETTE,
} from "../src/tui/screen";

describe("v0.4 TUI Core Engine & CLI", () => {
  test("detectColorMode honors NO_COLOR, dumb TERM, truecolor, 256, and 16-color fallbacks", () => {
    expect(detectColorMode({ NO_COLOR: "1", COLORTERM: "truecolor" })).toBe("none");
    expect(detectColorMode({ NO_COLOR: "", COLORTERM: "truecolor" })).toBe("truecolor");
    expect(detectColorMode({ TERM: "dumb" })).toBe("none");
    expect(detectColorMode({ TERM: "xterm-256color" })).toBe("256");
    expect(detectColorMode({ TERM: "xterm" })).toBe("16");
  });

  test("sanitizeTerminalText neutralizes ANSI CSI/OSC escape injections and control bytes", () => {
    const evil = "Bad \x1b[31mRed\x1b[0m and\x1b]52;c;AAAA\x07\n\tTitle\x00!";
    expect(sanitizeTerminalText(evil)).toBe("Bad Red and Title!");
  });

  test("ScreenBuffer clips text, preserves card backgrounds, draws boxes, and resolves z-indexed hit regions", () => {
    const buf = new ScreenBuffer(40, 12);
    buf.clear({ bg: TUI_PALETTE.bg, fg: TUI_PALETTE.text });
    buf.drawBox(2, 1, 20, 5, {
      borderStyle: { fg: TUI_PALETTE.border },
      fillStyle: { bg: TUI_PALETTE.surface2 },
      title: "Feature Title That Is Very Long",
      titleStyle: { fg: TUI_PALETTE.accent, bold: true },
    });
    buf.writeText(4, 3, "Line clipped here", 10, { fg: TUI_PALETTE.text });

    const lines = buf.toPlainLines();
    expect(lines[1]).toContain("╭─ Feature Title… ─╮");
    expect(lines[3]).toContain("Line clip…");
    expect(buf.getCell(4, 3)?.bg).toEqual(TUI_PALETTE.surface2);

    buf.addHitRegion({ id: "back", kind: "card", x: 0, y: 0, w: 20, h: 10, zIndex: 1 });
    buf.addHitRegion({ id: "modal", kind: "btn", x: 5, y: 2, w: 10, h: 4, zIndex: 50 });
    buf.addHitRegion({ id: "later", kind: "card", x: 0, y: 0, w: 20, h: 10, zIndex: 1 });

    expect(buf.hitTest(8, 4)?.id).toBe("modal");
    expect(buf.hitTest(2, 2)?.id).toBe("later");
    expect(buf.hitTest(35, 11)).toBeNull();
  });

  test("diffBuffers wraps synchronized output and skips unchanged cells on incremental updates", () => {
    const a = new ScreenBuffer(20, 4);
    a.clear({ bg: TUI_PALETTE.bg, fg: TUI_PALETTE.text });
    a.writeText(1, 1, "Alpha", 10, { fg: TUI_PALETTE.text });

    const b = new ScreenBuffer(20, 4);
    b.clear({ bg: TUI_PALETTE.bg, fg: TUI_PALETTE.text });
    b.writeText(1, 1, "Alpha!", 10, { fg: TUI_PALETTE.text });

    const first = diffBuffers(null, a, "truecolor");
    expect(first.startsWith("\x1b[?2026h\x1b[0m\x1b[2J")).toBe(true);
    expect(first.endsWith("\x1b[0m\x1b[?2026l")).toBe(true);

    const delta = diffBuffers(a, b, "truecolor");
    expect(delta).not.toContain("\x1b[2J");
    expect(delta).toContain("\x1b[2;7H");
    expect(delta).toContain("!");

    const noColorDelta = diffBuffers(a, b, "none");
    expect(noColorDelta).not.toContain("38;2;");
    expect(noColorDelta).not.toContain("48;2;");
  });

  test("InputDecoder parses split escape chunks, special keys, and SGR mouse click/drag/move/wheel", () => {
    const decoder = new InputDecoder();

    // Split SGR mouse sequence across two chunks
    expect(decoder.feed("\x1b[<0")).toEqual([]);
    expect(decoder.hasPendingEscape()).toBe(true);
    expect(decoder.feed(";12;5M")).toEqual([
      {
        type: "mouse",
        action: "down",
        button: "left",
        x: 11,
        y: 4,
        shift: false,
        ctrl: false,
        alt: false,
      },
    ]);

    expect(decoder.feed("\x1b[<32;15;6M\x1b[<0;15;6m\x1b[<35;8;3M\x1b[<64;4;4M\x1b[<65;4;4M")).toEqual([
      { type: "mouse", action: "drag", button: "left", x: 14, y: 5, shift: false, ctrl: false, alt: false },
      { type: "mouse", action: "up", button: "left", x: 14, y: 5, shift: false, ctrl: false, alt: false },
      { type: "mouse", action: "move", button: "none", x: 7, y: 2, shift: false, ctrl: false, alt: false },
      { type: "mouse", action: "wheel-up", button: "none", x: 3, y: 3, shift: false, ctrl: false, alt: false },
      { type: "mouse", action: "wheel-down", button: "none", x: 3, y: 3, shift: false, ctrl: false, alt: false },
    ]);

    expect(decoder.feed("\x1b[A\x1b[Z\r\t\x7f\x03abc")).toEqual([
      { type: "key", key: "up", shift: false, alt: false, ctrl: false, raw: "\x1b[A" },
      { type: "key", key: "tab", shift: true, alt: false, ctrl: false, raw: "\x1b[Z" },
      { type: "key", key: "enter", raw: "\r" },
      { type: "key", key: "tab", raw: "\t" },
      { type: "key", key: "backspace", raw: "\x7f" },
      { type: "key", key: "c", ctrl: true, raw: "\x03" },
      { type: "key", key: "a", raw: "a" },
      { type: "key", key: "b", raw: "b" },
      { type: "key", key: "c", raw: "c" },
    ]);

    // Esc flushed when bare
    expect(decoder.feed("\x1b")).toEqual([]);
    expect(decoder.flushPendingEscape()).toEqual([{ type: "key", key: "escape", raw: "\x1b" }]);

    // Legacy X10 mouse fallback (\x1b[M<cb><cx><cy>) across split chunks
    expect(decoder.feed("\x1b[M")).toEqual([]);
    expect(decoder.feed("\x20\x25\x23")).toEqual([
      {
        type: "mouse",
        action: "down",
        button: "left",
        x: 4,
        y: 2,
        shift: false,
        ctrl: false,
        alt: false,
      },
    ]);
  });

  test("buildMouseModeEscapes orders mode resets before enables for Ghostty/xterm compatibility", () => {
    const baseOnly = buildMouseModeEscapes({ enabled: true, hover: false });
    expect(baseOnly).toBe("\x1b[?1003l\x1b[?1000h\x1b[?1002h\x1b[?1006h");

    const withHover = buildMouseModeEscapes({ enabled: true, hover: true });
    expect(withHover).toBe("\x1b[?1000l\x1b[?1002l\x1b[?1003h\x1b[?1006h");

    const disabled = buildMouseModeEscapes({ enabled: false, hover: false });
    expect(disabled).toBe("\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l");
  });

  test("encodeOsc52Copy sanitizes escapes and produces valid OSC 52 sequence", () => {
    const seq = encodeOsc52Copy("feat\x1b[31m-id");
    expect(seq).toBe(`\x1b]52;c;${Buffer.from("feat-id", "utf8").toString("base64")}\x07`);
  });

  test("pp view --tui rejects non-TTY sessions and incompatible HTTP/JSON flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-tui-cli-"));
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
    try {
      const svc = new RoadmapService(dir);
      svc.init({ name: "CLI TUI Test" });

      expect(await runCli(["view", "--tui", "--no-beads"], { cwd: dir, isTty: false })).toBe(1);
      expect(errors.at(-1)).toContain("interactive TTY");

      expect(await runCli(["view", "--tui", "--port", "4311"], { cwd: dir, isTty: true })).toBe(1);
      expect(errors.at(-1)).toContain("--port");

      expect(await runCli(["view", "--tui", "--standalone"], { cwd: dir, isTty: true })).toBe(1);
      expect(errors.at(-1)).toContain("--standalone");

      expect(await runCli(["view", "--tui", "--no-open"], { cwd: dir, isTty: true })).toBe(1);
      expect(errors.at(-1)).toContain("--no-open");

      expect(await runCli(["view", "--no-beads"], { cwd: dir, isTty: true })).toBe(1);
      expect(errors.at(-1)).toContain("--tui");
    } finally {
      console.error = origErr;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
