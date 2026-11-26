import type { BeadStatusInfo, Feature, FeatureStatus, Milestone, ValidationIssue } from "../types";
import type { RoadmapViewPayload } from "../dashboard-html";
import type { ActivityResult } from "../activity";
import { formatCriteria, healthText, statusLabel, VIEW_LABELS } from "../present";
import { ScreenBuffer, TUI_PALETTE, textCellWidth, truncateText, wrapCells, type CellStyle, type PaletteColor } from "./screen";

/**
 * Hit-test z layers mirroring overlay paint order in TuiController.render():
 * header/cards/board/graph (< HitLayer.drawerBackdrop) < drawer < picker < health < help.
 * Each later-painted layer must out-rank every earlier one, or clicks leak through
 * the modal into covered controls (drawer status pills, criteria toggles).
 */
export const HitLayer = {
  drawerBackdrop: 55,
  drawerPanel: 58,
  drawerControl: 62,
  pickerBackdrop: 63,
  pickerOption: 64,
  healthBackdrop: 65,
  healthControl: 66,
  helpBackdrop: 68,
  helpControl: 72,
} as const;

export type TuiViewMode = "roadmap" | "graph" | "activity";
export type PickerKind = "milestone" | "status" | "area";
export type GraphZoomLevel = "full" | "compact" | "overview";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OpenPicker {
  kind: PickerKind;
  x: number;
  y: number;
  options: Array<{ value: string; label: string }>;
}

export interface TuiFeedback {
  kind: "ok" | "err" | "info";
  message: string;
}

/** Feedback shown on the drawer control that changed: "status", "crit:<id>", "note" or "freeze". */
export interface ControlFeedback extends TuiFeedback {
  key: string;
}

export type ActivityWindow = "7d" | "30d";

export interface ActivityCache {
  key: string;
  result: ActivityResult | null;
  error: string | null;
}

export interface GraphCameraState {
  zoom: GraphZoomLevel;
  tx: number;
  ty: number;
  initialized: boolean;
  layoutKey: string;
  /** Overview node-width cap chosen by Fit so wide layers fit the viewport. */
  nodeWCap?: number;
  /** True when no density fits the viewport: an overflow cue shows and j/k pan to each node. */
  overflow?: boolean;
}

export interface TuiState {
  payload: RoadmapViewPayload;
  viewMode: TuiViewMode;
  milestoneFilter: string;
  statusFilter: string;
  areaFilter: string;
  search: string;
  searchFocused: boolean;
  showDeps: boolean;
  healthPanelOpen: boolean;
  helpOpen: boolean;
  selectedFeatureId: string | null;
  drawerFeatureId: string | null;
  drawerScrollY: number;
  drawerFocus: "status" | "criteria" | "note";
  drawerCriterionIndex: number;
  /** Status pill focused while drawerFocus is "status" (index into FEATURE_STATUSES). */
  drawerStatusIndex: number;
  /** Ship confirmation open for this feature; `choice` is the focused option. */
  pendingShip: { featureId: string; choice: number } | null;
  noteDrafts: Record<string, string>;
  noteCursor: number;
  roadmapScrollY: number;
  activityWindow: ActivityWindow;
  activityScrollY: number;
  activitySelectedIndex: number;
  activity: ActivityCache | null;
  openPicker: OpenPicker | null;
  pickerSelectedIndex: number;
  /** First visible row of the floating picker (wheel offset; snapped to keyboard focus at render). */
  pickerScrollY: number;
  /** First visible diagnostic row of the Health overlay. */
  healthScrollY: number;
  mouseEnabled: boolean;
  graphHoverEnabled: boolean;
  graphSelectedId: string | null;
  graphHoverId: string | null;
  graphCamera: GraphCameraState;
  beadsLoading: boolean;
  liveWatchActive: boolean;
  /** Message from the most recent failed disk reload; null once a reload succeeds again. */
  loadError: string | null;
  toast: TuiFeedback | null;
  drawerFeedback: ControlFeedback | null;
  noBeads: boolean;
}

export interface FilteredData {
  visibleMilestones: Milestone[];
  filteredFeatures: Feature[];
  matchedMilestoneIds: Set<string>;
  hasFeatureFilter: boolean;
  hasActiveFilters: boolean;
  areas: string[];
  /**
   * Statuses selected by the status filter; `null` when unset. A value like
   * "paused|cut" matches any of its parts so combined KPI tallies filter exactly
   * the features they count.
   */
  statusFilterValues: Set<string> | null;
}

export interface StatusStyle {
  fg: PaletteColor;
  bg: PaletteColor;
  icon: string;
}

export function getStatusStyle(status: string): StatusStyle {
  switch (status) {
    case "shipped":
    case "closed":
      return { fg: TUI_PALETTE.green, bg: TUI_PALETTE.greenSoft, icon: "✓" };
    case "in-progress":
    case "in_progress":
    case "active":
      return { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, icon: "●" };
    case "paused":
      // U+2016 renders in common monospace fonts (U+23F8 is missing from many).
      return { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft, icon: "‖" };
    case "cut":
    case "archived":
    case "missing":
      return { fg: TUI_PALETTE.red, bg: TUI_PALETTE.redSoft, icon: "✕" };
    default:
      return { fg: TUI_PALETTE.slate, bg: TUI_PALETTE.slateSoft, icon: "○" };
  }
}

export function createInitialTuiState(
  payload: RoadmapViewPayload,
  opts: { noBeads?: boolean; beadsLoading?: boolean; liveWatchActive?: boolean } = {}
): TuiState {
  return {
    payload,
    viewMode: "roadmap",
    milestoneFilter: "",
    statusFilter: "",
    areaFilter: "",
    search: "",
    searchFocused: false,
    showDeps: true,
    healthPanelOpen: false,
    helpOpen: false,
    selectedFeatureId: null,
    drawerFeatureId: null,
    drawerScrollY: 0,
    drawerFocus: "criteria",
    drawerCriterionIndex: 0,
    drawerStatusIndex: 0,
    pendingShip: null,
    noteDrafts: {},
    noteCursor: 0,
    roadmapScrollY: 0,
    activityWindow: "7d",
    activityScrollY: 0,
    activitySelectedIndex: 0,
    activity: null,
    openPicker: null,
    pickerSelectedIndex: 0,
    pickerScrollY: 0,
    healthScrollY: 0,
    mouseEnabled: true,
    graphHoverEnabled: true,
    graphSelectedId: null,
    graphHoverId: null,
    graphCamera: {
      zoom: "full",
      tx: 0,
      ty: 0,
      initialized: false,
      layoutKey: "",
    },
    beadsLoading: Boolean(opts.beadsLoading),
    liveWatchActive: Boolean(opts.liveWatchActive),
    loadError: null,
    toast: null,
    drawerFeedback: null,
    noBeads: Boolean(opts.noBeads),
  };
}

