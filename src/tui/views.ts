import type { BeadStatusInfo, Feature, FeatureStatus, Milestone, ValidationIssue } from "../types";
import type { RoadmapViewPayload } from "../dashboard-html";
import { ScreenBuffer, TUI_PALETTE, truncateText, type CellStyle, type PaletteColor } from "./screen";

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

export type TuiViewMode = "cards" | "graph" | "board";
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

export interface GraphCameraState {
  zoom: GraphZoomLevel;
  tx: number;
  ty: number;
  initialized: boolean;
  layoutKey: string;
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
  noteDrafts: Record<string, string>;
  noteCursor: number;
  cardsScrollY: number;
  boardScrollY: Record<string, number>;
  boardActiveCol: number;
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
  drawerFeedback: TuiFeedback | null;
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
      return { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft, icon: "⏸" };
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
    viewMode: "cards",
    milestoneFilter: "",
    statusFilter: "",
    areaFilter: "",
    search: "",
    searchFocused: false,
    showDeps: true,
    healthPanelOpen: false,
    helpOpen: false,
    selectedFeatureId: payload.features[0]?.id ?? null,
    drawerFeatureId: null,
    drawerScrollY: 0,
    drawerFocus: "criteria",
    drawerCriterionIndex: 0,
    noteDrafts: {},
    noteCursor: 0,
    cardsScrollY: 0,
    boardScrollY: {},
    boardActiveCol: 0,
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
      { value: "planned", label: "planned" },
      { value: "in-progress", label: "in-progress" },
      { value: "shipped", label: "shipped" },
      { value: "paused", label: "paused" },
      { value: "cut", label: "cut" },
      { value: "paused|cut", label: "paused / cut" },
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
  { id: "cards", label: "1 Milestone Cards" },
  { id: "graph", label: "2 Dependency Graph" },
  { id: "board", label: "3 Status Board" },
];

