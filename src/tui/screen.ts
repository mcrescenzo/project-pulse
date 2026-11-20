export type ColorMode = "truecolor" | "256" | "16" | "none";

export interface PaletteColor {
  rgb: readonly [number, number, number];
  x256: number;
  ansi16: number;
}

export const TUI_PALETTE = {
  bg: { rgb: [11, 15, 23], x256: 233, ansi16: 0 },
  surface: { rgb: [18, 24, 38], x256: 235, ansi16: 0 },
  surface2: { rgb: [25, 34, 52], x256: 236, ansi16: 8 },
  border: { rgb: [46, 61, 89], x256: 239, ansi16: 8 },
  text: { rgb: [230, 237, 247], x256: 254, ansi16: 7 },
  muted: { rgb: [147, 164, 189], x256: 247, ansi16: 7 },
  accent: { rgb: [96, 165, 250], x256: 75, ansi16: 12 },
  accentSoft: { rgb: [27, 45, 74], x256: 17, ansi16: 4 },
  green: { rgb: [52, 211, 153], x256: 79, ansi16: 10 },
  greenSoft: { rgb: [17, 53, 43], x256: 22, ansi16: 2 },
  amber: { rgb: [251, 191, 36], x256: 220, ansi16: 11 },
  amberSoft: { rgb: [58, 42, 18], x256: 58, ansi16: 3 },
  red: { rgb: [248, 113, 113], x256: 203, ansi16: 9 },
  redSoft: { rgb: [60, 24, 29], x256: 52, ansi16: 1 },
  slate: { rgb: [148, 163, 184], x256: 246, ansi16: 7 },
  slateSoft: { rgb: [30, 41, 59], x256: 236, ansi16: 8 },
  white: { rgb: [255, 255, 255], x256: 231, ansi16: 15 },
} as const satisfies Record<string, PaletteColor>;

export interface CellStyle {
  fg?: PaletteColor;
  bg?: PaletteColor;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface HitRegion {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  data?: unknown;
}

interface Cell {
  ch: string;
  fg?: PaletteColor;
  bg?: PaletteColor;
  bold: boolean;
  dim: boolean;
  underline: boolean;
  inverse: boolean;
}

/**
 * Detects terminal color capabilities from environment variables while honoring NO_COLOR.
 */
export function detectColorMode(env: Record<string, string | undefined> = process.env): ColorMode {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    return "none";
  }
  const term = (env.TERM ?? "").toLowerCase();
  if (term === "dumb") {
    return "none";
  }
  const colorTerm = (env.COLORTERM ?? "").toLowerCase();
  if (colorTerm.includes("truecolor") || colorTerm.includes("24bit")) {
    return "truecolor";
  }
  if (term.includes("256color") || term.includes("kitty") || term.includes("ghostty")) {
    return "256";
  }
  return "16";
}

/**
 * Strips ANSI/OSC escape sequences and C0/C1 control characters from untrusted text.
 */
export function sanitizeTerminalText(text: string): string {
  return String(text ?? "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
    .replace(/\x1b[@-Z\\-_]?/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

/**
 * Truncates sanitized text cleanly to fit within `maxWidth` cells.
 */
export function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const glyphs = Array.from(sanitizeTerminalText(text));
  if (glyphs.length <= maxWidth) {
    return glyphs.join("");
  }
  if (maxWidth === 1) {
    return "…";
  }
  return glyphs.slice(0, maxWidth - 1).join("") + "…";
}

function makeCell(ch: string, style?: CellStyle): Cell {
  return {
    ch,
    fg: style?.fg,
    bg: style?.bg,
    bold: Boolean(style?.bold),
    dim: Boolean(style?.dim),
    underline: Boolean(style?.underline),
    inverse: Boolean(style?.inverse),
  };
}

function sameColor(a?: PaletteColor, b?: PaletteColor): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x256 === b.x256 && a.ansi16 === b.ansi16 && a.rgb[0] === b.rgb[0] && a.rgb[1] === b.rgb[1] && a.rgb[2] === b.rgb[2];
}

function sameStyle(a: Cell, b: Cell): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    sameColor(a.fg, b.fg) &&
    sameColor(a.bg, b.bg)
  );
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.ch === b.ch && sameStyle(a, b);
}

function sgrColorCode(color: PaletteColor, isBg: boolean, mode: ColorMode): string | null {
  if (mode === "none") return null;
  if (mode === "truecolor") {
    const [r, g, b] = color.rgb;
    return `${isBg ? 48 : 38};2;${r};${g};${b}`;
  }
  if (mode === "256") {
    return `${isBg ? 48 : 38};5;${color.x256}`;
  }
  const idx = color.ansi16;
  if (idx < 8) {
    return String((isBg ? 40 : 30) + idx);
  }
  return String((isBg ? 100 : 90) + (idx - 8));
}

function cellToSgr(cell: Cell, mode: ColorMode): string {
  const parts = ["0"];
  if (cell.bold) parts.push("1");
  if (cell.dim) parts.push("2");
  if (cell.underline) parts.push("4");
  if (cell.inverse) parts.push("7");
  if (cell.fg) {
    const fgCode = sgrColorCode(cell.fg, false, mode);
    if (fgCode) parts.push(fgCode);
  }
  if (cell.bg) {
    const bgCode = sgrColorCode(cell.bg, true, mode);
    if (bgCode) parts.push(bgCode);
  }
  return `\x1b[${parts.join(";")}m`;
}