/**
 * Computes active feature/milestone slices, hiding empty milestones whenever a feature filter is set.
 */
export function computeFilteredData(state: TuiState): FilteredData {
  const { payload } = state;
  const q = state.search.trim().toLowerCase();
  const statusFilterValues = state.statusFilter ? new Set(state.statusFilter.split("|")) : null;
  const hasFeatureFilter = Boolean(state.statusFilter || state.areaFilter || q);
  const hasActiveFilters = Boolean(state.milestoneFilter || hasFeatureFilter);

  const filteredFeatures = payload.features.filter((f) => {
    if (state.milestoneFilter && f.milestone !== state.milestoneFilter) return false;
    if (statusFilterValues && !statusFilterValues.has(f.status)) return false;
    if (state.areaFilter && f.area !== state.areaFilter) return false;
    if (
      q &&
      !(
        f.title.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q) ||
        (f.description || "").toLowerCase().includes(q)
      )
    ) {
      return false;
    }
    return true;
  });

  const matchedMilestoneIds = new Set(filteredFeatures.map((f) => f.milestone));
  const visibleMilestones = payload.milestones.filter((m) => {
    if (state.milestoneFilter && m.id !== state.milestoneFilter) return false;
    if (hasFeatureFilter && !matchedMilestoneIds.has(m.id)) return false;
    return true;
  });

  const areas = Array.from(
    new Set(payload.features.map((f) => f.area).filter((a): a is string => Boolean(a)))
  ).sort();

  return {
    visibleMilestones,
    filteredFeatures,
    matchedMilestoneIds,
    hasFeatureFilter,
    hasActiveFilters,
    areas,
    statusFilterValues,
  };
}

/**
 * Option rows visible in the floating picker for a terminal of `height` rows.
 * Shared by the renderer (window paint) and the controller (keyboard reveal) so
 * both agree on the window size.
 */
export function pickerVisibleRows(height: number, optionCount: number): number {
  return Math.max(1, Math.min(height - 4, optionCount));
}

export function buildPickerOptions(
  kind: PickerKind,
  state: TuiState,
  filtered: FilteredData
): Array<{ value: string; label: string }> {
  if (kind === "milestone") {
    return [
      { value: "", label: "All Milestones" },
      ...state.payload.milestones.map((m) => ({ value: m.id, label: `${m.id} — ${m.title}` })),
    ];
  }
  if (kind === "status") {
    return [
      { value: "", label: "All Statuses" },
      ...(["planned", "in-progress", "shipped", "paused", "cut"] as const).map((s) => ({ value: s, label: statusLabel(s) })),
      { value: "paused|cut", label: `${statusLabel("paused")} / ${statusLabel("cut")}` },
    ];
  }
  return [
    { value: "", label: "All Areas" },
    ...filtered.areas.map((a) => ({ value: a, label: a })),
  ];
}

export function drawPill(
  buf: ScreenBuffer,
  x: number,
  y: number,
  label: string,
  style: CellStyle,
  hit?: { id: string; kind: string; zIndex?: number; data?: unknown }
): number {
  const clean = ` ${label} `;
  const len = Array.from(clean).length;
  buf.fillRect(x, y, len, 1, style);
  buf.writeText(x, y, clean, len, style);
  if (hit) {
    buf.addHitRegion({
      id: hit.id,
      kind: hit.kind,
      x,
      y,
      w: len,
      h: 1,
      zIndex: hit.zIndex ?? 10,
      data: hit.data,
    });
  }
  return len;
}

function drawProgressBar(
  buf: ScreenBuffer,
  x: number,
  y: number,
  barWidth: number,
  done: number,
  total: number,
  fillFg: PaletteColor
): void {
  const safeTotal = Math.max(0, total);
  const ratio = safeTotal > 0 ? Math.min(1, Math.max(0, done / safeTotal)) : 0;
  const filled = Math.round(barWidth * ratio);
  for (let i = 0; i < barWidth; i++) {
    buf.put(x + i, y, i < filled ? "█" : "░", {
      fg: i < filled ? fillFg : TUI_PALETTE.border,
    });
  }
}

class ClipWriter {
  constructor(
    private readonly buf: ScreenBuffer,
    private readonly clip: Rect,
    private readonly scrollY: number,
    private readonly zIndex = 5
  ) {}

  toScreenY(vy: number): number {
    return this.clip.y + vy - this.scrollY;
  }

  isRowVisible(sy: number): boolean {
    return sy >= this.clip.y && sy < this.clip.y + this.clip.h;
  }

  writeText(vx: number, vy: number, text: string, maxWidth: number, style?: CellStyle): void {
    const sy = this.toScreenY(vy);
    if (!this.isRowVisible(sy)) return;
    const x0 = Math.max(this.clip.x, vx);
    const clipRight = this.clip.x + this.clip.w - x0;
    if (clipRight <= 0) return;
    const w = Math.min(maxWidth, clipRight);
    this.buf.writeText(x0, sy, text, w, style);
  }

  fillRect(vx: number, vy: number, w: number, h: number, style?: CellStyle, ch = " "): void {
    for (let dy = 0; dy < h; dy++) {
      const sy = this.toScreenY(vy + dy);
      if (!this.isRowVisible(sy)) continue;
      const x0 = Math.max(this.clip.x, vx);
      const x1 = Math.min(this.clip.x + this.clip.w, vx + w);
      if (x1 > x0) {
        this.buf.fillRect(x0, sy, x1 - x0, 1, style, ch);
      }
    }
  }

