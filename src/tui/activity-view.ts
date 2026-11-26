import type { ActivityEvent } from "../activity";
import { formatDay, formatTimestamp, statusLabel } from "../present";
import { ScreenBuffer, TUI_PALETTE, textCellWidth, type CellStyle } from "./screen";
import { getStatusStyle, renderFilteredEmpty, type Rect, type TuiState } from "./views";

/** Activity entries that pass the milestone, area and search filters, newest first. */
export function visibleActivityEvents(state: TuiState): ActivityEvent[] {
  const events = state.activity?.result?.events ?? [];
  const q = state.search.trim().toLowerCase();
  return events.filter((e) => {
    if (state.milestoneFilter && e.milestone !== state.milestoneFilter) return false;
    if (state.areaFilter && e.area !== state.areaFilter) return false;
    if (q && !(e.title.toLowerCase().includes(q) || e.featureId.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q))) {
      return false;
    }
    return true;
  });
}

function windowPhrase(state: TuiState): string {
  return state.activityWindow === "30d" ? "in the last 30 days" : "in the last 7 days";
}

function kindText(e: ActivityEvent): { text: string; style: CellStyle } {
  switch (e.kind) {
    case "status-change":
    case "shipped": {
      const to = e.to ?? (e.kind === "shipped" ? "shipped" : "planned");
      const st = getStatusStyle(to);
      return { text: `${st.icon} ${statusLabel(to)}`, style: { fg: st.fg, bold: true } };
    }
    case "criterion-done":
      return { text: "✓ criterion", style: { fg: TUI_PALETTE.green } };
    case "criterion-reopened":
      return { text: "○ reopened", style: { fg: TUI_PALETTE.amber } };
    case "feature-added":
      return { text: "+ added", style: { fg: TUI_PALETTE.accent } };
    case "feature-removed":
      return { text: "− removed", style: { fg: TUI_PALETTE.muted } };
    default:
      return { text: "note", style: { fg: TUI_PALETTE.muted } };
  }
}

function eventDetail(e: ActivityEvent): string {
  if ((e.kind === "status-change" || e.kind === "shipped") && e.from) return `${statusLabel(e.from)} → ${statusLabel(e.to ?? "")}`;
  return e.detail;
}

/**
 * Activity: a day-grouped list of what changed (Uncommitted first, newest first). Enter opens the
 * selected entry's feature; `w` cycles the 7- and 30-day windows.
 */