export class ScreenBuffer {
  readonly width: number;
  readonly height: number;
  private readonly cells: Cell[];
  private hitRegions: HitRegion[] = [];

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.cells = new Array<Cell>(this.width * this.height);
    this.clear();
  }

  clear(style?: CellStyle): void {
    this.hitRegions = [];
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = makeCell(" ", style);
    }
  }

  getCell(x: number, y: number): Cell | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.cells[y * this.width + x]!;
  }

  put(x: number, y: number, ch: string, style?: CellStyle): void {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
    const clean = sanitizeTerminalText(ch);
    const glyph = Array.from(clean)[0] ?? " ";
    const idx = yi * this.width + xi;
    const existing = this.cells[idx];
    this.cells[idx] = {
      ch: glyph,
      fg: style?.fg,
      bg: style?.bg !== undefined ? style.bg : existing?.bg,
      bold: Boolean(style?.bold),
      dim: Boolean(style?.dim),
      underline: Boolean(style?.underline),
      inverse: Boolean(style?.inverse),
    };
  }

  writeText(x: number, y: number, text: string, maxWidth: number, style?: CellStyle): number {
    const yi = Math.floor(y);
    const xi = Math.floor(x);
    if (yi < 0 || yi >= this.height || maxWidth <= 0) return 0;
    const available = Math.min(maxWidth, this.width - Math.max(0, xi));
    if (available <= 0) return 0;

    const fullText = xi < 0 ? Array.from(sanitizeTerminalText(text)).slice(-xi).join("") : text;
    const startX = Math.max(0, xi);
    const clipped = truncateText(fullText, startX < this.width ? Math.min(maxWidth, this.width - startX) : 0);
    const glyphs = Array.from(clipped);
    for (let i = 0; i < glyphs.length; i++) {
      this.put(startX + i, yi, glyphs[i]!, style);
    }
    return glyphs.length;
  }

  fillRect(x: number, y: number, w: number, h: number, style?: CellStyle, ch = " "): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let row = y0; row < y1; row++) {
      for (let col = x0; col < x1; col++) {
        this.put(col, row, ch, style);
      }
    }
  }

  drawBox(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: {
      borderStyle?: CellStyle;
      fillStyle?: CellStyle;
      title?: string;
      titleStyle?: CellStyle;
      rounded?: boolean;
    } = {}
  ): void {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const wi = Math.floor(w);
    const hi = Math.floor(h);
    if (wi < 2 || hi < 2) return;

    if (opts.fillStyle) {
      this.fillRect(xi, yi, wi, hi, opts.fillStyle);
    }

    const tl = opts.rounded === false ? "┌" : "╭";
    const tr = opts.rounded === false ? "┐" : "╮";
    const bl = opts.rounded === false ? "└" : "╰";
    const br = opts.rounded === false ? "┘" : "╯";
    const bStyle = opts.borderStyle ?? opts.fillStyle;

    this.put(xi, yi, tl, bStyle);
    this.put(xi + wi - 1, yi, tr, bStyle);
    this.put(xi, yi + hi - 1, bl, bStyle);
    this.put(xi + wi - 1, yi + hi - 1, br, bStyle);

    for (let col = xi + 1; col < xi + wi - 1; col++) {
      this.put(col, yi, "─", bStyle);
      this.put(col, yi + hi - 1, "─", bStyle);
    }
    for (let row = yi + 1; row < yi + hi - 1; row++) {
      this.put(xi, row, "│", bStyle);
      this.put(xi + wi - 1, row, "│", bStyle);
    }

    if (opts.title && wi > 6) {
      const titleText = ` ${truncateText(opts.title, wi - 6)} `;
      this.writeText(xi + 2, yi, titleText, wi - 4, opts.titleStyle ?? bStyle);
    }
  }

  addHitRegion(region: HitRegion): void {
    if (region.w <= 0 || region.h <= 0) return;
    this.hitRegions.push(region);
  }

  getHitRegions(): readonly HitRegion[] {
    return this.hitRegions;
  }

  hitTest(x: number, y: number): HitRegion | null {
    let best: HitRegion | null = null;
    for (const r of this.hitRegions) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        if (!best || r.zIndex >= best.zIndex) {
          best = r;
        }
      }
    }
    return best;
  }

  toPlainLines(): string[] {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let row = "";
      for (let x = 0; x < this.width; x++) {
        row += this.cells[y * this.width + x]!.ch;
      }
      lines.push(row.replace(/\s+$/u, ""));
    }
    return lines;
  }
}

/**
 * Generates minimal ANSI diffs between frames wrapped in synchronized output escape markers.
 */
export function diffBuffers(prev: ScreenBuffer | null, next: ScreenBuffer, colorMode: ColorMode): string {
  const fullRedraw = !prev || prev.width !== next.width || prev.height !== next.height;
  const out: string[] = ["\x1b[?2026h"];
  if (fullRedraw) {
    out.push("\x1b[0m\x1b[2J");
  }

  let curX = -1;
  let curY = -1;
  let activeStyle: Cell | null = null;

  for (let y = 0; y < next.height; y++) {
    for (let x = 0; x < next.width; x++) {
      const nextCell = next.getCell(x, y)!;
      if (!fullRedraw) {
        const prevCell = prev.getCell(x, y)!;
        if (sameCell(prevCell, nextCell)) continue;
      }

      if (curY !== y || curX !== x) {
        out.push(`\x1b[${y + 1};${x + 1}H`);
      }

      if (!activeStyle || !sameStyle(activeStyle, nextCell)) {
        out.push(cellToSgr(nextCell, colorMode));
        activeStyle = nextCell;
      }

      out.push(nextCell.ch);
      curX = x + 1;
      curY = y;
    }
  }

  out.push("\x1b[0m\x1b[?2026l");
  return out.join("");
}
