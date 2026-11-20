import { existsSync, watch, type FSWatcher } from "node:fs";
import type { BeadsClient } from "../beads";
import { buildRoadmapViewPayload } from "../view";
import { RoadmapService } from "../store";
import type { FeatureStatus } from "../types";
import { getDrawerRect, renderFeatureDrawer, renderHelpOverlay } from "./drawer";
import {
  clampGraphCamera,
  computeWaterfallLayout,
  fitGraphCamera,
  getGraphViewportRect,
  renderWaterfallGraphView,
  resetGraphCamera,
  stepGraphZoom,
  type WaterfallLayout,
} from "./graph";
import { encodeOsc52Copy, NodeTerminalSession, type InputEvent, type KeyEvent, type MouseEvent, type TerminalSession } from "./input";
import { diffBuffers, ScreenBuffer, TUI_PALETTE, type HitRegion } from "./screen";
import {
  buildPickerOptions,
  computeFilteredData,
  createInitialTuiState,
  renderBoardView,
  renderCardsView,
  renderFloatingPicker,
  renderFooter,
  renderHeaderAndKpis,
  renderHealthOverlay,
  renderTabsAndFilters,
  type PickerKind,
  type Rect,
  type TuiState,
  type TuiViewMode,
} from "./views";

export interface TuiControllerOptions {
  rootDir: string;
  service?: RoadmapService;
  beadsClient?: BeadsClient;
  noBeads?: boolean;
  session: TerminalSession;
  onExit?: () => void;
}

/**
 * Coordinates TUI state transitions, input routing, rendering, and Beads/store refreshes.
 */
export class TuiController {
  readonly service: RoadmapService;
  readonly beadsClient?: BeadsClient;
  readonly session: TerminalSession;
  readonly state: TuiState;
  private readonly onExit?: () => void;
  private prevBuf: ScreenBuffer | null = null;
  private currentBuf: ScreenBuffer;
  private offInput: (() => void) | null = null;
  private offResize: (() => void) | null = null;
  private stopped = false;
  private lastOrderedIds: string[] = [];
  private lastCardsMaxScroll = 0;
  private lastBoardCols: string[] = [];
  private lastGraphLayout: WaterfallLayout | null = null;
  private lastDrawerMaxScroll = 0;
  private watchers: FSWatcher[] = [];
  private watchDebounce: ReturnType<typeof setTimeout> | null = null;
  private mainRect: Rect = { x: 0, y: 0, w: 80, h: 20 };
  private graphDrag: {
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
    dragging: boolean;
    targetNodeId: string | null;
  } | null = null;
  private loadGeneration = 0;

  constructor(options: TuiControllerOptions) {
    this.service = options.service ?? new RoadmapService(options.rootDir);
    this.service.requireInitialized();
    this.beadsClient = options.beadsClient;
    this.session = options.session;
    this.onExit = options.onExit;

    const loaded = this.service.load();
    const fastCheck = this.service.check();
    const knownIds = new Set(loaded.milestones.map((m) => m.id));
    const defaultId = loaded.config.defaults.milestone;
    const milestones = [...loaded.milestones];
    if (!knownIds.has(defaultId) && loaded.features.some((f) => f.milestone === defaultId)) {
      milestones.push({
        id: defaultId,
        title: "Backlog",
        order: 9999,
        status: "planned",
        description: "Features queued without a specific release milestone.",
      });
    }
    const beadsWanted = !options.noBeads && loaded.config.integrations.beads.enabled;
    this.state = createInitialTuiState(
      {
        config: loaded.config,
        milestones,
        features: loaded.features,
        check: {
          ok: fastCheck.ok,
          errors: fastCheck.errors,
          warnings: fastCheck.warnings,
        },
        beads: {},
      },
      { noBeads: Boolean(options.noBeads), beadsLoading: beadsWanted, liveWatchActive: true }
    );
    this.currentBuf = new ScreenBuffer(this.session.width, this.session.height);
  }

  getBuffer(): ScreenBuffer {
    return this.currentBuf;
  }

  getState(): TuiState {
    return this.state;
  }