export function renderActivityView(
  buf: ScreenBuffer,
  rect: Rect,
  state: TuiState
): { orderedFeatureIds: string[]; entryBounds: Array<{ y: number; h: number }>; maxScrollY: number } {
  const x0 = rect.x + 1;
  const width = Math.max(20, rect.w - 2);
  const orderedFeatureIds: string[] = [];
  const entryBounds: Array<{ y: number; h: number }> = [];
  const cache = state.activity;
  const branch = cache?.result?.branch ? ` on ${cache.result.branch}` : "";
  const head = `Changes ${windowPhrase(state)}${branch} · w window`;
  buf.writeText(x0, rect.y, head, width, { fg: TUI_PALETTE.muted });
  const body: Rect = { x: rect.x, y: rect.y + 1, w: rect.w, h: Math.max(1, rect.h - 1) };

  if (!cache || (!cache.result && !cache.error)) {
    buf.writeText(x0, body.y + 1, "Loading activity…", width, { fg: TUI_PALETTE.muted });
    return { orderedFeatureIds, entryBounds, maxScrollY: 0 };
  }
  if (cache.error) {
    buf.writeText(x0, body.y + 1, "Couldn't load activity.", width, { fg: TUI_PALETTE.red, bold: true });
    buf.writeText(x0, body.y + 2, cache.error, width, { fg: TUI_PALETTE.text });
    buf.writeText(x0, body.y + 4, "Press R to retry.", width, { fg: TUI_PALETTE.muted });
    return { orderedFeatureIds, entryBounds, maxScrollY: 0 };
  }
  const result = cache.result!;
  let top = body.y;
  if (result.noGit) {
    buf.writeText(x0, top, "Status and criteria changes need git history; showing notes.", width, { fg: TUI_PALETTE.amber });
    top += 1;
  }
  const listRect: Rect = { x: rect.x, y: top, w: rect.w, h: Math.max(1, body.y + body.h - top) };
  const events = visibleActivityEvents(state);
  if (events.length === 0) {
    if (state.milestoneFilter || state.areaFilter || state.search.trim()) {
      renderFilteredEmpty(buf, { ...listRect, y: listRect.y - 1 }, state, "changes");
    } else {
      buf.writeText(x0, listRect.y + 1, `No changes ${windowPhrase(state)}.`, width, { fg: TUI_PALETTE.text, bold: true });
      buf.writeText(x0, listRect.y + 2, "Notes, status changes, completed criteria and new features appear here once committed.", width, {
        fg: TUI_PALETTE.muted,
      });
    }
    return { orderedFeatureIds, entryBounds, maxScrollY: 0 };
  }

  // Virtual rows: day headings and entries.
  type VRow = { kind: "day"; label: string } | { kind: "entry"; event: ActivityEvent; index: number };
  const vrows: VRow[] = [];
  let lastKey = "";
  events.forEach((e, index) => {
    const key = e.uncommitted ? "Uncommitted — not in git yet" : formatDay(e.at!);
    if (key !== lastKey) {
      if (vrows.length) vrows.push({ kind: "day", label: "" });
      vrows.push({ kind: "day", label: key });
      lastKey = key;
    }
    vrows.push({ kind: "entry", event: e, index });
  });
  vrows.forEach((r, vy) => {
    if (r.kind === "entry") {
      orderedFeatureIds.push(r.event.featureId);
      entryBounds.push({ y: vy, h: 1 });
    }
  });

  state.activitySelectedIndex = Math.max(0, Math.min(state.activitySelectedIndex, events.length - 1));
  const maxScrollY = Math.max(0, vrows.length - listRect.h);
  // Keep the selected entry on screen.
  const selRow = entryBounds[state.activitySelectedIndex]?.y ?? 0;
  if (selRow < state.activityScrollY) state.activityScrollY = selRow;
  if (selRow >= state.activityScrollY + listRect.h) state.activityScrollY = selRow - listRect.h + 1;
  state.activityScrollY = Math.max(0, Math.min(state.activityScrollY, maxScrollY));

  const timeW = 5;
  const kindW = 14;
  for (let i = 0; i < listRect.h && state.activityScrollY + i < vrows.length; i++) {
    const r = vrows[state.activityScrollY + i]!;
    const y = listRect.y + i;
    if (r.kind === "day") {
      if (r.label) buf.writeText(x0, y, r.label, width, { fg: TUI_PALETTE.text, bold: true });
      continue;
    }
    const e = r.event;
    const sel = r.index === state.activitySelectedIndex;
    const bg = sel ? TUI_PALETTE.accentSoft : TUI_PALETTE.bg;
    buf.fillRect(rect.x, y, rect.w, 1, { bg });
    const time = e.at ? formatTimestamp(e.at).split(", ").pop()! : "—";
    buf.writeText(x0 + 1, y, time, timeW, { fg: TUI_PALETTE.muted, bg });
    const k = kindText(e);
    buf.writeText(x0 + 2 + timeW, y, k.text, kindW, { ...k.style, bg });
    const tx = x0 + 3 + timeW + kindW;
    const titleW = Math.min(textCellWidth(e.title), Math.max(8, Math.floor((width - (tx - x0)) * 0.5)));
    buf.writeText(tx, y, e.title, titleW, { fg: TUI_PALETTE.text, bg, bold: sel });
    const detail = eventDetail(e);
    if (detail) buf.writeText(tx + titleW + 2, y, detail, Math.max(0, x0 + width - (tx + titleW + 2)), { fg: TUI_PALETTE.muted, bg });
    buf.addHitRegion({ id: `activity-${r.index}`, kind: "activity-entry", x: rect.x, y, w: rect.w, h: 1, zIndex: 8, data: r.index });
  }
  if (state.activityScrollY < maxScrollY) {
    const more = `▼ ${vrows.length - listRect.h - state.activityScrollY} more`;
    buf.writeText(rect.x + rect.w - 1 - textCellWidth(more), listRect.y + listRect.h - 1, more, textCellWidth(more), {
      fg: TUI_PALETTE.muted,
    });
  }
  return { orderedFeatureIds, entryBounds, maxScrollY };
}