  drawProgress(vx: number, vy: number, barW: number, done: number, total: number, fg: PaletteColor): void {
    const sy = this.toScreenY(vy);
    if (!this.isRowVisible(sy)) return;
    const clippedW = Math.min(barW, this.clip.x + this.clip.w - vx);
    if (clippedW <= 0 || vx < this.clip.x) return;
    drawProgressBar(this.buf, vx, sy, clippedW, done, total, fg);
  }

  drawBox(
    vx: number,
    vy: number,
    w: number,
    h: number,
    opts: { borderStyle?: CellStyle; fillStyle?: CellStyle } = {}
  ): void {
    if (w < 2 || h < 2) return;
    const x0 = Math.max(this.clip.x, vx);
    const x1 = Math.min(this.clip.x + this.clip.w, vx + w);
    if (x1 <= x0) return;
    for (let dy = 0; dy < h; dy++) {
      const sy = this.toScreenY(vy + dy);
      if (!this.isRowVisible(sy)) continue;
      if (opts.fillStyle) {
        this.buf.fillRect(x0, sy, x1 - x0, 1, opts.fillStyle);
      }
      const bStyle = opts.borderStyle ?? opts.fillStyle;
      if (dy === 0 || dy === h - 1) {
        const leftCh = dy === 0 ? "╭" : "╰";
        const rightCh = dy === 0 ? "╮" : "╯";
        for (let sx = x0; sx < x1; sx++) {
          const ch = sx === vx ? leftCh : sx === vx + w - 1 ? rightCh : "─";
          this.buf.put(sx, sy, ch, bStyle);
        }
      } else {
        if (vx >= this.clip.x && vx < this.clip.x + this.clip.w) {
          this.buf.put(vx, sy, "│", bStyle);
        }
        if (vx + w - 1 >= this.clip.x && vx + w - 1 < this.clip.x + this.clip.w) {
          this.buf.put(vx + w - 1, sy, "│", bStyle);
        }
      }
    }
  }