const VIEW_TABS_COMPACT: Array<{ id: TuiViewMode; label: string }> = [
  { id: "cards", label: "1 Cards" },
  { id: "graph", label: "2 Graph" },
  { id: "board", label: "3 Board" },
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

export function renderHeaderAndKpis(
  buf: ScreenBuffer,
  width: number,
  state: TuiState,
  filtered: FilteredData
): { nextY: number; tabsInHeader: boolean } {
  const { payload } = state;
  const errCount = payload.check.errors.length;
  const warnCount = payload.check.warnings.length;
  const healthLabel =
    errCount > 0 ? `${errCount} err` : warnCount > 0 ? `${warnCount} warn` : "Check OK";
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
  if (state.viewMode !== "graph" && payload.config.project.summary) {
    buf.writeText(1, nextY, payload.config.project.summary, width - 2, { fg: TUI_PALETTE.muted });
    nextY += 1;
  }

  const statFeatures = filtered.hasActiveFilters ? filtered.filteredFeatures : payload.features;
  const shipped = statFeatures.filter((f) => f.status === "shipped").length;
  const inProgress = statFeatures.filter((f) => f.status === "in-progress").length;
  const planned = statFeatures.filter((f) => f.status === "planned").length;
  const pausedOrCut = statFeatures.filter((f) => f.status === "paused" || f.status === "cut").length;

  const kpis = [
    {
      id: "kpi-milestones",
      filterValue: "",
      label: "MILESTONES",
      value:
        filtered.hasActiveFilters && filtered.visibleMilestones.length !== payload.milestones.length
          ? `${filtered.visibleMilestones.length}/${payload.milestones.length}`
          : String(filtered.visibleMilestones.length),
      fg: TUI_PALETTE.text,
    },
    {
      id: "kpi-features",
      filterValue: "",
      label: "FEATURES",
      value:
        filtered.hasActiveFilters && statFeatures.length !== payload.features.length
          ? `${statFeatures.length}/${payload.features.length}`
          : String(statFeatures.length),
      fg: TUI_PALETTE.text,
    },
    { id: "kpi-shipped", filterValue: "shipped", label: "SHIPPED", value: String(shipped), fg: TUI_PALETTE.green },
    { id: "kpi-active", filterValue: "in-progress", label: "ACTIVE", value: String(inProgress), fg: TUI_PALETTE.accent },
    { id: "kpi-planned", filterValue: "planned", label: "PLANNED", value: String(planned), fg: TUI_PALETTE.slate },
    { id: "kpi-paused", filterValue: "paused|cut", label: "PAUSED/CUT", value: String(pausedOrCut), fg: TUI_PALETTE.amber },
  ];

  if (state.viewMode === "graph" || width < 90) {
    buf.fillRect(0, nextY, width, 1, { bg: TUI_PALETTE.bg });
    let kx = 1;
    for (const k of kpis) {
      const seg = `${k.label}: ${k.value}`;
      if (kx + seg.length + 2 >= width) break;
      const activeKpi = Boolean(k.filterValue && state.statusFilter === k.filterValue);
      buf.writeText(kx, nextY, `${k.label}: `, seg.length, {
        fg: activeKpi ? TUI_PALETTE.accent : TUI_PALETTE.muted,
        bold: activeKpi,
      });
      buf.writeText(kx + k.label.length + 2, nextY, k.value, k.value.length, { fg: k.fg, bold: true });
      buf.addHitRegion({
        id: k.id,
        kind: "kpi-filter",
        x: kx,
        y: nextY,
        w: seg.length,
        h: 1,
        zIndex: 10,
        data: k.filterValue,
      });
      kx += seg.length + 2;
    }
    return { nextY: nextY + 1, tabsInHeader };
  }

  const gap = 1;
  const usableW = Math.max(60, width - 2);
  const boxW = Math.floor((usableW - gap * (kpis.length - 1)) / kpis.length);
  for (let i = 0; i < kpis.length; i++) {
    const k = kpis[i]!;
    const bx = 1 + i * (boxW + gap);
    const bw = i === kpis.length - 1 ? width - 1 - bx : boxW;
    const activeKpi = Boolean(k.filterValue && state.statusFilter === k.filterValue);
    buf.drawBox(bx, nextY, bw, 3, {
      borderStyle: { fg: activeKpi ? TUI_PALETTE.accent : TUI_PALETTE.border },
      fillStyle: { bg: activeKpi ? TUI_PALETTE.accentSoft : TUI_PALETTE.surface },
    });
    buf.writeText(bx + 2, nextY + 1, k.label, Math.max(1, bw - 3 - k.value.length), {
      fg: activeKpi ? TUI_PALETTE.accent : TUI_PALETTE.muted,
      bold: activeKpi,
    });
    buf.writeText(bx + bw - 2 - k.value.length, nextY + 1, k.value, k.value.length, {
      fg: k.fg,
      bold: true,
    });
    buf.addHitRegion({
      id: k.id,
      kind: "kpi-filter",
      x: bx,
      y: nextY,
      w: bw,
      h: 3,
      zIndex: 10,
      data: k.filterValue,
    });
  }
  return { nextY: nextY + 3, tabsInHeader };
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
      val: state.statusFilter ? state.statusFilter.split("|").join(" / ") : "All",
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

export function renderCardsView(
  buf: ScreenBuffer,
  rect: Rect,
  state: TuiState,
  filtered: FilteredData
): { maxScrollY: number; orderedFeatureIds: string[]; featureBounds: Map<string, { y: number; h: number }> } {
  const { payload } = state;
  const q = state.search.trim().toLowerCase();
  const orderedFeatureIds: string[] = [];
  // Virtual (pre-scroll) row geometry per feature so keyboard selection can reveal itself.
  const featureBounds = new Map<string, { y: number; h: number }>();

  if (filtered.visibleMilestones.length === 0) {
    const msg =
      state.statusFilter || state.areaFilter || q
        ? "No features match the active filter."
        : "No milestones match the active filter.";
    buf.writeText(rect.x + 1, rect.y + 1, msg, rect.w - 2, { fg: TUI_PALETTE.muted });
    return { maxScrollY: 0, orderedFeatureIds, featureBounds };
  }

  const cols = rect.w >= 108 ? 3 : rect.w >= 68 ? 2 : 1;
  const innerPad = 2;
  const gapX = 2;
  const gapY = 1;
  const cardH = 6;
  const sectionPadX = rect.x + 1;
  const sectionW = Math.max(24, rect.w - 2);
  const gridW = Math.max(20, sectionW - innerPad * 2);
  const colW = Math.floor((gridW - gapX * (cols - 1)) / cols);

  let vy = 0;
  type DrawOp = (w: ClipWriter) => void;
  const ops: DrawOp[] = [];

  for (const m of filtered.visibleMilestones) {
    const allMFeatures = payload.features.filter((f) => f.milestone === m.id);
    const mFeatures = allMFeatures.filter((f) => {
      if (filtered.statusFilterValues && !filtered.statusFilterValues.has(f.status)) return false;
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

    const mShipped = allMFeatures.filter((f) => f.status === "shipped").length;
    const pct = allMFeatures.length ? Math.round((mShipped / allMFeatures.length) * 100) : 0;
    const rowsNeeded = Math.max(1, Math.ceil(mFeatures.length / cols));
    const gridH =
      mFeatures.length === 0 ? 1 : rowsNeeded * cardH + Math.max(0, rowsNeeded - 1) * gapY;
    const hasDesc = Boolean(m.description);
    const headerLines = hasDesc ? 4 : 3;
    const boxH = headerLines + gridH + 1;
    const secStartY = vy;
    const mSt = getStatusStyle(m.status);

    ops.push((cw) => {
      cw.drawBox(sectionPadX, secStartY, sectionW, boxH, {
        borderStyle: { fg: TUI_PALETTE.border },
        fillStyle: { bg: TUI_PALETTE.surface },
      });

      const progressStr = `${mShipped}/${allMFeatures.length} shipped (${pct}%)`;
      const targetStr = m.target ? ` [${m.target}]` : "";
      const headLeftMax = Math.max(12, sectionW - progressStr.length - targetStr.length - 16);
      let hx = sectionPadX + innerPad;
      const titleLen = Math.min(headLeftMax, Array.from(m.title).length);
      cw.writeText(hx, secStartY + 1, m.title, titleLen, { fg: TUI_PALETTE.text, bold: true });
      hx += titleLen + 1;
      const idChip = ` ${m.id} `;
      cw.fillRect(hx, secStartY + 1, idChip.length, 1, { bg: TUI_PALETTE.surface2 });
      cw.writeText(hx, secStartY + 1, idChip, idChip.length, { fg: TUI_PALETTE.muted });
      hx += idChip.length + 1;
      const stBadge = ` ${m.status} `;
      cw.fillRect(hx, secStartY + 1, stBadge.length, 1, { bg: mSt.bg });
      cw.writeText(hx, secStartY + 1, stBadge, stBadge.length, { fg: mSt.fg, bold: true });
      if (targetStr) {
        cw.writeText(hx + stBadge.length + 1, secStartY + 1, targetStr.trim(), targetStr.length, {
          fg: TUI_PALETTE.muted,
        });
      }
      cw.writeText(
        sectionPadX + sectionW - innerPad - progressStr.length,
        secStartY + 1,
        progressStr,
        progressStr.length,
        { fg: TUI_PALETTE.muted }
      );

      let lineY = secStartY + 2;
      if (hasDesc) {
        cw.writeText(sectionPadX + innerPad, lineY, m.description, sectionW - innerPad * 2, {
          fg: TUI_PALETTE.muted,
        });
        lineY += 1;
      }
      cw.drawProgress(
        sectionPadX + innerPad,
        lineY,
        Math.max(10, sectionW - innerPad * 2),
        mShipped,
        allMFeatures.length,
        TUI_PALETTE.green
      );
      lineY += 1;

      if (mFeatures.length === 0) {
        cw.writeText(
          sectionPadX + innerPad,
          lineY,
          "No features match in this milestone.",
          sectionW - innerPad * 2,
          { fg: TUI_PALETTE.muted }
        );
      }
    });

    if (mFeatures.length > 0) {
      const cardsStartY = secStartY + headerLines;
      mFeatures.forEach((f, idx) => {
        orderedFeatureIds.push(f.id);
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cx = sectionPadX + innerPad + col * (colW + gapX);
        const cy = cardsStartY + row * (cardH + gapY);
        featureBounds.set(f.id, { y: cy, h: cardH });
        const cwActual = col === cols - 1 ? sectionPadX + sectionW - innerPad - cx : colW;

        ops.push((cw) => {
          const isSel = state.selectedFeatureId === f.id;
          const fSt = getStatusStyle(f.status);
          const done = f.ship_criteria.filter((c) => c.done).length;
          const total = f.ship_criteria.length;
          const latest = f.updates.length ? f.updates[f.updates.length - 1] : null;
          const beads = (payload.beads && payload.beads[f.id]) || [];

          cw.drawBox(cx, cy, cwActual, cardH, {
            borderStyle: { fg: isSel ? TUI_PALETTE.accent : TUI_PALETTE.border },
            fillStyle: { bg: TUI_PALETTE.surface2 },
          });
          cw.addHitRegion(cx, cy, cwActual, cardH, `card-${f.id}`, "feature-card", f.id);

          const stLabel = ` ${fSt.icon} ${f.status} `;
          const innerW = Math.max(8, cwActual - 4);
          cw.writeText(cx + 2, cy + 1, f.title, Math.max(4, innerW - stLabel.length - 1), {
            fg: TUI_PALETTE.text,
            bold: true,
          });
          const pillX = cx + cwActual - 2 - stLabel.length;
          if (pillX > cx + 2) {
            cw.fillRect(pillX, cy + 1, stLabel.length, 1, { bg: fSt.bg });
            cw.writeText(pillX, cy + 1, stLabel, stLabel.length, { fg: fSt.fg, bold: true });
          }

          const areaText = f.area ?? "";
          cw.writeText(cx + 2, cy + 2, f.id, Math.max(4, innerW - areaText.length - 1), {
            fg: TUI_PALETTE.muted,
          });
          if (areaText) {
            cw.writeText(cx + cwActual - 2 - areaText.length, cy + 2, areaText, areaText.length, {
              fg: TUI_PALETTE.slate,
            });
          }

          const critStr = total > 0 ? `${done}/${total} criteria` : "No criteria";
          cw.writeText(cx + 2, cy + 3, critStr, Math.min(16, innerW), { fg: TUI_PALETTE.muted });
          if (total > 0 && innerW > 20) {
            cw.drawProgress(
              cx + 2 + critStr.length + 1,
              cy + 3,
              Math.min(12, innerW - critStr.length - 1),
              done,
              total,
              done === total ? TUI_PALETTE.green : TUI_PALETTE.accent
            );
          }

          let footerLine = "";
          let footerFg: PaletteColor = TUI_PALETTE.muted;
          if (state.showDeps && f.depends_on.length > 0) {
            footerLine = `deps: ${f.depends_on.join(", ")}`;
          } else if (beads.length > 0) {
            const firstB = beads[0]!;
            const bState = firstB.available ? (firstB.found ? `[${firstB.status}]` : "[missing]") : "";
            footerLine = `${firstB.ref} ${bState}`.trim();
            footerFg = firstB.found
              ? firstB.status === "closed"
                ? TUI_PALETTE.green
                : TUI_PALETTE.accent
              : TUI_PALETTE.red;
          } else if (latest) {
            footerLine = `> ${latest.note}`;
          } else if (f.description) {
            footerLine = f.description;
          }
          if (footerLine) {
            cw.writeText(cx + 2, cy + 4, footerLine, innerW, { fg: footerFg });
          }
        });
      });
    }

    vy += boxH + 1;
  }

  const maxScrollY = Math.max(0, vy - 1 - rect.h);
  const clampedScroll = Math.max(0, Math.min(state.cardsScrollY, maxScrollY));
  state.cardsScrollY = clampedScroll;

  const writer = new ClipWriter(buf, rect, clampedScroll, 8);
  for (const op of ops) op(writer);

  return { maxScrollY, orderedFeatureIds, featureBounds };
}

export function renderBoardView(
  buf: ScreenBuffer,
  rect: Rect,
  state: TuiState,
  filtered: FilteredData
): {
  columns: FeatureStatus[];
  orderedFeatureIds: string[];
  featureBounds: Map<string, { y: number; h: number }>;
  columnViewports: Map<FeatureStatus, { y: number; h: number; maxScroll: number }>;
} {
  const columns: FeatureStatus[] = ["planned", "in-progress", "shipped"];
  const statusValues = filtered.statusFilterValues;
  if ((statusValues?.has("paused") ?? false) || state.payload.features.some((f) => f.status === "paused")) {
    columns.push("paused");
  }
  if ((statusValues?.has("cut") ?? false) || state.payload.features.some((f) => f.status === "cut")) {
    columns.push("cut");
  }

  const labels: Record<FeatureStatus, string> = {
    planned: "Planned",
    "in-progress": "In Progress",
    shipped: "Shipped",
    paused: "Paused",
    cut: "Cut",
  };

  const orderedFeatureIds: string[] = [];
  // Per-column viewport (screen rect + scroll cap) and per-card virtual geometry so
  // keyboard selection can reveal itself in its own column.
  const featureBounds = new Map<string, { y: number; h: number }>();
  const columnViewports = new Map<FeatureStatus, { y: number; h: number; maxScroll: number }>();

  if (rect.w < 90) {
    state.boardActiveCol = Math.max(0, Math.min(state.boardActiveCol, columns.length - 1));
    let tx = rect.x + 1;
    columns.forEach((col, idx) => {
      const count = filtered.filteredFeatures.filter((f) => f.status === col).length;
      const active = idx === state.boardActiveCol;
      const st = getStatusStyle(col);
      const used = drawPill(
        buf,
        tx,
        rect.y,
        `${labels[col]} (${count})`,
        active ? { fg: st.fg, bg: st.bg, bold: true } : { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface2 },
        { id: `board-tab-${col}`, kind: "board-tab", data: idx }
      );
      tx += used + 1;
    });

    const activeStatus = columns[state.boardActiveCol] ?? "planned";
    const colFeatures = filtered.filteredFeatures.filter((f) => f.status === activeStatus);
    colFeatures.forEach((f) => orderedFeatureIds.push(f.id));
    renderBoardColumn(
      buf,
      { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: Math.max(4, rect.h - 1) },
      activeStatus,
      labels[activeStatus],
      colFeatures,
      state,
      featureBounds,
      columnViewports
    );
    return { columns, orderedFeatureIds, featureBounds, columnViewports };
  }

  const gap = 1;
  const colW = Math.floor((rect.w - 2 - gap * (columns.length - 1)) / columns.length);
  columns.forEach((colStatus, idx) => {
    const cx = rect.x + 1 + idx * (colW + gap);
    const w = idx === columns.length - 1 ? rect.x + rect.w - 1 - cx : colW;
    const colFeatures = filtered.filteredFeatures.filter((f) => f.status === colStatus);
    colFeatures.forEach((f) => orderedFeatureIds.push(f.id));
    renderBoardColumn(
      buf,
      { x: cx, y: rect.y, w, h: rect.h },
      colStatus,
      labels[colStatus],
      colFeatures,
      state,
      featureBounds,
      columnViewports
    );
  });

  return { columns, orderedFeatureIds, featureBounds, columnViewports };
}

function renderBoardColumn(
  buf: ScreenBuffer,
  colRect: Rect,
  colStatus: FeatureStatus,
  label: string,
  features: Feature[],
  state: TuiState,
  featureBounds: Map<string, { y: number; h: number }>,
  columnViewports: Map<FeatureStatus, { y: number; h: number; maxScroll: number }>
): void {
  const st = getStatusStyle(colStatus);
  buf.drawBox(colRect.x, colRect.y, colRect.w, colRect.h, {
    borderStyle: { fg: TUI_PALETTE.border },
    fillStyle: { bg: TUI_PALETTE.surface },
  });
  buf.addHitRegion({
    id: `board-col-${colStatus}`,
    kind: "board-col",
    x: colRect.x,
    y: colRect.y,
    w: colRect.w,
    h: colRect.h,
    zIndex: 4,
    data: colStatus,
  });

  const badge = ` ${label} `;
  buf.fillRect(colRect.x + 2, colRect.y + 1, badge.length, 1, { bg: st.bg });
  buf.writeText(colRect.x + 2, colRect.y + 1, badge, badge.length, { fg: st.fg, bold: true });
  const countStr = String(features.length);
  buf.writeText(colRect.x + colRect.w - 2 - countStr.length, colRect.y + 1, countStr, countStr.length, {
    fg: TUI_PALETTE.muted,
  });
  for (let i = colRect.x + 1; i < colRect.x + colRect.w - 1; i++) {
    buf.put(i, colRect.y + 2, "─", { fg: TUI_PALETTE.border });
  }

  const listRect: Rect = {
    x: colRect.x + 1,
    y: colRect.y + 3,
    w: Math.max(8, colRect.w - 2),
    h: Math.max(1, colRect.h - 4),
  };
  columnViewports.set(colStatus, { y: listRect.y, h: listRect.h, maxScroll: 0 });

  if (features.length === 0) {
    buf.writeText(listRect.x + 1, listRect.y, "No features", listRect.w - 2, {
      fg: TUI_PALETTE.muted,
    });
    return;
  }

  const cardH = 5;
  const totalH = features.length * (cardH + 1) - 1;
  const maxScroll = Math.max(0, totalH - listRect.h);
  columnViewports.set(colStatus, { y: listRect.y, h: listRect.h, maxScroll });
  const scrollY = Math.max(0, Math.min(state.boardScrollY[colStatus] ?? 0, maxScroll));
  state.boardScrollY[colStatus] = scrollY;

  const cw = new ClipWriter(buf, listRect, scrollY, 8);
  features.forEach((f, idx) => {
    const cy = idx * (cardH + 1);
    featureBounds.set(f.id, { y: cy, h: cardH });
    const cardW = Math.max(8, listRect.w - 2);
    const cardX = listRect.x + 1;
    const isSel = state.selectedFeatureId === f.id;
    cw.drawBox(cardX, cy, cardW, cardH, {
      borderStyle: { fg: isSel ? TUI_PALETTE.accent : TUI_PALETTE.border },
      fillStyle: { bg: TUI_PALETTE.surface2 },
    });
    cw.addHitRegion(cardX, cy, cardW, cardH, `board-card-${f.id}`, "feature-card", f.id);
    cw.writeText(cardX + 2, cy + 1, f.title, Math.max(4, cardW - 4), {
      fg: TUI_PALETTE.text,
      bold: true,
    });
    cw.writeText(cardX + 2, cy + 2, f.id, Math.max(4, cardW - 4), { fg: TUI_PALETTE.muted });
    const done = f.ship_criteria.filter((c) => c.done).length;
    const total = f.ship_criteria.length;
    const meta = [f.milestone, f.area, total > 0 ? `${done}/${total}` : ""]
      .filter(Boolean)
      .join(" · ");
    cw.writeText(cardX + 2, cy + 3, meta, Math.max(4, cardW - 4), { fg: TUI_PALETTE.slate });
  });
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

  buf.addHitRegion({
    id: "health-backdrop",
    kind: "health-backdrop",
    x: 0,
    y: 0,
    w: width,
    h: height,
    zIndex: HitLayer.healthBackdrop,
  });

  const w = Math.min(width - 4, 92);
  const h = Math.min(height - 4, 22);
  const x = Math.max(1, Math.floor((width - w) / 2));
  const y = Math.max(1, Math.floor((height - h) / 2));

  buf.drawBox(x, y, w, h, {
    borderStyle: { fg: TUI_PALETTE.accent },
    fillStyle: { bg: TUI_PALETTE.surface },
    title: "Health & Drift Diagnostics",
    titleStyle: { fg: TUI_PALETTE.text, bold: true },
  });

  drawPill(
    buf,
    x + w - 10,
    y + 1,
    "Close",
    { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 },
    { id: "health-close", kind: "health-close", zIndex: HitLayer.healthControl }
  );

  const featureIds = new Set(state.payload.features.map((f) => f.id));
  const issues: Array<{ level: "error" | "warning"; item: ValidationIssue }> = [
    ...state.payload.check.errors.map((item) => ({ level: "error" as const, item })),
    ...state.payload.check.warnings.map((item) => ({ level: "warning" as const, item })),
  ];

  const firstRowY = y + 3;
  if (state.loadError) {
    buf.writeText(x + 3, firstRowY, `Last reload failed: ${state.loadError}`, w - 6, {
      fg: TUI_PALETTE.red,
    });
  }

  if (issues.length === 0) {
    const beadsWanted = !state.noBeads && state.payload.config.integrations.beads.enabled;
    const rowY = firstRowY + (state.loadError ? 2 : 0);
    if (!beadsWanted) {
      buf.writeText(
        x + 3,
        rowY,
        "Schema, DAG, and ROADMAP.md sync checks passed (0 errors, 0 warnings).",
        w - 6,
        { fg: TUI_PALETTE.green }
      );
      buf.writeText(
        x + 3,
        rowY + 1,
        "Beads checks skipped (--no-beads or integrations.beads.enabled=false).",
        w - 6,
        { fg: TUI_PALETTE.amber }
      );
    } else if (state.beadsLoading) {
      buf.writeText(
        x + 3,
        rowY,
        "Schema, DAG, and ROADMAP.md sync checks passed (0 errors, 0 warnings).",
        w - 6,
        { fg: TUI_PALETTE.green }
      );
      buf.writeText(x + 3, rowY + 1, "Beads checks pending…", w - 6, { fg: TUI_PALETTE.amber });
    } else {
      buf.writeText(
        x + 3,
        rowY,
        "All schema, DAG, ROADMAP.md sync, and Beads checks passed (0 errors, 0 warnings).",
        w - 6,
        { fg: TUI_PALETTE.green }
      );
    }
    return;
  }

  // Scrollable diagnostic list: the window clamps to the issue count so the final
  // diagnostic is reachable (and its Inspect pill clickable) on short terminals.
  const listTop = firstRowY + (state.loadError ? 2 : 0);
  const maxRows = Math.max(1, y + h - 2 - listTop);
  const maxScroll = Math.max(0, issues.length - maxRows);
  state.healthScrollY = Math.max(0, Math.min(state.healthScrollY, maxScroll));

  let rowY = listTop;
  for (let i = state.healthScrollY; i < issues.length && rowY < y + h - 2; i++) {
    const { level, item } = issues[i]!;
    const st = level === "error"
      ? { fg: TUI_PALETTE.red, bg: TUI_PALETTE.redSoft }
      : { fg: TUI_PALETTE.amber, bg: TUI_PALETTE.amberSoft };
    const codeUsed = drawPill(buf, x + 2, rowY, item.code, { ...st, bold: true });
    const hasJump = Boolean(item.entityId && featureIds.has(item.entityId));
    const jumpLabel = hasJump ? `Inspect ${item.entityId}` : "";
    const jumpW = jumpLabel ? jumpLabel.length + 3 : 0;
    const msgMax = Math.max(10, w - 6 - codeUsed - jumpW);
    buf.writeText(x + 3 + codeUsed, rowY, item.message, msgMax, { fg: TUI_PALETTE.text });
    if (hasJump && item.entityId) {
      drawPill(
        buf,
        x + w - 2 - jumpLabel.length - 2,
        rowY,
        jumpLabel,
        { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true },
        {
          id: `health-jump-${item.entityId}`,
          kind: "health-jump",
          zIndex: HitLayer.healthControl,
          data: item.entityId,
        }
      );
    }
    rowY += 1;
  }
  if (maxScroll > 0) {
    const position = `${state.healthScrollY + 1}-${Math.min(issues.length, state.healthScrollY + maxRows)}/${issues.length}`;
    buf.writeText(x + w - 2 - position.length, y + h - 2, position, position.length, {
      fg: TUI_PALETTE.muted,
    });
  }
}

export function renderFooter(buf: ScreenBuffer, y: number, width: number, state: TuiState): void {
  buf.fillRect(0, y, width, 1, { bg: TUI_PALETTE.surface });
  if (state.toast) {
    const fg =
      state.toast.kind === "err"
        ? TUI_PALETTE.red
        : state.toast.kind === "ok"
        ? TUI_PALETTE.green
        : TUI_PALETTE.accent;
    buf.writeText(1, y, state.toast.message, width - 2, { fg, bold: true });
    return;
  }
  const hints =
    state.searchFocused
      ? "Type to filter features · Backspace delete · Enter/Esc finish search"
      : state.viewMode === "graph"
      ? "1/2/3 Views · Drag Pan · Wheel/+/-/Fit/0 Zoom · Click Trace/Open · h Hover · m Mouse · ? Help · q Quit"
      : "1/2/3 Views · j/k Scroll · / Search · Enter Open Drawer · m Mouse · y Copy ID · R Refresh · ? Help · q Quit";
  buf.writeText(1, y, hints, width - 2, { fg: TUI_PALETTE.muted });
}
