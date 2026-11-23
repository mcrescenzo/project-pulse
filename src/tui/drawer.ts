import type { Feature, FeatureStatus } from "../types";
import { ScreenBuffer, TUI_PALETTE, sanitizeTerminalText, truncateText, type CellStyle } from "./screen";
import { HitLayer, drawPill, getStatusStyle, type Rect, type TuiState } from "./views";

export interface DrawerRectInfo extends Rect {
  mode: "split" | "modal";
}

/**
 * Computes responsive right split-pane (>= 120 cols) or centered modal (< 120 cols) drawer bounds.
 */
export function getDrawerRect(totalW: number, totalH: number, topY: number): DrawerRectInfo {
  if (totalW >= 120) {
    const w = Math.min(64, Math.max(48, Math.floor(totalW * 0.42)));
    return {
      mode: "split",
      x: totalW - w,
      y: topY,
      w,
      h: Math.max(8, totalH - topY - 1),
    };
  }
  const w = Math.max(36, Math.min(totalW - 4, 72));
  const h = Math.max(14, totalH - 4);
  return {
    mode: "modal",
    x: Math.max(1, Math.floor((totalW - w) / 2)),
    y: Math.max(1, Math.floor((totalH - h) / 2)),
    w,
    h,
  };
}

function wrapText(text: string, width: number): string[] {
  const clean = sanitizeTerminalText(text).trim();
  if (!clean) return [];
  const safeW = Math.max(8, width);
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const wLen = Array.from(w).length;
    if (!line) {
      if (wLen <= safeW) {
        line = w;
      } else {
        const glyphs = Array.from(w);
        for (let i = 0; i < glyphs.length; i += safeW) {
          lines.push(glyphs.slice(i, i + safeW).join(""));
        }
      }
    } else if (Array.from(line).length + 1 + wLen <= safeW) {
      line += " " + w;
    } else {
      lines.push(line);
      if (wLen <= safeW) {
        line = w;
      } else {
        const glyphs = Array.from(w);
        for (let i = 0; i < glyphs.length; i += safeW) {
          lines.push(glyphs.slice(i, i + safeW).join(""));
        }
        line = "";
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

class DrawerClipWriter {
  constructor(
    private readonly buf: ScreenBuffer,
    private readonly clip: Rect,
    private readonly scrollY: number,
    private readonly zIndex: number
  ) {}

  toScreenY(vy: number): number {
    return this.clip.y + vy - this.scrollY;
  }

  isVisible(sy: number): boolean {
    return sy >= this.clip.y && sy < this.clip.y + this.clip.h;
  }

  write(vx: number, vy: number, text: string, maxW: number, style?: CellStyle): void {
    const sy = this.toScreenY(vy);
    if (!this.isVisible(sy)) return;
    const x0 = Math.max(this.clip.x, vx);
    const avail = Math.min(maxW, this.clip.x + this.clip.w - x0);
    if (avail > 0) this.buf.writeText(x0, sy, text, avail, style);
  }

  fill(vx: number, vy: number, w: number, h: number, style: CellStyle): void {
    for (let dy = 0; dy < h; dy++) {
      const sy = this.toScreenY(vy + dy);
      if (!this.isVisible(sy)) continue;
      const x0 = Math.max(this.clip.x, vx);
      const x1 = Math.min(this.clip.x + this.clip.w, vx + w);
      if (x1 > x0) this.buf.fillRect(x0, sy, x1 - x0, 1, style);
    }
  }

  pill(
    vx: number,
    vy: number,
    label: string,
    style: CellStyle,
    hit?: { id: string; kind: string; data?: unknown }
  ): number {
    const clean = ` ${label} `;
    const len = Array.from(clean).length;
    const sy = this.toScreenY(vy);
    if (this.isVisible(sy) && vx >= this.clip.x && vx + len <= this.clip.x + this.clip.w) {
      this.buf.fillRect(vx, sy, len, 1, style);
      this.buf.writeText(vx, sy, clean, len, style);
      if (hit) {
        this.buf.addHitRegion({
          id: hit.id,
          kind: hit.kind,
          x: vx,
          y: sy,
          w: len,
          h: 1,
          zIndex: this.zIndex,
          data: hit.data,
        });
      }
    }
    return len;
  }

  hit(vx: number, vy: number, w: number, h: number, id: string, kind: string, data?: unknown): void {
    const sy0 = Math.max(this.clip.y, this.toScreenY(vy));
    const sy1 = Math.min(this.clip.y + this.clip.h, this.toScreenY(vy + h));
    const sx0 = Math.max(this.clip.x, vx);
    const sx1 = Math.min(this.clip.x + this.clip.w, vx + w);
    if (sx1 > sx0 && sy1 > sy0) {
      this.buf.addHitRegion({
        id,
        kind,
        x: sx0,
        y: sy0,
        w: sx1 - sx0,
        h: sy1 - sy0,
        zIndex: this.zIndex,
        data,
      });
    }
  }
}

/**
 * Renders the interactive Feature Detail Drawer (split-pane or modal) with criteria/status/note controls.
 */
export function renderFeatureDrawer(
  buf: ScreenBuffer,
  totalW: number,
  totalH: number,
  topY: number,
  state: TuiState
): { maxScrollY: number; rect: DrawerRectInfo } | null {
  if (!state.drawerFeatureId) return null;
  const feature: Feature | undefined = state.payload.features.find(
    (f) => f.id === state.drawerFeatureId
  );
  if (!feature) return null;

  const rect = getDrawerRect(totalW, totalH, topY);

  if (rect.mode === "modal") {
    buf.addHitRegion({
      id: "drawer-backdrop",
      kind: "drawer-backdrop",
      x: 0,
      y: 0,
      w: totalW,
      h: totalH,
      zIndex: HitLayer.drawerBackdrop,
    });
  }

  buf.drawBox(rect.x, rect.y, rect.w, rect.h, {
    borderStyle: { fg: TUI_PALETTE.accent },
    fillStyle: { bg: TUI_PALETTE.surface },
    title: "Feature Details",
    titleStyle: { fg: TUI_PALETTE.accent, bold: true },
  });
  buf.addHitRegion({
    id: "drawer-panel",
    kind: "drawer-panel",
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    zIndex: HitLayer.drawerPanel,
  });

  // Pinned Header rows inside drawer
  const innerX = rect.x + 2;
  const innerW = Math.max(16, rect.w - 4);
  const copyBtnW = 8;
  const closeBtnW = 7;
  const titleMax = Math.max(8, innerW - copyBtnW - closeBtnW - 2);
  buf.writeText(innerX, rect.y + 1, feature.title, titleMax, {
    fg: TUI_PALETTE.text,
    bold: true,
  });
  drawPill(
    buf,
    rect.x + rect.w - 2 - closeBtnW - copyBtnW - 1,
    rect.y + 1,
    "y Copy",
    { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft },
    { id: "drawer-copy", kind: "copy-id", zIndex: HitLayer.drawerControl, data: feature.id }
  );
  drawPill(
    buf,
    rect.x + rect.w - 2 - closeBtnW,
    rect.y + 1,
    "Close",
    { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 },
    { id: "drawer-close", kind: "drawer-close", zIndex: HitLayer.drawerControl }
  );

  const metaTag = [feature.id, feature.milestone, feature.area].filter(Boolean).join(" · ");
  buf.writeText(innerX, rect.y + 2, metaTag, innerW, { fg: TUI_PALETTE.muted });
  for (let i = rect.x + 1; i < rect.x + rect.w - 1; i++) {
    buf.put(i, rect.y + 3, "─", { fg: TUI_PALETTE.border });
  }

  const bodyRect: Rect = {
    x: rect.x + 1,
    y: rect.y + 4,
    w: rect.w - 2,
    h: Math.max(4, rect.h - 5),
  };

  const ops: Array<(w: DrawerClipWriter) => void> = [];
  let vy = 0;

  if (state.drawerFeedback) {
    const fb = state.drawerFeedback;
    const fbY = vy;
    const style =
      fb.kind === "err"
        ? { fg: TUI_PALETTE.red, bg: TUI_PALETTE.redSoft }
        : fb.kind === "ok"
        ? { fg: TUI_PALETTE.green, bg: TUI_PALETTE.greenSoft }
        : { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft };
    ops.push((cw) => {
      cw.fill(innerX, fbY, innerW, 1, style);
      cw.write(innerX + 1, fbY, fb.message, innerW - 2, { ...style, bold: true });
    });
    vy += 2;
  }

  // Status selector row(s)
  const statuses: FeatureStatus[] = ["planned", "in-progress", "shipped", "paused", "cut"];
  ops.push((cw) => {
    cw.write(innerX, 0, "", 0);
  });
  const statusStart = vy;
  ops.push((cw) => {
    cw.write(innerX, statusStart, "STATUS", innerW, { fg: TUI_PALETTE.muted, bold: true });
  });
  vy += 1;

  let sx = innerX;
  let sy = vy;
  for (const s of statuses) {
    const pillLen = s.length + 4; // " ● status "
    if (sx + pillLen > innerX + innerW) {
      sx = innerX;
      sy += 1;
    }
    const px = sx;
    const py = sy;
    const active = feature.status === s;
    const st = getStatusStyle(s);
    const label = active ? `${st.icon} ${s}` : s;
    const usedLen = label.length + 2;
    ops.push((cw) => {
      cw.pill(
        px,
        py,
        label,
        active
          ? { fg: st.fg, bg: st.bg, bold: true }
          : { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface2 },
        { id: `drawer-status-${s}`, kind: "drawer-status", data: s }
      );
    });
    sx += usedLen + 1;
  }
  vy = sy + 2;

  // Overview
  if (feature.description) {
    const descStart = vy;
    const wrapped = wrapText(feature.description, innerW);
    ops.push((cw) => {
      cw.write(innerX, descStart, "OVERVIEW", innerW, { fg: TUI_PALETTE.muted, bold: true });
      wrapped.forEach((line, i) => {
        cw.write(innerX, descStart + 1 + i, line, innerW, { fg: TUI_PALETTE.text });
      });
    });
    vy += 1 + wrapped.length + 1;
  }

  // Depends On jump chips
  if (feature.depends_on.length > 0) {
    const depTitleY = vy;
    ops.push((cw) => {
      cw.write(innerX, depTitleY, "DEPENDS ON", innerW, { fg: TUI_PALETTE.muted, bold: true });
    });
    vy += 1;
    let dx = innerX;
    let dy = vy;
    for (const dep of feature.depends_on) {
      const chipLabel = `→ ${dep}`;
      const chipW = chipLabel.length + 2;
      if (dx > innerX && dx + chipW > innerX + innerW) {
        dx = innerX;
        dy += 1;
      }
      const cx = dx;
      const cy = dy;
      ops.push((cw) => {
        cw.pill(
          cx,
          cy,
          chipLabel,
          { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true },
          { id: `drawer-jump-${dep}`, kind: "drawer-jump", data: dep }
        );
      });
      dx += chipW + 1;
    }
    vy = dy + 2;
  }

  // External Refs + Beads status
  if (feature.refs.length > 0) {
    const refTitleY = vy;
    const beads = (state.payload.beads && state.payload.beads[feature.id]) || [];
    ops.push((cw) => {
      cw.write(innerX, refTitleY, "EXTERNAL REFS", innerW, { fg: TUI_PALETTE.muted, bold: true });
    });
    vy += 1;
    for (const r of feature.refs) {
      const b = beads.find((x) => x.ref === r);
      const suffix =
        b && b.available
          ? b.found
            ? ` — ${b.status}${b.title ? `: ${b.title}` : ""}`
            : " — NOT FOUND"
          : state.beadsLoading
          ? " — resolving…"
          : "";
      const fg = b && b.available ? (b.found ? getStatusStyle(b.status ?? "").fg : TUI_PALETTE.red) : TUI_PALETTE.muted;
      const rowY = vy;
      ops.push((cw) => {
        cw.write(innerX, rowY, `${r}${suffix}`, innerW, { fg });
      });
      vy += 1;
    }
    vy += 1;
  }

  // Ship Criteria checkboxes
  const critTitleY = vy;
  const doneCount = feature.ship_criteria.filter((c) => c.done).length;
  ops.push((cw) => {
    cw.write(
      innerX,
      critTitleY,
      `SHIP CRITERIA (${doneCount}/${feature.ship_criteria.length})`,
      innerW,
      { fg: TUI_PALETTE.muted, bold: true }
    );
  });
  vy += 1;
  if (feature.ship_criteria.length === 0) {
    const emptyY = vy;
    ops.push((cw) => {
      cw.write(innerX, emptyY, "No ship criteria defined.", innerW, { fg: TUI_PALETTE.muted });
    });
    vy += 2;
  } else {
    feature.ship_criteria.forEach((c, idx) => {
      const prefix = c.done ? "[x] " : "[ ] ";
      const lines = wrapText(c.text, Math.max(10, innerW - 6));
      const rowH = Math.max(1, lines.length);
      const startRow = vy;
      const focused = state.drawerFocus === "criteria" && state.drawerCriterionIndex === idx;
      ops.push((cw) => {
        cw.fill(innerX, startRow, innerW, rowH, {
          bg: focused ? TUI_PALETTE.accentSoft : TUI_PALETTE.surface2,
        });
        cw.write(innerX + 1, startRow, prefix, 4, {
          fg: c.done ? TUI_PALETTE.green : TUI_PALETTE.amber,
          bold: true,
        });
        lines.forEach((ln, li) => {
          cw.write(innerX + 5, startRow + li, ln, innerW - 6, {
            fg: c.done ? TUI_PALETTE.text : TUI_PALETTE.text,
            bold: focused,
          });
        });
        cw.hit(innerX, startRow, innerW, rowH, `drawer-criterion-${c.id}`, "drawer-criterion", {
          criterionId: c.id,
          done: !c.done,
          index: idx,
        });
      });
      vy += rowH + 1;
    });
  }

  // Inline Add Pulse Note input
  const noteHeaderY = vy;
  const noteRowY = vy + 1;
  const draft = state.noteDrafts[feature.id] ?? "";
  const isNoteFocused = state.drawerFocus === "note";
  const btnW = 5; // " Log "
  const boxW = Math.max(12, innerW - btnW - 1);
  ops.push((cw) => {
    cw.write(innerX, noteHeaderY, "ADD PULSE NOTE (press n to type, Enter to log)", innerW, {
      fg: TUI_PALETTE.muted,
      bold: true,
    });
    cw.fill(innerX, noteRowY, boxW, 1, {
      bg: isNoteFocused ? TUI_PALETTE.accentSoft : TUI_PALETTE.bg,
    });
    const innerTextW = Math.max(6, boxW - 2);
    let shown = draft;
    if (!draft && !isNoteFocused) {
      cw.write(innerX + 1, noteRowY, "Log milestone update...", innerTextW, {
        fg: TUI_PALETTE.muted,
      });
    } else {
      const glyphs = Array.from(draft);
      const cursor = Math.max(0, Math.min(state.noteCursor, glyphs.length));
      const sliceStart = Math.max(0, cursor - innerTextW + 2);
      shown = glyphs.slice(sliceStart, sliceStart + innerTextW - 1).join("");
      const cursorCol = innerX + 1 + (cursor - sliceStart);
      cw.write(innerX + 1, noteRowY, shown, innerTextW - 1, { fg: TUI_PALETTE.text });
      if (isNoteFocused && cursorCol < innerX + boxW - 1) {
        const atCursor = glyphs[cursor] ?? " ";
        const sy = cw.toScreenY(noteRowY);
        if (cw.isVisible(sy)) {
          buf.put(cursorCol, sy, atCursor, { fg: TUI_PALETTE.bg, bg: TUI_PALETTE.accent, bold: true });
        }
      }
    }
    cw.hit(innerX, noteRowY, boxW, 1, "drawer-note-input", "drawer-note-input");
    cw.pill(
      innerX + boxW + 1,
      noteRowY,
      "Log",
      { fg: TUI_PALETTE.white, bg: TUI_PALETTE.accent, bold: true },
      { id: "drawer-note-submit", kind: "drawer-note-submit" }
    );
  });
  vy += 3;

  // Pulse Updates reverse-chronological
  const updatesTitleY = vy;
  ops.push((cw) => {
    cw.write(innerX, updatesTitleY, "PULSE UPDATES", innerW, { fg: TUI_PALETTE.muted, bold: true });
  });
  vy += 1;
  if (feature.updates.length === 0) {
    const emptyY = vy;
    ops.push((cw) => {
      cw.write(innerX, emptyY, "No updates logged yet.", innerW, { fg: TUI_PALETTE.muted });
    });
    vy += 1;
  } else {
    for (const u of feature.updates.slice().reverse()) {
      const lines = wrapText(u.note, Math.max(10, innerW - 2));
      const startY = vy;
      ops.push((cw) => {
        cw.fill(innerX, startY, innerW, 1 + lines.length, { bg: TUI_PALETTE.surface2 });
        cw.write(innerX + 1, startY, u.at, innerW - 2, { fg: TUI_PALETTE.muted });
        lines.forEach((ln, li) => {
          cw.write(innerX + 1, startY + 1 + li, ln, innerW - 2, { fg: TUI_PALETTE.text });
        });
      });
      vy += 1 + lines.length + 1;
    }
  }

  const maxScrollY = Math.max(0, vy - bodyRect.h);
  state.drawerScrollY = Math.max(0, Math.min(state.drawerScrollY, maxScrollY));
  const cw = new DrawerClipWriter(buf, bodyRect, state.drawerScrollY, HitLayer.drawerControl);
  for (const op of ops) op(cw);

  return { maxScrollY, rect };
}

export function renderHelpOverlay(buf: ScreenBuffer, width: number, height: number): void {
  buf.addHitRegion({
    id: "help-backdrop",
    kind: "help-backdrop",
    x: 0,
    y: 0,
    w: width,
    h: height,
    zIndex: HitLayer.helpBackdrop,
  });

  const w = Math.min(width - 4, 78);
  const h = Math.min(height - 4, 21);
  const x = Math.max(1, Math.floor((width - w) / 2));
  const y = Math.max(1, Math.floor((height - h) / 2));

  buf.drawBox(x, y, w, h, {
    borderStyle: { fg: TUI_PALETTE.accent },
    fillStyle: { bg: TUI_PALETTE.surface },
    title: "Project Pulse TUI — Controls & SSH Tips",
    titleStyle: { fg: TUI_PALETTE.accent, bold: true },
  });

  drawPill(
    buf,
    x + w - 10,
    y + 1,
    "Close",
    { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 },
    { id: "help-close", kind: "help-close", zIndex: HitLayer.helpControl }
  );

  const lines: Array<[string, string]> = [
    ["1 / 2 / 3", "Switch Milestone Cards, Dependency Graph, Status Board"],
    ["/ Search", "Filter features by title, ID, or description"],
    ["Click pills", "Open Milestone / Status / Area dropdown filters & Reset"],
    ["j / k / Wheel", "Select features or scroll active view / drawer"],
    ["Enter", "Open Feature Detail Drawer (split >= 120 cols, modal < 120)"],
    ["Graph Pan/Zoom", "Drag canvas to pan · Wheel / + / - zoom · 0 reset · F fit"],
    ["Graph Click", "Hover ON by default: move traces, click opens · h toggles"],
    ["Drawer Actions", "Click status pills · Space toggles criterion · n logs note"],
    ["m (Mouse)", "Toggle SGR mouse off for native SSH/tmux drag-selection"],
    ["y (Copy ID)", "Copy active feature ID to host clipboard via OSC 52"],
    ["R / ? / q", "Manual refresh / toggle Help / quit & restore terminal"],
  ];

  let ry = y + 3;
  for (const [k, desc] of lines) {
    if (ry >= y + h - 1) break;
    buf.writeText(x + 3, ry, truncateText(k, 16), 16, { fg: TUI_PALETTE.accent, bold: true });
    buf.writeText(x + 20, ry, desc, w - 23, { fg: TUI_PALETTE.text });
    ry += 1;
  }
}
