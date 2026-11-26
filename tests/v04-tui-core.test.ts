import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli-main";
import { RoadmapService } from "../src/store";
import { TuiController } from "../src/tui/app";
import { buildMouseModeEscapes, encodeOsc52Copy, InputDecoder, type InputEvent, type TerminalSession } from "../src/tui/input";
import {
  detectColorMode,
  diffBuffers,
  sanitizeTerminalText,
  ScreenBuffer,
  segmentText,
  TUI_PALETTE,
  truncateText,
} from "../src/tui/screen";

class VirtualCoreSession implements TerminalSession {
  width: number;
  height: number;
  colorMode = "truecolor" as const;
  private readonly inputCbs = new Set<(ev: InputEvent) => void>();

  constructor(width = 120, height = 40) {
    this.width = width;
    this.height = height;
  }

  enter(): void {}
  leave(): void {}
  write(): void {}
  setMouseMode(): void {}
  copyToClipboard(): void {}

  onInput(cb: (ev: InputEvent) => void): () => void {
    this.inputCbs.add(cb);
    return () => this.inputCbs.delete(cb);
  }

  onResize(): () => void {
    return () => {};
  }

  typeText(controller: TuiController, text: string): void {
    for (const ch of text) {
      controller.handleEvent({ type: "key", key: ch, raw: ch });
    }
  }

