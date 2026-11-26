import type { Feature, FeatureStatus } from "../types";
import { ScreenBuffer, TUI_PALETTE, glyphCellWidth, sanitizeTerminalText, segmentText, textCellWidth, truncateText, type CellStyle } from "./screen";
import { HitLayer, drawPill, getStatusStyle, type Rect, type TuiState } from "./views";
import { formatCriteria, formatTimestamp, plural, statusLabel, VIEW_LABELS } from "../present";
import { wrapCells } from "./screen";

export const DRAWER_STATUSES: FeatureStatus[] = ["planned", "in-progress", "shipped", "paused", "cut"];
export const SHIP_CHOICES = ["also", "anyway", "cancel"] as const;

export interface DrawerRectInfo extends Rect {
  mode: "split" | "modal";
}

/**
 * Computes responsive right split-pane (>= 120 cols) or centered modal (< 120 cols) drawer bounds.
 */
export function getDrawerRect(totalW: number, totalH: number, topY: number): DrawerRectInfo {
  if (totalW >= 120) {
    const availH = totalH - topY - 1;
    // A split pane needs real vertical space (frame + pinned header + at least
    // one body row); a wide but short terminal falls back to the centered
    // modal, which uses the full pane height and keeps body content usable.
    if (availH >= 6) {
      const w = Math.min(64, Math.max(48, Math.floor(totalW * 0.42)));
      return {
        mode: "split",
        x: totalW - w,
        y: topY,
        w,
        h: availH,
      };
    }
  }
  // The modal shrinks on small panes rather than forcing 36x14: it must always
  // fit inside the terminal with a margin, footer row included.
  const w = Math.min(Math.max(36, Math.min(totalW - 4, 72)), Math.max(2, totalW - 2));
  const h = Math.min(Math.max(14, totalH - 4), Math.max(2, totalH - 2));
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
    const wLen = textCellWidth(w);
    if (!line) {
      if (wLen <= safeW) {
        line = w;
      } else {
        lines.push(...hardWrapWord(w, safeW));
      }
    } else if (textCellWidth(line) + 1 + wLen <= safeW) {
      line += " " + w;
    } else {
      lines.push(line);
      if (wLen <= safeW) {
        line = w;
      } else {
        lines.push(...hardWrapWord(w, safeW));
        line = "";
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Hard-wraps one over-wide word on cell boundaries so wide and combining
 * glyphs are never split across rows.
 */
function hardWrapWord(word: string, safeW: number): string[] {
  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  for (const glyph of segmentText(word)) {
    const gw = glyphCellWidth(glyph);
    if (line && lineW + gw > safeW) {
      lines.push(line);
      line = "";
      lineW = 0;
    }
    line += glyph;
    lineW += gw;
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
    const len = textCellWidth(clean);
    const sy = this.toScreenY(vy);
    if (!this.isVisible(sy)) return len;
    const x0 = Math.max(this.clip.x, vx);
    const avail = Math.min(len, this.clip.x + this.clip.w - x0);
    if (avail <= 0) return len;
    // Truncate to the visible cells so an over-wide chip or pill renders inside
    // the drawer (with an ellipsis) instead of disappearing entirely; the full
    // visible pill stays one click target.
    const shown = truncateText(clean, avail);
    const shownW = Math.min(textCellWidth(shown), avail);
    this.buf.fillRect(x0, sy, shownW, 1, style);
    this.buf.writeText(x0, sy, shown, shownW, style);
    if (hit) {
      this.buf.addHitRegion({
        id: hit.id,
        kind: hit.kind,
        x: x0,
        y: sy,
        w: shownW,
        h: 1,
        zIndex: this.zIndex,
        data: hit.data,
      });
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
  state: TuiState,
  opts?: { revealNote?: boolean; revealKey?: string }
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
  const innerW = Math.max(2, rect.w - 4);
  const copyBtnW = 8;
  const closeBtnW = 7;
  const titleMax = Math.min(innerW, Math.max(8, innerW - copyBtnW - closeBtnW - 2));
  // On panes too short for the full frame, pinned rows never overwrite the box
  // border: title needs an interior row, meta a second, divider a third.
  if (rect.h > 2) {
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
  }

  const metaTag = [feature.id, feature.milestone, feature.area].filter(Boolean).join(" · ");
  if (rect.h > 3) {
    buf.writeText(innerX, rect.y + 2, metaTag, innerW, { fg: TUI_PALETTE.muted });
  }
  if (rect.h > 4) {
    for (let i = rect.x + 1; i < rect.x + rect.w - 1; i++) {
      buf.put(i, rect.y + 3, "─", { fg: TUI_PALETTE.border });
    }
  }

  const bodyRect: Rect = {
    x: rect.x + 1,
    y: rect.y + 4,
    w: rect.w - 2,
    h: Math.max(0, rect.h - 5),
  };

  const ops: Array<(w: DrawerClipWriter) => void> = [];
  let vy = 0;

  const feedbackFor = (key: string) => (state.drawerFeedback && state.drawerFeedback.key === key ? state.drawerFeedback : null);
  /** Paints control feedback on the rows just below a control; returns rows used. */
  const controlRows = new Map<string, { y: number; h: number }>();
  const pushFeedback = (key: string, atY: number): number => {
    const fb = feedbackFor(key);
    if (fb) controlRows.set(key, { y: atY, h: 0 });
    if (!fb) return 0;
    const style =
      fb.kind === "err"
        ? { fg: TUI_PALETTE.red, bg: TUI_PALETTE.redSoft }
        : fb.kind === "ok"
        ? { fg: TUI_PALETTE.green, bg: TUI_PALETTE.greenSoft }
        : { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft };
    const msg = fb.kind === "err" ? `${fb.message}  (x dismiss)` : fb.message;
    const lines = wrapCells(msg, innerW - 2);
    controlRows.set(key, { y: atY - 1, h: lines.length + 1 });
    ops.push((cw) => {
      cw.fill(innerX, atY, innerW, lines.length, style);
      lines.forEach((ln, i) => cw.write(innerX + 1, atY + i, ln, innerW - 2, { ...style, bold: true }));
      if (fb.kind === "err") cw.hit(innerX, atY, innerW, lines.length, "drawer-dismiss", "drawer-dismiss");
    });
    return lines.length;
  };

  const check = state.payload.check;
  const frozen = check.editable === false;
  if (frozen) {
    const n = (check.blocking ?? check.errors).length;
    const lines = wrapCells(`Editing paused — ${plural(n, "error")}. The roadmap has errors that block every save; fix them, then R to recheck. Press e for Health.`, innerW - 2);
    const fy = vy;
    ops.push((cw) => {
      cw.fill(innerX, fy, innerW, lines.length, { bg: TUI_PALETTE.redSoft });
      lines.forEach((ln, i) => cw.write(innerX + 1, fy + i, ln, innerW - 2, { fg: TUI_PALETTE.red, bg: TUI_PALETTE.redSoft, bold: i === 0 }));
      cw.hit(innerX, fy, innerW, lines.length, "drawer-freeze", "drawer-freeze");
    });
    vy += lines.length;
    vy += pushFeedback("freeze", vy);
    vy += 1;
  } else if (check.stale) {
    const lines = wrapCells("ROADMAP.md is out of sync — run pp render (or save any change here).", innerW - 2);
    const sy0 = vy;
    ops.push((cw) => {
      cw.fill(innerX, sy0, innerW, lines.length, { bg: TUI_PALETTE.amberSoft });
      lines.forEach((ln, i) => cw.write(innerX + 1, sy0 + i, ln, innerW - 2, { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft }));
    });
    vy += lines.length + 1;
  }

  // Status selector row(s): pills, focusable with Tab and ←/→ (Enter applies).
  const statusStart = vy;
  ops.push((cw) => {
    cw.write(innerX, statusStart, "STATUS", innerW, { fg: TUI_PALETTE.muted, bold: true });
  });
  vy += 1;

  let sx = innerX;
  let sy = vy;
  DRAWER_STATUSES.forEach((s, idx) => {
    const active = feature.status === s;
    const st = getStatusStyle(s);
    const focused = state.drawerFocus === "status" && state.drawerStatusIndex === idx && !state.pendingShip;
    const label = active ? `${st.icon} ${statusLabel(s)}` : statusLabel(s);
    // Measure in terminal cells (multi-cell icons) so pills cannot overlap.
    const pillW = textCellWidth(` ${label} `);
    if (sx > innerX && sx + pillW > innerX + innerW) {
      sx = innerX;
      sy += 1;
    }
    const px = sx;
    const py = sy;
    ops.push((cw) => {
      cw.pill(
        px,
        py,
        label,
        focused
          ? { fg: TUI_PALETTE.bg, bg: TUI_PALETTE.accent, bold: true }
          : active
          ? { fg: st.fg, bg: st.bg, bold: true }
          : { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface2, dim: frozen },
        { id: `drawer-status-${s}`, kind: "drawer-status", data: s }
      );
    });
    sx += pillW + 1;
  });
  vy = sy + 1;

  // Ship confirm (soft invariant): shipped with open criteria asks first.
  if (state.pendingShip && state.pendingShip.featureId === feature.id) {
    const open = feature.ship_criteria.filter((c) => !c.done).length;
    const msgLines = wrapCells(`${plural(open, "criterion", "criteria")} still open. Shipped usually means every criterion is done.`, innerW - 2);
    const cy0 = vy;
    const labels = [`Also mark ${open} ${open === 1 ? "criterion" : "criteria"} done`, "Ship anyway", "Cancel"];
    ops.push((cw) => {
      cw.fill(innerX, cy0, innerW, msgLines.length + 2, { bg: TUI_PALETTE.amberSoft });
      msgLines.forEach((ln, i) => cw.write(innerX + 1, cy0 + i, ln, innerW - 2, { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft, bold: true }));
    });
    let bx = innerX + 1;
    let by = cy0 + msgLines.length;
    labels.forEach((lbl, i) => {
      const w = textCellWidth(` ${lbl} `);
      if (bx > innerX + 1 && bx + w > innerX + innerW) {
        bx = innerX + 1;
        by += 1;
      }
      const px = bx;
      const py = by;
      const focused = state.pendingShip!.choice === i;
      ops.push((cw) => {
        cw.pill(px, py, lbl, focused ? { fg: TUI_PALETTE.bg, bg: TUI_PALETTE.accent, bold: true } : { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 }, {
          id: `ship-${SHIP_CHOICES[i]}`,
          kind: "drawer-ship-choice",
          data: i,
        });
      });
      bx += w + 1;
    });
    vy = by + 2;
  }
  vy += pushFeedback("status", vy);
  vy += 1;

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
      const chipW = textCellWidth(chipLabel) + 2;
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

  // Unblocks: direct dependents, jumping to each.
  const dependents = state.payload.features.filter((f) => f.depends_on.includes(feature.id));
  {
    const titleY = vy;
    ops.push((cw) => cw.write(innerX, titleY, "UNBLOCKS", innerW, { fg: TUI_PALETTE.muted, bold: true }));
    vy += 1;
    if (dependents.length === 0) {
      const ey = vy;
      ops.push((cw) => cw.write(innerX, ey, "Nothing depends on this yet.", innerW, { fg: TUI_PALETTE.muted }));
      vy += 2;
    } else {
      let dx = innerX;
      let dy = vy;
      for (const dep of dependents) {
        const chipLabel = `← ${dep.id}`;
        const chipW = textCellWidth(chipLabel) + 2;
        if (dx > innerX && dx + chipW > innerX + innerW) {
          dx = innerX;
          dy += 1;
        }
        const cx = dx;
        const cy = dy;
        ops.push((cw) => {
          cw.pill(cx, cy, chipLabel, { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true }, {
            id: `drawer-unblocks-${dep.id}`,
            kind: "drawer-jump",
            data: dep.id,
          });
        });
        dx += chipW + 1;
      }
      vy = dy + 2;
    }
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
            ? ` — ${statusLabel(b.status ?? "")}${b.title ? `: ${b.title}` : ""}`
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
      `SHIP CRITERIA · ${formatCriteria(doneCount, feature.ship_criteria.length)}`,
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
      vy += rowH;
      vy += pushFeedback(`crit:${c.id}`, vy);
      vy += 1;
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
    cw.write(innerX, noteHeaderY, "ADD A NOTE (n to type, Enter to log)", innerW, {
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
      // Position by grapheme clusters measured in terminal cells so wide and
      // combining glyphs keep the cursor on the correct column.
      const clusters = segmentText(draft);
      const cursor = Math.max(0, Math.min(state.noteCursor, clusters.length));
      const visibleCells = Math.max(1, innerTextW - 1);
      const prefix = new Array<number>(clusters.length + 1);
      prefix[0] = 0;
      for (let i = 0; i < clusters.length; i++) {
        prefix[i + 1] = prefix[i]! + glyphCellWidth(clusters[i]!);
      }
      // Scroll the window so the cursor sits inside the visible cell range,
      // then extend over whole clusters while they still fit.
      let sliceStart = 0;
      while (sliceStart < cursor && prefix[cursor]! - prefix[sliceStart]! >= visibleCells) {
        sliceStart++;
      }
      let sliceEnd = sliceStart;
      while (sliceEnd < clusters.length && prefix[sliceEnd + 1]! - prefix[sliceStart]! <= visibleCells) {
        sliceEnd++;
      }
      shown = clusters.slice(sliceStart, sliceEnd).join("");
      const cursorCol = innerX + 1 + (prefix[cursor]! - prefix[sliceStart]!);
      cw.write(innerX + 1, noteRowY, shown, visibleCells, { fg: TUI_PALETTE.text });
      if (isNoteFocused && cursorCol < innerX + boxW - 1) {
        const atCursor = clusters[cursor] ?? " ";
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
  vy += 2;
  vy += pushFeedback("note", vy);
  vy += 1;

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
        cw.write(innerX + 1, startY, formatTimestamp(u.at), innerW - 2, { fg: TUI_PALETTE.muted });
        lines.forEach((ln, li) => {
          cw.write(innerX + 1, startY + 1 + li, ln, innerW - 2, { fg: TUI_PALETTE.text });
        });
      });
      vy += 1 + lines.length + 1;
    }
  }

  const maxScrollY = Math.max(0, vy - bodyRect.h);
  // Focusing the inline note input reveals it on short panes: scroll so the
  // input row is the last visible body row (its header stays visible whenever
  // the body shows 2+ rows). One-shot — later frames keep the user's scroll.
  if (opts?.revealNote && state.drawerFocus === "note" && bodyRect.h > 0) {
    const visibleBottom = state.drawerScrollY + bodyRect.h;
    if (noteRowY >= visibleBottom || noteRowY < state.drawerScrollY) {
      state.drawerScrollY = Math.max(0, Math.min(maxScrollY, noteRowY - bodyRect.h + 1));
    }
  }
  // One-shot: keep the control that just changed (and its feedback) on screen with a minimal scroll.
  if (opts?.revealKey && bodyRect.h > 0) {
    const target = controlRows.get(opts.revealKey);
    if (target) {
      if (target.y < state.drawerScrollY) state.drawerScrollY = target.y;
      else if (target.y + target.h > state.drawerScrollY + bodyRect.h) state.drawerScrollY = target.y + target.h - bodyRect.h;
    }
  }
  state.drawerScrollY = Math.max(0, Math.min(state.drawerScrollY, maxScrollY));
  const cw = new DrawerClipWriter(buf, bodyRect, state.drawerScrollY, HitLayer.drawerControl);
  for (const op of ops) op(cw);

  // Scroll cue on the frame whenever the body overflows.
  if (maxScrollY > 0 && rect.h > 2) {
    const below = maxScrollY - state.drawerScrollY;
    const cue = below > 0 ? ` ▼ ${below} more · PgDn ` : " ▲ top · PgUp ";
    const cueW = textCellWidth(cue);
    buf.writeText(rect.x + rect.w - 2 - cueW, rect.y + rect.h - 1, cue, cueW, { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.surface, bold: true });
  }

  return { maxScrollY, rect };
}

export const HELP_LINES: Array<[string, string]> = [
  ["1 / 2 / 3", `Views: ${VIEW_LABELS.roadmap}, ${VIEW_LABELS.graph}, ${VIEW_LABELS.activity}`],
  ["j / k  Enter", "Move the selection; open the feature"],
  ["/", "Search titles, ids and descriptions"],
  ["s / a / M", "Filter by status, area or milestone"],
  ["c", "Clear every filter"],
  ["w", "Activity: 7-day or 30-day window"],
  ["+ - 0 f", "Graph: zoom out/in, actual size, fit"],
  ["← → / drag", "Graph: pan"],
  ["h", "Graph: hover tracing on or off"],
  ["Tab ←→ Space", "Drawer: status pills, choose, toggle criterion"],
  ["n  x  e", "Drawer: note, dismiss an error, open Health"],
  ["PgUp / PgDn", "Scroll the drawer, list or Health"],
  ["m / y", "Mouse capture on or off; copy the feature id"],
  ["R", "Reload from disk and recheck"],
  ["? / q", "Toggle this help / quit and restore the terminal"],
];

export function renderHelpOverlay(buf: ScreenBuffer, width: number, height: number): void {
  buf.addHitRegion({ id: "help-backdrop", kind: "help-backdrop", x: 0, y: 0, w: width, h: height, zIndex: HitLayer.helpBackdrop });

  const w = Math.max(24, Math.min(width - 4, 92));
  const gutter = Math.min(Math.max(...HELP_LINES.map(([k]) => textCellWidth(k))) + 2, Math.floor(w / 3));
  const descW = Math.max(10, w - 4 - gutter);
  const rows: Array<{ key: string; text: string }> = [];
  for (const [k, desc] of HELP_LINES) {
    wrapCells(desc, descW).forEach((line, i) => rows.push({ key: i === 0 ? k : "", text: line }));
  }
  const h = Math.max(6, Math.min(height - 2, rows.length + 4));
  const x = Math.max(1, Math.floor((width - w) / 2));
  const y = Math.max(1, Math.floor((height - h) / 2));
  buf.drawBox(x, y, w, h, {
    borderStyle: { fg: TUI_PALETTE.accent },
    fillStyle: { bg: TUI_PALETTE.surface },
    title: "Keys",
    titleStyle: { fg: TUI_PALETTE.accent, bold: true },
  });
  drawPill(buf, x + w - 9, y + 1, "Close", { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 }, { id: "help-close", kind: "help-close", zIndex: HitLayer.helpControl });
  const visible = h - 4;
  for (let i = 0; i < Math.min(visible, rows.length); i++) {
    const r = rows[i]!;
    if (r.key) buf.writeText(x + 2, y + 2 + i, r.key, gutter - 1, { fg: TUI_PALETTE.accent, bold: true });
    buf.writeText(x + 2 + gutter, y + 2 + i, r.text, descW, { fg: TUI_PALETTE.text });
  }
  if (rows.length > visible) {
    const hint = ` ▼ ${rows.length - visible} more lines — widen the terminal `;
    buf.writeText(x + w - 2 - textCellWidth(hint), y + h - 1, hint, textCellWidth(hint), { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface });
  }
}