  addHitRegion(vx: number, vy: number, w: number, h: number, id: string, kind: string, data?: unknown): void {
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

const VIEW_TABS_FULL: Array<{ id: TuiViewMode; label: string }> = [
  { id: "roadmap", label: `1 ${VIEW_LABELS.roadmap}` },
  { id: "graph", label: `2 ${VIEW_LABELS.graph}` },
  { id: "activity", label: `3 ${VIEW_LABELS.activity}` },
];

const VIEW_TABS_COMPACT: Array<{ id: TuiViewMode; label: string }> = [
  { id: "roadmap", label: `1 ${VIEW_LABELS.roadmap}` },
  { id: "graph", label: `2 ${VIEW_LABELS.graph}` },
  { id: "activity", label: `3 ${VIEW_LABELS.activity}` },
];

function measurePillRowWidth(labels: string[]): number {
  return (
    labels.reduce((sum, label) => sum + Array.from(label).length + 2, 0) + Math.max(0, labels.length - 1)
  );
}

function drawViewTabs(
  buf: ScreenBuffer,
  startX: number,
  y: number,
  state: TuiState,
  opts: { compact: boolean; inHeader: boolean }
): void {
  const tabs = opts.compact ? VIEW_TABS_COMPACT : VIEW_TABS_FULL;
  let tx = startX;
  for (const tab of tabs) {
    const active = state.viewMode === tab.id;
    const used = drawPill(
      buf,
      tx,
      y,
      tab.label,
      active
        ? { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true }
        : { fg: TUI_PALETTE.muted, bg: opts.inHeader ? TUI_PALETTE.surface2 : TUI_PALETTE.surface },
      { id: `tab-${tab.id}`, kind: "view-tab", data: tab.id }
    );
    tx += used + 1;
  }
}

export function renderHeader(
  buf: ScreenBuffer,
  width: number,
  state: TuiState,
  filtered: FilteredData
): { nextY: number; tabsInHeader: boolean } {
  const { payload } = state;
  const errCount = payload.check.errors.length;
  const warnCount = payload.check.warnings.length;
  const healthLabel = healthText(errCount, warnCount);
  const healthStyle =
    errCount > 0
      ? { fg: TUI_PALETTE.red, bg: TUI_PALETTE.redSoft, bold: true }
      : warnCount > 0
      ? { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft, bold: true }
      : { fg: TUI_PALETTE.green, bg: TUI_PALETTE.greenSoft, bold: true };

  const liveLabel = state.beadsLoading
    ? "◌ Beads…"
    : state.liveWatchActive
    ? "● Live"
    : "● Ready";
  const liveStyle = state.beadsLoading
    ? { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft }
    : { fg: TUI_PALETTE.green, bg: TUI_PALETTE.greenSoft };

  const mouseLabel = state.mouseEnabled ? "Mouse:ON" : "Mouse:OFF";
  const mouseStyle = state.mouseEnabled
    ? { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft }
    : { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface2 };

  const rightPills: Array<{
    label: string;
    style: CellStyle;
    hit?: { id: string; kind: string };
  }> = [
    { label: liveLabel, style: liveStyle, hit: { id: "refresh-btn", kind: "refresh-btn" } },
    { label: healthLabel, style: healthStyle, hit: { id: "health-toggle", kind: "health-toggle" } },
    { label: mouseLabel, style: mouseStyle, hit: { id: "mouse-toggle", kind: "mouse-toggle" } },
    {
      label: "?",
      style: { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 },
      hit: { id: "help-toggle", kind: "help-toggle" },
    },
    {
      label: "q",
      style: { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface2 },
      hit: { id: "quit-btn", kind: "quit-btn" },
    },
  ];

  const totalRightW =
    rightPills.reduce((sum, p) => sum + Array.from(p.label).length + 2, 0) + (rightPills.length - 1);
  const rightStartX = Math.max(1, width - totalRightW - 1);
  const projectTitle = payload.config.project.name || "Project Pulse";
  const reservedLeftW = Math.min(Array.from(projectTitle).length, 22);
  const centerMinX = 1 + reservedLeftW + 2;
  const centerMaxX = rightStartX - 2;
  const centerAvailW = centerMaxX - centerMinX;

  const fullTabsW = measurePillRowWidth(VIEW_TABS_FULL.map((t) => t.label));
  const compactTabsW = measurePillRowWidth(VIEW_TABS_COMPACT.map((t) => t.label));
  const headerTabsMode: "full" | "compact" | "none" =
    centerAvailW >= fullTabsW ? "full" : centerAvailW >= compactTabsW ? "compact" : "none";
  const tabsW =
    headerTabsMode === "full" ? fullTabsW : headerTabsMode === "compact" ? compactTabsW : 0;

  let tabsX = 0;
  if (headerTabsMode !== "none") {
    const idealX = Math.floor((width - tabsW) / 2);
    tabsX =
      idealX >= centerMinX && idealX + tabsW <= centerMaxX
        ? idealX
        : centerMinX + Math.floor((centerAvailW - tabsW) / 2);
  }

  buf.fillRect(0, 0, width, 1, { bg: TUI_PALETTE.surface });
  const titleMax =
    headerTabsMode !== "none" ? Math.max(8, tabsX - 3) : Math.max(12, width - totalRightW - 3);
  buf.writeText(1, 0, projectTitle, titleMax, {
    fg: TUI_PALETTE.text,
    bold: true,
  });

  if (headerTabsMode !== "none") {
    drawViewTabs(buf, tabsX, 0, state, {
      compact: headerTabsMode === "compact",
      inHeader: true,
    });
  }

  let rx = rightStartX;
  for (const p of rightPills) {
    const used = drawPill(buf, rx, 0, p.label, p.style, p.hit);
    rx += used + 1;
  }
  const tabsInHeader = headerTabsMode !== "none";

  let nextY = 1;
  // The summary costs a row; keep it only where rows are plentiful.
  if (state.viewMode !== "graph" && payload.config.project.summary && buf.height >= 30) {
    buf.writeText(1, nextY, payload.config.project.summary, width - 2, { fg: TUI_PALETTE.muted });
    nextY += 1;
  }
  renderDistributionLine(buf, nextY, width, state, filtered);
  return { nextY: nextY + 1, tabsInHeader };
}

export const DISTRIBUTION_STATUSES = ["planned", "in-progress", "shipped", "paused", "cut"] as const;

/**
 * One line of per-status counts (scoped by every filter except status). Each count is a click
 * target that filters by its status; zero-count statuses take no segment at any width.
 */
export function renderDistributionLine(
  buf: ScreenBuffer,
  y: number,
  width: number,
  state: TuiState,
  _filtered: FilteredData
): void {
  buf.fillRect(0, y, width, 1, { bg: TUI_PALETTE.bg });
  const scoped = featuresMatching(state, { ignoreStatus: true });
  const counts = DISTRIBUTION_STATUSES.map((s) => [s, scoped.filter((f) => f.status === s).length] as const).filter(
    ([, n]) => n > 0
  );
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  let x = 1;
  if (total === 0) {
    buf.writeText(x, y, "0 features", width - 2, { fg: TUI_PALETTE.muted });
    return;
  }
  // A proportional bar when there is room for it beside the counts.
  const labels = counts.map(([s, n]) => `${n} ${statusLabel(s)}`);
  const labelsW = labels.reduce((sum, l) => sum + textCellWidth(l) + 3, 0);
  const barW = Math.min(20, width - 2 - labelsW - 2);
  if (barW >= 8) {
    let used = 0;
    counts.forEach(([s, n], i) => {
      const segW = i === counts.length - 1 ? barW - used : Math.max(1, Math.round((n / total) * barW));
      const st = getStatusStyle(s);
      for (let k = 0; k < segW && used + k < barW; k++) buf.put(x + used + k, y, "█", { fg: st.fg });
      buf.addHitRegion({ id: `dist-bar-${s}`, kind: "dist-filter", x: x + used, y, w: Math.max(1, segW), h: 1, zIndex: 10, data: s });
      used += segW;
    });
    x += barW + 2;
  }
  counts.forEach(([s, n], i) => {
    const label = labels[i]!;
    const w = textCellWidth(label);
    if (x + w > width - 1) return;
    const active = state.statusFilter === s;
    const st = getStatusStyle(s);
    buf.writeText(x, y, label, w, active ? { fg: st.fg, bg: st.bg, bold: true } : { fg: st.fg, bold: true });
    buf.addHitRegion({ id: `dist-${s}`, kind: "dist-filter", x, y, w, h: 1, zIndex: 10, data: s });
    x += w;
    if (i < counts.length - 1 && x + 3 < width) {
      buf.writeText(x, y, " · ", 3, { fg: TUI_PALETTE.border });
      x += 3;
    }
  });
}

/** Features passing the active filters; `ignoreStatus` leaves the status filter out. */
export function featuresMatching(state: TuiState, opts: { ignoreStatus?: boolean } = {}): Feature[] {
  const q = state.search.trim().toLowerCase();
  const statusValues = !opts.ignoreStatus && state.statusFilter ? new Set(state.statusFilter.split("|")) : null;
  return state.payload.features.filter((f) => {
    if (state.milestoneFilter && f.milestone !== state.milestoneFilter) return false;
    if (statusValues && !statusValues.has(f.status)) return false;
    if (state.areaFilter && f.area !== state.areaFilter) return false;
    if (q && !(f.title.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q))) {
      return false;
    }
    return true;
  });
}

/** "status: paused, search: \"x\"" — names the active filters for empty states. */
export function describeFilters(state: TuiState): string {
  const parts: string[] = [];
  if (state.milestoneFilter) parts.push(`milestone: ${state.milestoneFilter}`);
  if (state.statusFilter) parts.push(`status: ${state.statusFilter.split("|").map(statusLabel).join(" / ")}`);
  if (state.areaFilter) parts.push(`area: ${state.areaFilter}`);
  if (state.search.trim()) parts.push(`search: "${state.search.trim()}"`);
  return parts.join(", ");
}

export function renderTabsAndFilters(
  buf: ScreenBuffer,
  y: number,
  width: number,
  state: TuiState,
  filtered: FilteredData,
  tabsInHeader = false
): number {
  if (!tabsInHeader) {
    buf.fillRect(0, y, width, 2, { bg: TUI_PALETTE.bg });
    drawViewTabs(buf, 1, y, state, { compact: width < 64, inHeader: false });
  } else {
    buf.fillRect(0, y, width, 1, { bg: TUI_PALETTE.bg });
  }

  const filterY = tabsInHeader ? y : y + 1;
  let fx = 1;

  const filterBtns: Array<{ kind: PickerKind; prefix: string; val: string }> = [
    { kind: "milestone", prefix: "M:", val: state.milestoneFilter || "All" },
    {
      kind: "status",
      prefix: "S:",
      val: state.statusFilter ? state.statusFilter.split("|").map(statusLabel).join(" / ") : "All",
    },
    { kind: "area", prefix: "A:", val: state.areaFilter || "All" },
  ];

  for (const fb of filterBtns) {
    const isOpen = state.openPicker?.kind === fb.kind;
    const activeVal = Boolean(
      (fb.kind === "milestone" && state.milestoneFilter) ||
        (fb.kind === "status" && state.statusFilter) ||
        (fb.kind === "area" && state.areaFilter)
    );
    const label = `${fb.prefix} ${truncateText(fb.val, 14)} ▾`;
    const style: CellStyle = isOpen || activeVal
      ? { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true }
      : { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 };
    const used = drawPill(buf, fx, filterY, label, style, {
      id: `picker-${fb.kind}`,
      kind: "open-picker",
      data: { kind: fb.kind, anchorX: fx, anchorY: filterY + 1 },
    });
    fx += used + 1;
  }

  const searchDisplay = state.search
    ? `/${truncateText(state.search, 18)}${state.searchFocused ? "▏" : ""}`
    : state.searchFocused
    ? "/▏"
    : "/ Search";
  const searchStyle: CellStyle = state.searchFocused || state.search
    ? { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.surface2, bold: state.searchFocused }
    : { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface };
  const usedSearch = drawPill(buf, fx, filterY, searchDisplay, searchStyle, {
    id: "filter-search",
    kind: "focus-search",
  });
  fx += usedSearch + 1;

  const depsLabel = state.showDeps ? "[✓] Deps" : "[ ] Deps";
  const usedDeps = drawPill(
    buf,
    fx,
    filterY,
    depsLabel,
    { fg: state.showDeps ? TUI_PALETTE.text : TUI_PALETTE.muted, bg: TUI_PALETTE.surface2 },
    { id: "toggle-deps", kind: "toggle-deps" }
  );
  fx += usedDeps + 1;

  if (filtered.hasActiveFilters && fx + 9 <= width) {
    drawPill(
      buf,
      fx,
      filterY,
      "Reset",
      { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft, bold: true },
      { id: "filter-reset", kind: "reset-filters" }
    );
  }

  return filterY + 1;
}

/** Feature ids in ledger order: milestone groups in milestone order, rows in feature order. */
export function ledgerOrder(state: TuiState, filtered: FilteredData = computeFilteredData(state)): string[] {
  const ids: string[] = [];
  for (const m of filtered.visibleMilestones) {
    for (const f of filtered.filteredFeatures) if (f.milestone === m.id) ids.push(f.id);
  }
  return ids;
}

interface LedgerColumns {
  title: { x: number; w: number };
  id?: { x: number; w: number };
  crit: { x: number; w: number };
  area?: { x: number; w: number };
  dep: { x: number; w: number };
  latest?: { x: number; w: number };
}

/** Column budget for a ledger row: 80 cols shows mark, title, n/m and the first dependency. */
function ledgerColumns(x0: number, width: number, longestId = 18): LedgerColumns {
  const right = x0 + width - 1;
  // `width` is the inner width (terminal columns minus the frame): 120 columns → 118.
  if (width >= 110) {
    // The id column fits the longest id (up to 26 cells) so ids are never truncated.
    const idW = Math.max(10, Math.min(26, longestId));
    const areaW = width >= 168 ? 16 : 12;
    const depW = 18;
    const critW = 5;
    const fixed = 2 + idW + critW + areaW + depW + 6;
    const flex = Math.max(20, width - fixed - 1);
    const titleW = Math.max(20, Math.floor(flex * 0.55));
    const latestW = Math.max(0, flex - titleW);
    let x = x0 + 3;
    const title = { x, w: titleW };
    x += titleW + 1;
    const id = { x, w: idW };
    x += idW + 1;
    const crit = { x, w: critW };
    x += critW + 1;
    const area = { x, w: areaW };
    x += areaW + 1;
    const dep = { x, w: depW };
    x += depW + 1;
    const latest = { x, w: Math.max(0, Math.min(latestW, right - x)) };
    return { title, id, crit, area, dep, latest };
  }
  const depW = Math.min(20, Math.max(10, Math.floor(width * 0.24)));
  const critW = 5;
  const dep = { x: right - depW + 1, w: depW };
  const crit = { x: dep.x - 1 - critW, w: critW };
  const title = { x: x0 + 3, w: Math.max(8, crit.x - 1 - (x0 + 3)) };
  return { title, crit, dep };
}

/**
 * Roadmap ledger: one row per feature under its milestone group. Rows hold the status mark,
 * title, criteria n/m and the first dependency; wider terminals add the id, area and the latest
 * update. Group headers lay out label and progress inside a measured width budget.
 */
export function renderLedgerView(
  buf: ScreenBuffer,
  rect: Rect,
  state: TuiState,
  filtered: FilteredData
): { maxScrollY: number; orderedFeatureIds: string[]; featureBounds: Map<string, { y: number; h: number }> } {
  const { payload } = state;
  const orderedFeatureIds: string[] = [];
  const featureBounds = new Map<string, { y: number; h: number }>();
  const x0 = rect.x + 1;
  const width = Math.max(20, rect.w - 2);

  if (payload.features.length === 0 && !filtered.hasActiveFilters) {
    buf.writeText(x0, rect.y + 1, "No features yet.", width, { fg: TUI_PALETTE.text, bold: true });
    buf.writeText(x0, rect.y + 2, "Add one with pp feature add <id> --title \"…\" --milestone <milestone>.", width, {
      fg: TUI_PALETTE.muted,
    });
    return { maxScrollY: 0, orderedFeatureIds, featureBounds };
  }
  if (filtered.filteredFeatures.length === 0 && (filtered.hasFeatureFilter || filtered.visibleMilestones.length === 0)) {
    renderFilteredEmpty(buf, rect, state, "features");
    return { maxScrollY: 0, orderedFeatureIds, featureBounds };
  }

  const cols = ledgerColumns(x0, width, Math.max(0, ...payload.features.map((f) => textCellWidth(f.id))));
  type DrawOp = (w: ClipWriter) => void;
  const ops: DrawOp[] = [];
  let vy = 0;

  filtered.visibleMilestones.forEach((m, gi) => {
    const all = payload.features.filter((f) => f.milestone === m.id);
    const rows = filtered.filteredFeatures.filter((f) => f.milestone === m.id);
    const shipped = all.filter((f) => f.status === "shipped").length;
    const gy = vy;
    ops.push((cw) => {
      cw.fillRect(x0 - 1, gy, width + 2, 1, { bg: TUI_PALETTE.surface });
      // Right side first (progress), then the label shrinks to what is left.
      const progress = `${shipped}/${all.length} shipped`;
      const barW = width >= 60 ? 8 : 0;
      const rightW = textCellWidth(progress) + (barW ? barW + 1 : 0);
      const rightX = x0 + width - rightW;
      cw.writeText(rightX, gy, progress, textCellWidth(progress), { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface });
      if (barW) cw.drawProgress(rightX + textCellWidth(progress) + 1, gy, barW, shipped, all.length, TUI_PALETTE.green);
      const mSt = getStatusStyle(m.status);
      const statusTxt = `${mSt.icon} ${statusLabel(m.status)}`;
      const budget = rightX - 2 - x0;
      const parts: Array<{ text: string; style: CellStyle; optional: number }> = [
        { text: m.id, style: { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface }, optional: 2 },
        { text: statusTxt, style: { fg: mSt.fg, bg: TUI_PALETTE.surface, bold: true }, optional: 3 },
        { text: m.target ?? "", style: { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface }, optional: 1 },
      ].filter((p) => p.text);
      // Drop optional parts (target first, then id, then status) until the title keeps 12 cells.
      const minTitle = Math.min(12, textCellWidth(m.title));
      let kept = parts.slice();
      const extraW = () => kept.reduce((sum, p) => sum + textCellWidth(p.text) + 2, 0);
      while (kept.length > 0 && budget - extraW() < minTitle) {
        const drop = kept.reduce((lo, p) => (p.optional < lo.optional ? p : lo), kept[0]!);
        kept = kept.filter((p) => p !== drop);
      }
      const titleW = Math.max(1, Math.min(textCellWidth(m.title), budget - extraW()));
      let hx = x0;
      cw.writeText(hx, gy, m.title, titleW, { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface, bold: true });
      hx += titleW + 2;
      for (const p of kept) {
        const w = textCellWidth(p.text);
        cw.writeText(hx, gy, p.text, w, p.style);
        hx += w + 2;
      }
    });
    vy += 1;

    if (rows.length === 0) {
      const ey = vy;
      const msg = all.length === 0 ? "No features yet." : `No features match ${describeFilters(state)}.`;
      ops.push((cw) => cw.writeText(x0 + 2, ey, msg, width - 2, { fg: TUI_PALETTE.muted }));
      vy += 1;
    }

    for (const f of rows) {
      orderedFeatureIds.push(f.id);
      const ry = vy;
      featureBounds.set(f.id, { y: ry, h: 1 });
      ops.push((cw) => {
        const sel = state.selectedFeatureId === f.id;
        const bg = sel ? TUI_PALETTE.accentSoft : TUI_PALETTE.bg;
        cw.fillRect(x0 - 1, ry, width + 2, 1, { bg });
        const st = getStatusStyle(f.status);
        cw.writeText(x0, ry, st.icon, 1, { fg: st.fg, bg, bold: true });
        cw.writeText(cols.title.x, ry, f.title, cols.title.w, { fg: TUI_PALETTE.text, bg, bold: sel });
        if (cols.id) cw.writeText(cols.id.x, ry, f.id, cols.id.w, { fg: TUI_PALETTE.muted, bg });
        const done = f.ship_criteria.filter((c) => c.done).length;
        const total = f.ship_criteria.length;
        const crit = total ? `${done}/${total}` : "—";
        cw.writeText(cols.crit.x + Math.max(0, cols.crit.w - textCellWidth(crit)), ry, crit, cols.crit.w, {
          fg: total && done === total ? TUI_PALETTE.green : TUI_PALETTE.muted,
          bg,
        });
        if (cols.area) cw.writeText(cols.area.x, ry, f.area ?? "—", cols.area.w, { fg: TUI_PALETTE.slate, bg });
        const firstDep = state.showDeps && f.depends_on.length ? `→ ${f.depends_on[0]}${f.depends_on.length > 1 ? ` +${f.depends_on.length - 1}` : ""}` : "";
        if (firstDep) cw.writeText(cols.dep.x, ry, firstDep, cols.dep.w, { fg: TUI_PALETTE.muted, bg });
        if (cols.latest && cols.latest.w > 4) {
          const latest = f.updates.length ? f.updates[f.updates.length - 1]!.note : "";
          if (latest) cw.writeText(cols.latest.x, ry, latest, cols.latest.w, { fg: TUI_PALETTE.muted, bg });
        }
        cw.addHitRegion(x0 - 1, ry, width + 2, 1, `row-${f.id}`, "feature-card", f.id);
      });
      vy += 1;
    }
    if (gi < filtered.visibleMilestones.length - 1) vy += 1;
  });

  const maxScrollY = Math.max(0, vy - rect.h);
  state.roadmapScrollY = Math.max(0, Math.min(state.roadmapScrollY, maxScrollY));
  const writer = new ClipWriter(buf, rect, state.roadmapScrollY, 8);
  for (const op of ops) op(writer);
  if (maxScrollY > 0 && state.roadmapScrollY < maxScrollY) {
    const more = `▼ ${vy - rect.h - state.roadmapScrollY} more`;
    buf.writeText(rect.x + rect.w - 1 - textCellWidth(more), rect.y + rect.h - 1, more, textCellWidth(more), {
      fg: TUI_PALETTE.muted,
      bg: TUI_PALETTE.bg,
    });
  }
  return { maxScrollY, orderedFeatureIds, featureBounds };
}

/** Empty state for a filtered-out view: names the filter and offers a keyboard-accessible reset. */
export function renderFilteredEmpty(buf: ScreenBuffer, rect: Rect, state: TuiState, what: "features" | "changes"): void {
  const x0 = rect.x + 1;
  const w = Math.max(10, rect.w - 2);
  buf.writeText(x0, rect.y + 1, `No ${what} match ${describeFilters(state)}.`, w, { fg: TUI_PALETTE.text, bold: true });
  const used = drawPill(
    buf,
    x0,
    rect.y + 3,
    "c Clear filters",
    { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true },
    { id: "empty-reset", kind: "reset-filters" }
  );
  buf.writeText(x0 + used + 1, rect.y + 3, "press c or click to show everything", w - used - 1, { fg: TUI_PALETTE.muted });
}

export function renderFloatingPicker(
  buf: ScreenBuffer,
  width: number,
  height: number,
  state: TuiState
): void {
  const picker = state.openPicker;
  if (!picker) return;

  buf.addHitRegion({
    id: "picker-backdrop",
    kind: "picker-backdrop",
    x: 0,
    y: 0,
    w: width,
    h: height,
    zIndex: HitLayer.pickerBackdrop,
  });

  const maxLabelLen = picker.options.reduce((m, o) => Math.max(m, o.label.length), 14);
  const w = Math.min(width - 2, Math.max(22, maxLabelLen + 6));
  const h = Math.min(height - 2, picker.options.length + 2);
  const x = Math.max(1, Math.min(picker.x, width - w - 1));
  const y = Math.max(1, Math.min(picker.y, height - h - 1));

  const currentValue =
    picker.kind === "milestone"
      ? state.milestoneFilter
      : picker.kind === "status"
      ? state.statusFilter
      : state.areaFilter;

  const maxRows = pickerVisibleRows(height, picker.options.length);
  const total = picker.options.length;
  // Wheel-driven offset, clamped only: keyboard movement moves the window itself so
  // wheeling away from the focused option is never undone by a render.
  state.pickerScrollY = Math.max(0, Math.min(state.pickerScrollY, Math.max(0, total - maxRows)));

  buf.drawBox(x, y, w, h, {
    borderStyle: { fg: TUI_PALETTE.accent },
    fillStyle: { bg: TUI_PALETTE.surface },
    title: `Filter ${picker.kind}`,
    titleStyle: { fg: TUI_PALETTE.accent, bold: true },
  });

  const visibleRows = Math.min(maxRows, total - state.pickerScrollY);
  for (let row = 0; row < visibleRows; row++) {
    const i = state.pickerScrollY + row;
    const opt = picker.options[i]!;
    const rowY = y + 1 + row;
    const isFocused = i === state.pickerSelectedIndex;
    const isChecked = opt.value === currentValue;
    if (isFocused) {
      buf.fillRect(x + 1, rowY, w - 2, 1, { bg: TUI_PALETTE.accentSoft });
    }
    const prefix = isChecked ? "● " : "  ";
    buf.writeText(x + 2, rowY, prefix + opt.label, w - 4, {
      fg: isFocused ? TUI_PALETTE.accent : isChecked ? TUI_PALETTE.text : TUI_PALETTE.muted,
      bold: isFocused || isChecked,
    });
    buf.addHitRegion({
      id: `picker-opt-${i}`,
      kind: "picker-option",
      x: x + 1,
      y: rowY,
      w: w - 2,
      h: 1,
      zIndex: HitLayer.pickerOption,
      data: { kind: picker.kind, value: opt.value },
    });
  }
}

export function renderHealthOverlay(
  buf: ScreenBuffer,
  width: number,
  height: number,
  state: TuiState
): void {
  if (!state.healthPanelOpen) return;

  buf.addHitRegion({ id: "health-backdrop", kind: "health-backdrop", x: 0, y: 0, w: width, h: height, zIndex: HitLayer.healthBackdrop });

  const w = Math.max(20, Math.min(width - 4, 92));
  const innerW = w - 4;
  const featureIds = new Set(state.payload.features.map((f) => f.id));
  const issues: Array<{ level: "error" | "warning"; item: ValidationIssue }> = [
    ...state.payload.check.errors.map((item) => ({ level: "error" as const, item })),
    ...state.payload.check.warnings.map((item) => ({ level: "warning" as const, item })),
  ];

  // Content rows: each paints itself at a screen row. Messages wrap (remedies included).
  type Row = (y: number, x: number) => void;
  const rows: Row[] = [];
  const text = (t: string, style: CellStyle) => {
    for (const line of wrapCells(t, innerW)) rows.push((y, x) => buf.writeText(x, y, line, innerW, style));
  };
  if (state.loadError) {
    text(`Last reload failed: ${state.loadError}`, { fg: TUI_PALETTE.red });
    rows.push(() => {});
  }
  if (issues.length === 0) {
    const beadsWanted = !state.noBeads && state.payload.config.integrations.beads.enabled;
    if (!beadsWanted) {
      text("Schema, DAG, and ROADMAP.md sync checks passed (0 errors, 0 warnings).", { fg: TUI_PALETTE.green });
      text("Beads checks skipped (--no-beads or integrations.beads.enabled=false).", { fg: TUI_PALETTE.amber });
    } else if (state.beadsLoading) {
      text("Schema, DAG, and ROADMAP.md sync checks passed (0 errors, 0 warnings).", { fg: TUI_PALETTE.green });
      text("Beads checks pending…", { fg: TUI_PALETTE.amber });
    } else {
      text("All schema, DAG, ROADMAP.md sync, and Beads checks passed (0 errors, 0 warnings).", { fg: TUI_PALETTE.green });
    }
  } else {
    issues.forEach(({ level, item }, i) => {
      const st = level === "error" ? { fg: TUI_PALETTE.red, bg: TUI_PALETTE.redSoft } : { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft };
      const hasJump = Boolean(item.entityId && featureIds.has(item.entityId));
      rows.push((y, x) => {
        drawPill(buf, x - 1, y, item.code, { ...st, bold: true });
        if (hasJump && item.entityId) {
          const label = `Inspect ${item.entityId}`;
          const lw = textCellWidth(label) + 2;
          drawPill(buf, x + innerW - lw, y, label, { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true }, {
            id: `health-jump-${item.entityId}`,
            kind: "health-jump",
            zIndex: HitLayer.healthControl,
            data: item.entityId,
          });
        }
      });
      text(item.message, { fg: TUI_PALETTE.text });
      if (i < issues.length - 1) rows.push(() => {});
    });
  }

  // Frame: border + title/close row + blank + content + border; sized to content.
  const chrome = 4;
  const h = Math.max(6, Math.min(height - 2, rows.length + chrome));
  const x = Math.max(1, Math.floor((width - w) / 2));
  const y = Math.max(1, Math.floor((height - h) / 2));
  buf.drawBox(x, y, w, h, {
    borderStyle: { fg: TUI_PALETTE.accent },
    fillStyle: { bg: TUI_PALETTE.surface },
    title: "Health",
    titleStyle: { fg: TUI_PALETTE.text, bold: true },
  });
  drawPill(buf, x + w - 9, y + 1, "Close", { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 }, {
    id: "health-close",
    kind: "health-close",
    zIndex: HitLayer.healthControl,
  });
  const top = y + 2;
  const visible = Math.max(1, h - chrome);
  const maxScroll = Math.max(0, rows.length - visible);
  state.healthScrollY = Math.max(0, Math.min(state.healthScrollY, maxScroll));
  for (let i = 0; i < visible && state.healthScrollY + i < rows.length; i++) {
    rows[state.healthScrollY + i]!(top + i, x + 2);
  }
  if (maxScroll > 0) {
    const hint = state.healthScrollY < maxScroll
      ? `▼ ${rows.length - visible - state.healthScrollY} more · PgDn`
      : "▲ PgUp";
    buf.writeText(x + w - 2 - textCellWidth(hint), y + h - 1, hint, textCellWidth(hint), { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface });
  }
}

export type FooterMode =
  | "roadmap"
  | "graph"
  | "activity"
  | "drawer"
  | "note"
  | "confirm"
  | "picker"
  | "health"
  | "help"
  | "search";

export function footerMode(state: TuiState): FooterMode {
  if (state.helpOpen) return "help";
  if (state.healthPanelOpen) return "health";
  if (state.openPicker) return "picker";
  if (state.searchFocused) return "search";
  const drawerOpen = Boolean(state.drawerFeatureId && state.payload.features.some((f) => f.id === state.drawerFeatureId));
  if (drawerOpen && state.drawerFocus === "note") return "note";
  if (drawerOpen && state.pendingShip) return "confirm";
  if (drawerOpen) return "drawer";
  return state.viewMode;
}

export function footerHints(state: TuiState): string[] {
  const filters = Boolean(state.milestoneFilter || state.statusFilter || state.areaFilter || state.search);
  const frozen = state.payload.check.editable === false;
  switch (footerMode(state)) {
    case "help":
      return ["Esc Close"];
    case "health":
      return ["PgUp/PgDn Scroll", "Esc Close"];
    case "picker":
      return ["j/k Move", "Enter Choose", "Esc Close"];
    case "search":
      return ["Type to filter", "Enter Done"];
    case "note":
      return ["Type a note", "Enter Log", "Esc Done"];
    case "confirm":
      return ["←/→ Choose", "Enter Confirm", "Esc Cancel"];
    case "drawer":
      return [
        ...(state.drawerFeedback?.kind === "err" ? ["x Dismiss"] : []),
        ...(frozen ? ["e Health"] : []),
        "Tab Focus",
        "Space Toggle",
        "←/→ Status",
        "n Note",
        "PgDn Scroll",
        "Esc Close",
      ];
    case "graph":
      return ["j/k Select", "Enter Open", "+/- Zoom", "f Fit", "←/→ Pan", ...(filters ? ["c Clear"] : []), "1/2/3 Views", "R Refresh", "h Hover"];
    case "activity":
      return ["j/k Move", "Enter Open", "w Window", ...(filters ? ["c Clear"] : []), "1/2/3 Views", "R Refresh"];
    default:
      return ["j/k Move", "Enter Open", "/ Search", "s Status", ...(filters ? ["c Clear"] : []), "1/2/3 Views", "R Refresh", "y Copy ID", "m Mouse"];
  }
}

export const FOOTER_SUFFIX = "? Help · q Quit";
export const FOOTER_SUFFIX_TYPING = "Esc first: ? Help · q Quit";

/**
 * Footer: the active mode's keys, whole hints only, always ending with "? Help · q Quit" (prefixed
 * with "Esc first:" while typing). A notification replaces the hints, never the suffix.
 */
export function renderFooter(buf: ScreenBuffer, y: number, width: number, state: TuiState): void {
  buf.fillRect(0, y, width, 1, { bg: TUI_PALETTE.surface });
  const mode = footerMode(state);
  const suffix = mode === "note" || mode === "search" ? FOOTER_SUFFIX_TYPING : FOOTER_SUFFIX;
  const suffixW = textCellWidth(suffix);
  const suffixX = Math.max(1, width - 1 - suffixW);
  buf.writeText(suffixX, y, suffix, suffixW, { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface });
  const avail = suffixX - 3;
  if (avail <= 0) return;
  if (state.toast) {
    const fg = state.toast.kind === "err" ? TUI_PALETTE.red : state.toast.kind === "ok" ? TUI_PALETTE.green : TUI_PALETTE.accent;
    buf.writeText(1, y, state.toast.message, avail, { fg, bg: TUI_PALETTE.surface, bold: true });
    return;
  }
  let line = "";
  for (const hint of footerHints(state)) {
    const next = line ? `${line} · ${hint}` : hint;
    if (textCellWidth(next) > avail) break;
    line = next;
  }
  buf.writeText(1, y, line, avail, { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface });
}