  clickCard(controller: TuiController, featureId: string): void {
    const region = controller.getBuffer().getHitRegions().find((r) => r.id === `row-${featureId}`);
    if (!region) throw new Error(`card hit region for ${featureId} not found`);
    controller.handleEvent({ type: "mouse", action: "down", button: "left", x: region.x, y: region.y });
  }
}

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

  test("InputDecoder retains delayed CSI/SGR prefixes past the escape window and flushes only bare Escape", () => {
    // Split left-arrow across chunks with a flush in between: the retained prefix
    // completes into its one intended input instead of becoming ordinary keys.
    const csi = new InputDecoder();
    expect(csi.feed("\x1b[")).toEqual([]);
    expect(csi.hasPendingEscape()).toBe(true);
    expect(csi.flushPendingEscape()).toEqual([]);
    expect(csi.hasPendingEscape()).toBe(true);
    expect(csi.feed("D")).toEqual([
      { type: "key", key: "left", shift: false, alt: false, ctrl: false, raw: "\x1b[D" },
    ]);

    const sgr = new InputDecoder();
    expect(sgr.feed("\x1b[<0;12")).toEqual([]);
    expect(sgr.flushPendingEscape()).toEqual([]);
    expect(sgr.feed(";5M")).toEqual([
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

    // A lone ESC still resolves to an Escape key press after the window.
    const bare = new InputDecoder();
    expect(bare.feed("\x1b")).toEqual([]);
    expect(bare.hasPendingEscape()).toBe(true);
    expect(bare.flushPendingEscape()).toEqual([{ type: "key", key: "escape", raw: "\x1b" }]);
    expect(bare.hasPendingEscape()).toBe(false);

    // Printable supplementary characters decode as single key events.
    const text = new InputDecoder();
    expect(text.feed("🚀ok")).toEqual([
      { type: "key", key: "🚀", raw: "🚀" },
      { type: "key", key: "o", raw: "o" },
      { type: "key", key: "k", raw: "k" },
    ]);
  });

  test("InputDecoder frames legacy X10 mouse reports on raw bytes so large coordinates decode correctly", () => {
    const decoder = new InputDecoder();
    // Column 96 encodes as coordinate byte 0x81, which is not valid UTF-8 on its own.
    expect(
      decoder.feed(Buffer.from([0x1b, 0x5b, 0x4d, 0x20, 0x81, 0x25]))
    ).toEqual([
      {
        type: "mouse",
        action: "down",
        button: "left",
        x: 96,
        y: 4,
        shift: false,
        ctrl: false,
        alt: false,
      },
    ]);
    // The keystroke following the report decodes normally.
    expect(decoder.feed("a")).toEqual([{ type: "key", key: "a", raw: "a" }]);

    const split = new InputDecoder();
    expect(split.feed(Buffer.from([0x1b, 0x5b, 0x4d]))).toEqual([]);
    expect(split.feed(Buffer.from([0x20, 0x81, 0x25]))).toEqual([
      {
        type: "mouse",
        action: "down",
        button: "left",
        x: 96,
        y: 4,
        shift: false,
        ctrl: false,
        alt: false,
      },
    ]);
  });

  test("ScreenBuffer keeps wide and combining glyphs cell-aligned on full and differential redraws", () => {
    const buf = new ScreenBuffer(20, 3);
    expect(buf.writeText(2, 1, "a😀bc", 10)).toBe(5);
    expect(buf.toPlainLines()[1]).toBe("  a😀bc");
    expect(buf.getCell(3, 1)?.ch).toBe("😀");
    expect(buf.getCell(4, 1)?.ch).toBe(""); // invisible right half of the wide glyph
    expect(buf.getCell(5, 1)?.ch).toBe("b");

    // Combining marks attach to their base cell; neighbors stay on expected columns.
    const marks = new ScreenBuffer(20, 3);
    marks.writeText(2, 1, "ae\u0301b", 10);
    expect(marks.toPlainLines()[1]).toBe("  ae\u0301b");
    expect(marks.getCell(3, 1)?.ch).toBe("e\u0301");
    expect(marks.getCell(4, 1)?.ch).toBe("b");

    // Differential redraw: wide glyph -> ASCII rewrites both occupied cells.
    const before = new ScreenBuffer(10, 2);
    before.writeText(1, 1, "x😀y", 8);
    const after = new ScreenBuffer(10, 2);
    after.writeText(1, 1, "xabCy", 8);
    const delta = diffBuffers(before, after, "none");
    expect(delta).toContain("\x1b[2;3H");
    expect(delta).toContain("abCy");

    // ASCII -> wide glyph emits the pair once and shifts trailing text left.
    const back = diffBuffers(after, before, "none");
    expect(back).toContain("\x1b[2;3H");
    expect(back).toContain("😀y ");

    // Identical wide frames produce no cell updates at all.
    const same = new ScreenBuffer(10, 2);
    same.writeText(1, 1, "x😀y", 8);
    expect(diffBuffers(before, same, "none")).toBe("\x1b[?2026h\x1b[0m\x1b[?2026l");

    // Truncation counts cells, not code points; wide glyphs never split.
    expect(truncateText("a😀b", 3)).toBe("a…");
    expect(truncateText("a😀b", 4)).toBe("a😀b");
    expect(truncateText("😀", 1)).toBe("…");
    expect(truncateText("ae\u0301bc", 3)).toBe("ae\u0301…");
    expect(segmentText("e\u0301🚀")).toEqual(["e\u0301", "🚀"]);
  });

  test("row boundaries and adjacent overwrites never leave half glyphs or stale wide cells", () => {
    const buf = new ScreenBuffer(8, 2);

    // A wide glyph completing exactly at the last column occupies both final cells.
    buf.writeText(4, 0, "ab😀", 8);
    expect(buf.getCell(6, 0)?.ch).toBe("😀");
    expect(buf.getCell(7, 0)?.ch).toBe("");

    // A wide glyph straddling the last column is skipped in full, never split.
    expect(buf.writeText(0, 1, "x", 8)).toBe(1);
    buf.put(6, 1, "😀");
    expect(buf.getCell(6, 1)?.ch).toBe("😀");
    expect(buf.getCell(7, 1)?.ch).toBe("");
    buf.put(7, 1, "😀");
    expect(buf.getCell(7, 1)?.ch).toBe("");

    // Overwriting a wide base clears its stale continuation cell.
    buf.writeText(0, 1, "a😀b", 8);
    buf.put(1, 1, "y");
    expect(buf.getCell(1, 1)?.ch).toBe("y");
    expect(buf.getCell(2, 1)?.ch).toBe(" ");

    // Overwriting the continuation cell blanks the orphaned base.
    buf.writeText(0, 1, "a😀b", 8);
    buf.put(2, 1, "z");
    expect(buf.getCell(1, 1)?.ch).toBe(" ");
    expect(buf.getCell(2, 1)?.ch).toBe("z");

    // Negative x clipping counts terminal cells: a straddling wide glyph is
    // dropped whole and surviving neighbors keep their columns.
    const clip = new ScreenBuffer(6, 2);
    clip.writeText(-2, 1, "a😀b", 8);
    expect(clip.toPlainLines()[1]).toBe("b");
    const clipWide = new ScreenBuffer(6, 2);
    clipWide.writeText(-1, 1, "a😀b", 8);
    expect(clipWide.toPlainLines()[1]).toBe("😀b");

    // A leading isolated zero-width cluster occupies no cell: cursors agree.
    const zw = new ScreenBuffer(6, 2);
    expect(zw.writeText(1, 1, "\u0301ab", 8)).toBe(2);
    expect(zw.getCell(1, 1)?.ch).toBe("a");
    expect(zw.getCell(2, 1)?.ch).toBe("b");
  });

  test("supplementary characters round-trip through the live note and search editors", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-tui-core-emoji-"));
    const svc = new RoadmapService(dir);
    svc.init({ name: "Emoji TUI Project" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "planned", order: 10 });
    svc.addFeature({
      id: "emoji-core",
      title: "Emoji Core",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
      ship_criteria: ["Emoji input works"],
    });

    const session = new VirtualCoreSession(120, 40);
    const ctrl = new TuiController({ rootDir: dir, noBeads: true, session });
    ctrl.start();

    try {
      // Open the drawer and focus the note editor.
      session.clickCard(ctrl, "emoji-core");
      expect(ctrl.getState().drawerFeatureId).toBe("emoji-core");
      ctrl.handleEvent({ type: "key", key: "n", raw: "n" });
      expect(ctrl.getState().drawerFocus).toBe("note");

      // Type text containing a supplementary character (2 UTF-16 units per key event).
      session.typeText(ctrl, "🚀 ship");
      expect(ctrl.getState().noteDrafts["emoji-core"]).toBe("🚀 ship");
      expect(ctrl.getState().noteCursor).toBe(segmentText("🚀 ship").length);
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("🚀 ship");

      // The cursor highlight sits at the CELL offset after the emoji, not the
      // code-point offset: the glyph left of the caret stays untouched.
      const noteHit = ctrl.getBuffer().getHitRegions().find((r) => r.id === "drawer-note-input")!;
      expect(ctrl.getBuffer().getCell(noteHit.x + 7, noteHit.y)?.ch).toBe("p");
      const highlightCell = ctrl.getBuffer().getCell(noteHit.x + 8, noteHit.y);
      expect(highlightCell?.ch).toBe(" ");
      expect(highlightCell?.fg).toEqual(TUI_PALETTE.bg);
      expect(highlightCell?.bold).toBe(true);

      // Backspace removes one grapheme per press.
      ctrl.handleEvent({ type: "key", key: "backspace", raw: "\x7f" });
      expect(ctrl.getState().noteDrafts["emoji-core"]).toBe("🚀 shi");

      // Home + Delete removes the leading supplementary character itself.
      ctrl.handleEvent({ type: "key", key: "home", raw: "" });
      ctrl.handleEvent({ type: "key", key: "delete", raw: "" });
      expect(ctrl.getState().noteDrafts["emoji-core"]).toBe(" shi");

      // Search field accepts and deletes supplementary characters too.
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      ctrl.handleEvent({ type: "key", key: "escape", raw: "\x1b" });
      expect(ctrl.getState().drawerFeatureId).toBeNull();
      ctrl.handleEvent({ type: "key", key: "/", raw: "/" });
      expect(ctrl.getState().searchFocused).toBe(true);
      session.typeText(ctrl, "🚀");
      expect(ctrl.getState().search).toBe("🚀");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).not.toContain("Emoji Core");
      ctrl.handleEvent({ type: "key", key: "backspace", raw: "\x7f" });
      expect(ctrl.getState().search).toBe("");
      expect(ctrl.getBuffer().toPlainLines().join("\n")).toContain("Emoji Core");

      // Named keys and modified keys are never typed into the field.
      // (Ctrl+C is a global quit shortcut, so it is deliberately not asserted here.)
      session.typeText(ctrl, "ab");
      ctrl.handleEvent({ type: "key", key: "up", raw: "\x1b[A" });
      ctrl.handleEvent({ type: "key", key: "d", alt: true, raw: "\x1bd" });
      ctrl.handleEvent({ type: "key", key: "d", ctrl: true, raw: "\x04" });
      expect(ctrl.getState().search).toBe("ab");
    } finally {
      ctrl.stop();
      rmSync(dir, { recursive: true, force: true });
    }
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