  start(): void {
    this.stopped = false;
    this.offInput = this.session.onInput((ev) => {
      this.handleEvent(ev);
    });
    this.offResize = this.session.onResize(() => {
      this.render();
    });
    this.startWatchers();
    this.session.enter({
      mouse: this.state.mouseEnabled,
      hover: this.state.viewMode === "graph" && this.state.graphHoverEnabled,
    });
    this.render();
    if (this.state.beadsLoading) {
      void this.refreshBeadsAsync();
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.offInput?.();
    this.offResize?.();
    this.offInput = null;
    this.offResize = null;
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore watcher teardown errors
      }
    }
    this.watchers = [];
    this.session.leave();
    this.onExit?.();
  }

  private startWatchers(): void {
    if (this.watchers.length > 0) return;
    const scheduleReload = () => {
      if (this.stopped) return;
      if (this.watchDebounce) clearTimeout(this.watchDebounce);
      this.watchDebounce = setTimeout(() => {
        this.watchDebounce = null;
        if (!this.stopped) this.reloadSync();
      }, 150);
    };
    for (const dir of [this.service.pulseDir, this.service.milestonesDir, this.service.featuresDir]) {
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, (_eventType, filename) => {
          if (filename && String(filename).includes(".tmp.")) return;
          scheduleReload();
        });
        this.watchers.push(w);
      } catch {
        // Non-fatal if OS watcher quota is exhausted
      }
    }
  }

  async refreshBeadsAsync(): Promise<void> {
    if (this.state.noBeads || this.stopped) return;
    const gen = ++this.loadGeneration;
    this.state.beadsLoading = true;
    try {
      const fullPayload = await buildRoadmapViewPayload(this.service, {
        beads: true,
        beadsClient: this.beadsClient,
      });
      if (this.stopped || gen !== this.loadGeneration) return;
      this.state.payload = fullPayload;
      this.state.beadsLoading = false;
      this.render();
    } catch {
      if (this.stopped || gen !== this.loadGeneration) return;
      this.state.beadsLoading = false;
      this.render();
    }
  }

  render(): ScreenBuffer {
    const w = this.session.width;
    const h = this.session.height;
    const buf = new ScreenBuffer(w, h);
    buf.clear({ bg: TUI_PALETTE.bg, fg: TUI_PALETTE.text });

    const filtered = computeFilteredData(this.state);
    const header = renderHeaderAndKpis(buf, w, this.state, filtered);
    const y = renderTabsAndFilters(buf, header.nextY, w, this.state, filtered, header.tabsInHeader);

    const contentH = Math.max(4, h - y - 1);
    const hasDrawer =
      Boolean(this.state.drawerFeatureId) &&
      this.state.payload.features.some((f) => f.id === this.state.drawerFeatureId);
    const drawerLayout = hasDrawer ? getDrawerRect(w, h, y) : null;
    const mainW = drawerLayout && drawerLayout.mode === "split" ? Math.max(30, drawerLayout.x) : w;
    const rect: Rect = { x: 0, y, w: mainW, h: contentH };
    this.mainRect = rect;

    if (this.state.viewMode === "cards") {
      const res = renderCardsView(buf, rect, this.state, filtered);
      this.lastCardsMaxScroll = res.maxScrollY;
      this.lastOrderedIds = res.orderedFeatureIds;
      this.lastGraphLayout = null;
    } else if (this.state.viewMode === "board") {
      const res = renderBoardView(buf, rect, this.state, filtered);
      this.lastBoardCols = res.columns;
      this.lastOrderedIds = res.orderedFeatureIds;
      this.lastGraphLayout = null;
    } else {
      this.lastGraphLayout = renderWaterfallGraphView(buf, rect, this.state, filtered);
      this.lastOrderedIds = this.lastGraphLayout
        ? this.lastGraphLayout.orderedNodes.map((n) => n.feature.id)
        : [];
    }

    const drawerResult = renderFeatureDrawer(buf, w, h, y, this.state);
    this.lastDrawerMaxScroll = drawerResult ? drawerResult.maxScrollY : 0;
    renderFloatingPicker(buf, w, h, this.state);
    renderHealthOverlay(buf, w, h, this.state);
    if (this.state.helpOpen) {
      renderHelpOverlay(buf, w, h);
    }
    renderFooter(buf, h - 1, w, this.state);

    this.session.write(diffBuffers(this.prevBuf, buf, this.session.colorMode));
    this.prevBuf = buf;
    this.currentBuf = buf;
    return buf;
  }

  handleEvent(ev: InputEvent): void {
    if (this.stopped) return;
    if (ev.type === "key") {
      this.handleKey(ev);
    } else {
      this.handleMouse(ev);
    }
  }

  private handleKey(ev: KeyEvent): void {
    if (ev.ctrl && ev.key === "c") {
      this.stop();
      return;
    }

    if (this.state.openPicker) {
      const opts = this.state.openPicker.options;
      if (ev.key === "escape") {
        this.state.openPicker = null;
        this.render();
        return;
      }
      if (ev.key === "up" || ev.key === "k") {
        this.state.pickerSelectedIndex = Math.max(0, this.state.pickerSelectedIndex - 1);
        this.render();
        return;
      }
      if (ev.key === "down" || ev.key === "j") {
        this.state.pickerSelectedIndex = Math.min(opts.length - 1, this.state.pickerSelectedIndex + 1);
        this.render();
        return;
      }
      if (ev.key === "enter") {
        const chosen = opts[this.state.pickerSelectedIndex];
        if (chosen) {
          this.applyFilter(this.state.openPicker.kind, chosen.value);
        }
        this.state.openPicker = null;
        this.render();
        return;
      }
    }

    if (this.state.helpOpen) {
      if (ev.key === "escape" || ev.key === "?" || ev.key === "q") {
        this.state.helpOpen = false;
        this.render();
      }
      return;
    }

    if (this.state.healthPanelOpen) {
      if (ev.key === "escape") {
        this.state.healthPanelOpen = false;
        this.render();
      }
      return;
    }

    if (this.state.searchFocused) {
      if (ev.key === "escape" || ev.key === "enter") {
        this.state.searchFocused = false;
        this.render();
        return;
      }
      if (ev.key === "backspace") {
        this.state.search = this.state.search.slice(0, -1);
        this.state.cardsScrollY = 0;
        this.render();
        return;
      }
      if (!ev.ctrl && !ev.alt && ev.key.length === 1) {
        this.state.search += ev.key;
        this.state.cardsScrollY = 0;
        this.render();
        return;
      }
      return;
    }

    if (this.state.drawerFeatureId && this.state.drawerFocus === "note") {
      this.handleDrawerNoteKey(ev, this.state.drawerFeatureId);
      return;
    }

    if (ev.key === "q") {
      this.stop();
      return;
    }

    if (ev.key === "?") {
      this.state.helpOpen = true;
      this.render();
      return;
    }

    if (ev.key === "y") {
      this.copyActiveFeatureId();
      return;
    }

    if (ev.key === "escape") {
      if (this.state.drawerFeatureId) {
        this.closeDrawer();
      } else if (this.state.toast) {
        this.state.toast = null;
        this.render();
      }
      return;
    }

    if (this.state.drawerFeatureId) {
      const feature = this.state.payload.features.find((f) => f.id === this.state.drawerFeatureId);
      if (ev.key === "n") {
        this.focusDrawerNote(this.state.drawerFeatureId);
        return;
      }
      if (ev.key === "tab") {
        this.state.drawerFocus = this.state.drawerFocus === "criteria" ? "note" : "criteria";
        if (this.state.drawerFocus === "note") {
          this.state.noteCursor = Array.from(
            this.state.noteDrafts[this.state.drawerFeatureId] ?? ""
          ).length;
        }
        this.render();
        return;
      }
      if (ev.key === " " && feature && feature.ship_criteria.length > 0) {
        const crit = feature.ship_criteria[this.state.drawerCriterionIndex];
        if (crit) {
          this.toggleCriterion(feature.id, crit.id, !crit.done);
        }
        return;
      }
      if ((ev.key === "down" || ev.key === "j") && feature && feature.ship_criteria.length > 0) {
        this.state.drawerCriterionIndex = Math.min(
          feature.ship_criteria.length - 1,
          this.state.drawerCriterionIndex + 1
        );
        this.render();
        return;
      }
      if ((ev.key === "up" || ev.key === "k") && feature && feature.ship_criteria.length > 0) {
        this.state.drawerCriterionIndex = Math.max(0, this.state.drawerCriterionIndex - 1);
        this.render();
        return;
      }
      if (ev.key === "pagedown") {
        this.state.drawerScrollY = Math.min(this.lastDrawerMaxScroll, this.state.drawerScrollY + 4);
        this.render();
        return;
      }
      if (ev.key === "pageup") {
        this.state.drawerScrollY = Math.max(0, this.state.drawerScrollY - 4);
        this.render();
        return;
      }
    }

    if (ev.key === "1") {
      this.switchView("cards");
      return;
    }
    if (ev.key === "2") {
      this.switchView("graph");
      return;
    }
    if (ev.key === "3") {
      this.switchView("board");
      return;
    }
    if (ev.key === "/") {
      this.state.searchFocused = true;
      this.render();
      return;
    }
    if (ev.key === "m") {
      this.toggleMouse();
      return;
    }
    if (ev.key === "R") {
      this.reloadSync();
      return;
    }
    if (this.state.viewMode === "graph") {
      if (ev.key === "+" || ev.key === "=") {
        this.zoomGraph(1);
        return;
      }
      if (ev.key === "-") {
        this.zoomGraph(-1);
        return;
      }
      if (ev.key === "0") {
        this.resetGraph();
        return;
      }
      if (ev.key === "f" || ev.key === "F") {
        this.fitGraph();
        return;
      }
      if (ev.key === "h") {
        this.toggleGraphHover();
        return;
      }
      if (ev.key === "left") {
        this.panGraph(4, 0);
        return;
      }
      if (ev.key === "right") {
        this.panGraph(-4, 0);
        return;
      }
      if (ev.key === "down" || ev.key === "j") {
        this.moveSelection(1);
        return;
      }
      if (ev.key === "up" || ev.key === "k") {
        this.moveSelection(-1);
        return;
      }
      if (ev.key === "enter") {
        const fid = this.state.graphSelectedId ?? this.state.selectedFeatureId;
        if (fid) {
          this.state.selectedFeatureId = fid;
          this.state.drawerFeatureId = fid;
          this.render();
        }
        return;
      }
    }
    if (ev.key === "down" || ev.key === "j") {
      this.moveSelection(1);
      return;
    }
    if (ev.key === "up" || ev.key === "k") {
      this.moveSelection(-1);
      return;
    }
    if (ev.key === "pagedown") {
      this.scrollActiveView(6);
      return;
    }
    if (ev.key === "pageup") {
      this.scrollActiveView(-6);
      return;
    }
    if (ev.key === "enter" && this.state.selectedFeatureId) {
      this.openDrawer(this.state.selectedFeatureId);
    }
  }

  private handleMouse(ev: MouseEvent): void {
    const hit = this.currentBuf.hitTest(ev.x, ev.y);
    if (ev.action === "move") {
      if (this.state.viewMode === "graph" && this.state.graphHoverEnabled && !this.state.openPicker && !this.state.healthPanelOpen && !this.state.helpOpen) {
        const nextHover = hit?.kind === "graph-node" ? String(hit.data ?? "") : null;
        if (nextHover !== this.state.graphHoverId) {
          this.state.graphHoverId = nextHover;
          this.render();
        }
      }
      return;
    }
    if (ev.action === "drag" && this.graphDrag) {
      const dx = ev.x - this.graphDrag.startX;
      const dy = ev.y - this.graphDrag.startY;
      if (!this.graphDrag.dragging && Math.hypot(dx, dy) >= 2) {
        this.graphDrag.dragging = true;
      }
      if (this.graphDrag.dragging && this.lastGraphLayout) {
        const vpRect = getGraphViewportRect(this.mainRect);
        this.state.graphCamera.tx = this.graphDrag.startTx + dx;
        this.state.graphCamera.ty = this.graphDrag.startTy + dy;
        clampGraphCamera(
          this.lastGraphLayout.stageW,
          this.lastGraphLayout.stageH,
          vpRect,
          this.state.graphCamera
        );
        this.render();
      }
      return;
    }
    if (ev.action === "up") {
      if (this.graphDrag) {
        const drag = this.graphDrag;
        this.graphDrag = null;
        if (!drag.dragging) {
          this.handleGraphClick(drag.targetNodeId);
        }
      }
      return;
    }
    if (ev.action === "wheel-down") {
      if (hit && hit.kind.startsWith("drawer-")) {
        this.state.drawerScrollY = Math.min(this.lastDrawerMaxScroll, this.state.drawerScrollY + 2);
        this.render();
        return;
      }
      if (this.state.viewMode === "graph" && (hit?.kind === "graph-viewport" || hit?.kind === "graph-node")) {
        this.zoomGraph(-1);
        return;
      }
      this.scrollAtPoint(ev.x, ev.y, 3, hit);
      return;
    }
    if (ev.action === "wheel-up") {
      if (hit && hit.kind.startsWith("drawer-")) {
        this.state.drawerScrollY = Math.max(0, this.state.drawerScrollY - 2);
        this.render();
        return;
      }
      if (this.state.viewMode === "graph" && (hit?.kind === "graph-viewport" || hit?.kind === "graph-node")) {
        this.zoomGraph(1);
        return;
      }
      this.scrollAtPoint(ev.x, ev.y, -3, hit);
      return;
    }
    if (ev.action !== "down" || ev.button !== "left" || !hit) return;

    this.state.searchFocused = false;
    switch (hit.kind) {
      case "help-toggle": {
        this.state.helpOpen = !this.state.helpOpen;
        this.render();
        break;
      }
      case "help-close":
      case "help-backdrop": {
        this.state.helpOpen = false;
        this.render();
        break;
      }
      case "copy-id": {
        this.copyActiveFeatureId(String(hit.data ?? ""));
        break;
      }
      case "drawer-close":
      case "drawer-backdrop": {
        this.closeDrawer();
        break;
      }
      case "drawer-status": {
        if (this.state.drawerFeatureId) {
          this.updateFeatureStatus(this.state.drawerFeatureId, String(hit.data) as FeatureStatus);
        }
        break;
      }
      case "drawer-criterion": {
        if (this.state.drawerFeatureId) {
          const d = hit.data as { criterionId: string; done: boolean; index: number };
          this.state.drawerFocus = "criteria";
          this.state.drawerCriterionIndex = d.index;
          this.toggleCriterion(this.state.drawerFeatureId, d.criterionId, d.done);
        }
        break;
      }
      case "drawer-jump": {
        const targetId = String(hit.data ?? "");
        if (targetId) {
          this.openDrawer(targetId);
        }
        break;
      }
      case "drawer-note-input": {
        if (this.state.drawerFeatureId) {
          this.focusDrawerNote(this.state.drawerFeatureId);
        }
        break;
      }
      case "drawer-note-submit": {
        if (this.state.drawerFeatureId) {
          this.submitPulseNote(this.state.drawerFeatureId);
        }
        break;
      }
      case "graph-hover-toggle": {
        this.toggleGraphHover();
        break;
      }
      case "graph-zoom-out": {
        this.zoomGraph(-1);
        break;
      }
      case "graph-zoom-in": {
        this.zoomGraph(1);
        break;
      }
      case "graph-zoom-reset": {
        this.resetGraph();
        break;
      }
      case "graph-zoom-fit": {
        this.fitGraph();
        break;
      }
      case "graph-viewport": {
        this.graphDrag = {
          startX: ev.x,
          startY: ev.y,
          startTx: this.state.graphCamera.tx,
          startTy: this.state.graphCamera.ty,
          dragging: false,
          targetNodeId: null,
        };
        break;
      }
      case "graph-node": {
        this.graphDrag = {
          startX: ev.x,
          startY: ev.y,
          startTx: this.state.graphCamera.tx,
          startTy: this.state.graphCamera.ty,
          dragging: false,
          targetNodeId: String(hit.data ?? ""),
        };
        break;
      }
      case "view-tab": {
        this.state.openPicker = null;
        this.switchView(hit.data as TuiViewMode);
        break;
      }
      case "open-picker": {
        const info = hit.data as { kind: PickerKind; anchorX: number; anchorY: number };
        if (this.state.openPicker?.kind === info.kind) {
          this.state.openPicker = null;
        } else {
          const filtered = computeFilteredData(this.state);
          const options = buildPickerOptions(info.kind, this.state, filtered);
          const activeVal =
            info.kind === "milestone"
              ? this.state.milestoneFilter
              : info.kind === "status"
              ? this.state.statusFilter
              : this.state.areaFilter;
          this.state.openPicker = { kind: info.kind, x: info.anchorX, y: info.anchorY, options };
          this.state.pickerSelectedIndex = Math.max(
            0,
            options.findIndex((o) => o.value === activeVal)
          );
        }
        this.render();
        break;
      }
      case "picker-option": {
        const opt = hit.data as { kind: PickerKind; value: string };
        this.applyFilter(opt.kind, opt.value);
        this.state.openPicker = null;
        this.render();
        break;
      }
      case "picker-backdrop": {
        this.state.openPicker = null;
        this.render();
        break;
      }
      case "focus-search": {
        this.state.openPicker = null;
        this.state.searchFocused = true;
        this.render();
        break;
      }
      case "toggle-deps": {
        this.state.showDeps = !this.state.showDeps;
        this.render();
        break;
      }
      case "reset-filters": {
        this.state.milestoneFilter = "";
        this.state.statusFilter = "";
        this.state.areaFilter = "";
        this.state.search = "";
        this.state.cardsScrollY = 0;
        this.state.boardScrollY = {};
        this.state.openPicker = null;
        this.render();
        break;
      }
      case "health-toggle": {
        this.state.openPicker = null;
        this.state.healthPanelOpen = !this.state.healthPanelOpen;
        this.render();
        break;
      }
      case "health-close":
      case "health-backdrop": {
        this.state.healthPanelOpen = false;
        this.render();
        break;
      }
      case "health-jump": {
        const targetId = String(hit.data ?? "");
        this.state.healthPanelOpen = false;
        if (targetId) {
          this.openDrawer(targetId);
        }
        break;
      }
      case "mouse-toggle": {
        this.toggleMouse();
        break;
      }
      case "refresh-btn": {
        this.reloadSync();
        this.state.toast = { kind: "info", message: "Refreshed roadmap from disk" };
        this.render();
        break;
      }
      case "kpi-filter": {
        const target = String(hit.data ?? "");
        this.state.statusFilter = !target
          ? ""
          : this.state.statusFilter === target
          ? ""
          : target;
        this.state.cardsScrollY = 0;
        this.state.boardScrollY = {};
        this.state.openPicker = null;
        this.render();
        break;
      }
      case "quit-btn": {
        this.stop();
        break;
      }
      case "board-tab": {
        this.state.boardActiveCol = Number(hit.data ?? 0);
        this.render();
        break;
      }
      case "feature-card": {
        const fid = String(hit.data ?? "");
        if (fid) {
          this.openDrawer(fid);
        }
        break;
      }
    }
  }

  private syncMouseMode(): void {
    const wantHover =
      this.state.mouseEnabled &&
      this.state.viewMode === "graph" &&
      this.state.graphHoverEnabled;
    this.session.setMouseMode({
      enabled: this.state.mouseEnabled,
      hover: wantHover,
    });
  }

  private switchView(mode: TuiViewMode): void {
    this.state.viewMode = mode;
    this.state.openPicker = null;
    this.syncMouseMode();
    this.render();
  }

  private applyFilter(kind: PickerKind, value: string): void {
    if (kind === "milestone") this.state.milestoneFilter = value;
    else if (kind === "status") this.state.statusFilter = value;
    else this.state.areaFilter = value;
    this.state.cardsScrollY = 0;
    this.state.boardScrollY = {};
  }

  private toggleMouse(): void {
    this.state.mouseEnabled = !this.state.mouseEnabled;
    this.syncMouseMode();
    this.state.toast = {
      kind: "info",
      message: this.state.mouseEnabled
        ? "Mouse mode ON (press m to toggle native text selection)"
        : "Mouse mode OFF (native drag-select enabled; press m to re-enable)",
    };
    this.render();
  }

  private reloadSync(options: { preserveFeedback?: boolean } = {}): void {
    const loaded = this.service.load();
    const fastCheck = this.service.check();
    const knownIds = new Set(loaded.milestones.map((m) => m.id));
    const defaultId = loaded.config.defaults.milestone;
    const milestones = [...loaded.milestones];
    if (!knownIds.has(defaultId) && loaded.features.some((f) => f.milestone === defaultId)) {
      milestones.push({
        id: defaultId,
        title: "Backlog",
        order: 9999,
        status: "planned",
        description: "Features queued without a specific release milestone.",
      });
    }
    this.state.payload = {
      config: loaded.config,
      milestones,
      features: loaded.features,
      check: { ok: fastCheck.ok, errors: fastCheck.errors, warnings: fastCheck.warnings },
      beads: this.state.payload.beads,
    };
    if (!options.preserveFeedback) {
      this.state.drawerFeedback = null;
    }
    this.render();
    if (!this.state.noBeads && loaded.config.integrations.beads.enabled) {
      void this.refreshBeadsAsync();
    }
  }

  private openDrawer(featureId: string): void {
    this.state.selectedFeatureId = featureId;
    this.state.drawerFeatureId = featureId;
    this.state.drawerScrollY = 0;
    this.state.drawerFocus = "criteria";
    this.state.drawerCriterionIndex = 0;
    this.state.drawerFeedback = null;
    this.render();
  }

  private closeDrawer(): void {
    this.state.drawerFeatureId = null;
    this.state.drawerFocus = "criteria";
    this.state.drawerFeedback = null;
    this.render();
  }

  private focusDrawerNote(featureId: string): void {
    this.state.drawerFocus = "note";
    this.state.noteCursor = Array.from(this.state.noteDrafts[featureId] ?? "").length;
    this.render();
  }

  private copyActiveFeatureId(explicitId?: string): void {
    const target =
      explicitId ||
      this.state.drawerFeatureId ||
      (this.state.viewMode === "graph" ? this.state.graphSelectedId : null) ||
      this.state.selectedFeatureId;
    if (!target) {
      this.state.toast = { kind: "info", message: "No feature selected to copy" };
      this.render();
      return;
    }
    this.session.copyToClipboard(target);
    this.state.toast = { kind: "ok", message: `Copied ID to clipboard: ${target}` };
    this.render();
  }

  private toggleCriterion(featureId: string, criterionId: string, done: boolean): void {
    try {
      this.service.checkFeatureCriterion(featureId, criterionId, done);
      this.state.drawerFeedback = { kind: "ok", message: "Saved criterion update" };
      this.reloadSync({ preserveFeedback: true });
    } catch (error) {
      this.state.drawerFeedback = { kind: "err", message: (error as Error).message };
      this.render();
    }
  }

  private updateFeatureStatus(featureId: string, status: FeatureStatus): void {
    try {
      this.service.updateFeature(featureId, { status });
      this.state.drawerFeedback = { kind: "ok", message: `Saved status: ${status}` };
      this.reloadSync({ preserveFeedback: true });
    } catch (error) {
      this.state.drawerFeedback = { kind: "err", message: (error as Error).message };
      this.render();
    }
  }

  private submitPulseNote(featureId: string): void {
    const note = (this.state.noteDrafts[featureId] ?? "").trim();
    if (!note) return;
    try {
      this.service.addFeatureNote(featureId, note);
      delete this.state.noteDrafts[featureId];
      this.state.noteCursor = 0;
      this.state.drawerFeedback = { kind: "ok", message: "Logged pulse note" };
      this.reloadSync({ preserveFeedback: true });
    } catch (error) {
      this.state.drawerFeedback = { kind: "err", message: (error as Error).message };
      this.render();
    }
  }

  private handleDrawerNoteKey(ev: KeyEvent, featureId: string): void {
    if (ev.key === "escape") {
      this.state.drawerFocus = "criteria";
      this.render();
      return;
    }
    if (ev.key === "enter") {
      this.submitPulseNote(featureId);
      return;
    }
    const glyphs = Array.from(this.state.noteDrafts[featureId] ?? "");
    let cursor = Math.max(0, Math.min(this.state.noteCursor, glyphs.length));
    if (ev.key === "left") {
      this.state.noteCursor = Math.max(0, cursor - 1);
      this.render();
      return;
    }
    if (ev.key === "right") {
      this.state.noteCursor = Math.min(glyphs.length, cursor + 1);
      this.render();
      return;
    }
    if (ev.key === "home") {
      this.state.noteCursor = 0;
      this.render();
      return;
    }
    if (ev.key === "end") {
      this.state.noteCursor = glyphs.length;
      this.render();
      return;
    }
    if (ev.key === "backspace") {
      if (cursor > 0) {
        glyphs.splice(cursor - 1, 1);
        cursor -= 1;
        this.state.noteDrafts[featureId] = glyphs.join("");
        this.state.noteCursor = cursor;
        this.render();
      }
      return;
    }
    if (ev.key === "delete") {
      if (cursor < glyphs.length) {
        glyphs.splice(cursor, 1);
        this.state.noteDrafts[featureId] = glyphs.join("");
        this.state.noteCursor = cursor;
        this.render();
      }
      return;
    }
    if (!ev.ctrl && !ev.alt && ev.key.length === 1) {
      glyphs.splice(cursor, 0, ev.key);
      this.state.noteDrafts[featureId] = glyphs.join("");
      this.state.noteCursor = cursor + 1;
      this.render();
    }
  }

  private moveSelection(delta: number): void {
    if (this.lastOrderedIds.length === 0) return;
    const idx = this.state.selectedFeatureId
      ? this.lastOrderedIds.indexOf(this.state.selectedFeatureId)
      : -1;
    const nextIdx =
      idx === -1
        ? delta > 0
          ? 0
          : this.lastOrderedIds.length - 1
        : Math.max(0, Math.min(this.lastOrderedIds.length - 1, idx + delta));
    const nextId = this.lastOrderedIds[nextIdx] ?? null;
    this.state.selectedFeatureId = nextId;
    if (this.state.viewMode === "graph") {
      this.state.graphSelectedId = nextId;
      this.render();
      return;
    }
    this.scrollActiveView(delta * 2);
  }

  private handleGraphClick(targetNodeId: string | null): void {
    if (!targetNodeId) {
      this.state.graphSelectedId = null;
      this.render();
      return;
    }
    if (this.state.graphHoverEnabled) {
      this.openDrawer(targetNodeId);
      this.state.graphSelectedId = targetNodeId;
      return;
    }
    if (this.state.graphSelectedId === targetNodeId) {
      this.openDrawer(targetNodeId);
    } else {
      this.state.graphSelectedId = targetNodeId;
      this.state.selectedFeatureId = targetNodeId;
      this.render();
    }
  }

  private toggleGraphHover(): void {
    this.state.graphHoverEnabled = !this.state.graphHoverEnabled;
    if (!this.state.graphHoverEnabled) {
      this.state.graphHoverId = null;
    }
    this.syncMouseMode();
    this.render();
  }

  private panGraph(dx: number, dy: number): void {
    if (!this.lastGraphLayout) return;
    const vpRect = getGraphViewportRect(this.mainRect);
    this.state.graphCamera.tx += dx;
    this.state.graphCamera.ty += dy;
    clampGraphCamera(
      this.lastGraphLayout.stageW,
      this.lastGraphLayout.stageH,
      vpRect,
      this.state.graphCamera
    );
    this.render();
  }

  private zoomGraph(delta: number): void {
    const nextZoom = stepGraphZoom(this.state.graphCamera.zoom, delta);
    if (nextZoom === this.state.graphCamera.zoom) return;
    this.state.graphCamera.zoom = nextZoom;
    const filtered = computeFilteredData(this.state);
    const vpRect = getGraphViewportRect(this.mainRect);
    const nextLayout = computeWaterfallLayout(
      filtered.filteredFeatures,
      this.state.payload.milestones,
      nextZoom
    );
    const innerW = Math.max(1, vpRect.w - 2);
    const innerH = Math.max(1, vpRect.h - 2);
    this.state.graphCamera.tx = Math.floor((innerW - nextLayout.stageW) / 2);
    this.state.graphCamera.ty =
      nextLayout.stageH <= innerH ? Math.floor((innerH - nextLayout.stageH) / 2) : 0;
    clampGraphCamera(nextLayout.stageW, nextLayout.stageH, vpRect, this.state.graphCamera);
    this.lastGraphLayout = nextLayout;
    this.render();
  }

  private resetGraph(): void {
    const filtered = computeFilteredData(this.state);
    const vpRect = getGraphViewportRect(this.mainRect);
    this.lastGraphLayout = resetGraphCamera(
      filtered.filteredFeatures,
      this.state.payload.milestones,
      vpRect,
      this.state.graphCamera
    );
    this.render();
  }

  private fitGraph(): void {
    const filtered = computeFilteredData(this.state);
    const vpRect = getGraphViewportRect(this.mainRect);
    this.lastGraphLayout = fitGraphCamera(
      filtered.filteredFeatures,
      this.state.payload.milestones,
      vpRect,
      this.state.graphCamera
    );
    this.render();
  }

  private scrollActiveView(delta: number): void {
    if (this.state.viewMode === "cards") {
      this.state.cardsScrollY = Math.max(
        0,
        Math.min(this.lastCardsMaxScroll, this.state.cardsScrollY + delta)
      );
    } else if (this.state.viewMode === "board") {
      const col = this.lastBoardCols[this.state.boardActiveCol] ?? "planned";
      this.state.boardScrollY[col] = Math.max(0, (this.state.boardScrollY[col] ?? 0) + delta);
    }
    this.render();
  }

  private scrollAtPoint(_x: number, _y: number, delta: number, hit: HitRegion | null): void {
    if (this.state.viewMode === "cards") {
      this.state.cardsScrollY = Math.max(
        0,
        Math.min(this.lastCardsMaxScroll, this.state.cardsScrollY + delta)
      );
      this.render();
      return;
    }
    if (this.state.viewMode === "board") {
      const col =
        hit?.kind === "board-col"
          ? String(hit.data)
          : this.lastBoardCols[this.state.boardActiveCol] ?? "planned";
      this.state.boardScrollY[col] = Math.max(0, (this.state.boardScrollY[col] ?? 0) + delta);
      this.render();
    }
  }
}

export interface RunTuiOptions {
  noBeads?: boolean;
  beadsClient?: BeadsClient;
  session?: TerminalSession;
}

/**
 * Runs the Project Pulse interactive terminal dashboard until user exit.
 */
export async function runTui(rootDir: string, options: RunTuiOptions = {}): Promise<void> {
  const session = options.session ?? new NodeTerminalSession();
  await new Promise<void>((resolveDone, rejectDone) => {
    let controller: TuiController;
    try {
      controller = new TuiController({
        rootDir,
        noBeads: options.noBeads,
        beadsClient: options.beadsClient,
        session,
        onExit: () => resolveDone(),
      });
      controller.start();
    } catch (error) {
      session.leave();
      rejectDone(error);
    }
  });
}
