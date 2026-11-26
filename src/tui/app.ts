import type { BeadsClient } from "../beads";
import { buildRoadmapViewPayload, startLiveWatcher, type LiveWatcherHandle } from "../view";
import { RoadmapService, type LoadedStore } from "../store";
import type { CheckResult, FeatureStatus } from "../types";
import type { RoadmapViewPayload } from "../dashboard-html";
import { statusLabel } from "../present";
import { activityCacheKey, buildActivity } from "../activity";
import { renderActivityView, visibleActivityEvents } from "./activity-view";
import { DRAWER_STATUSES, getDrawerRect, renderFeatureDrawer, renderHelpOverlay } from "./drawer";
import {
  clampGraphCamera,
  computeWaterfallLayout,
  fitGraphCamera,
  layoutForCamera,
  getGraphViewportRect,
  renderWaterfallGraphView,
  resetGraphCamera,
  stepGraphZoom,
  type WaterfallLayout,
} from "./graph";
import { encodeOsc52Copy, NodeTerminalSession, type InputEvent, type KeyEvent, type MouseEvent, type TerminalSession } from "./input";
import { diffBuffers, ScreenBuffer, segmentText, TUI_PALETTE, type HitRegion } from "./screen";
import {
  buildPickerOptions,
  computeFilteredData,
  createInitialTuiState,
  ledgerOrder,
  renderFloatingPicker,
  renderFooter,
  renderHeader,
  renderHealthOverlay,
  renderLedgerView,
  renderTabsAndFilters,
  pickerVisibleRows,
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
 * True when a key event should be typed into the note editor or search field.
 * Accepts exactly one printable code point, including supplementary characters
 * (emoji occupy two UTF-16 units); named keys like "up" or "enter" are rejected.
 */
function isPrintableTextInput(key: string): boolean {
  if (key.length === 0 || key.length > 2) return false;
  const cp = key.codePointAt(0)!;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return false;
  return key.length === 1 || cp >= 0x10000;
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
  private lastRoadmapMaxScroll = 0;
  private lastRoadmapBounds = new Map<string, { y: number; h: number }>();
  private lastActivityMaxScroll = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGraphLayout: WaterfallLayout | null = null;
  private lastDrawerMaxScroll = 0;
  /** One-shot: next frame scrolls the drawer so the focused note input is visible. */
  private noteRevealPending = false;
  /** One-shot: next frame keeps the control with fresh feedback on screen. */
  private feedbackRevealPending = false;
  private liveWatch: LiveWatcherHandle | null = null;
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
        check: checkPayload(fastCheck),
        beads: {},
      },
      { noBeads: Boolean(options.noBeads), beadsLoading: beadsWanted, liveWatchActive: true }
    );
    // The initial selection is the first feature on screen (ledger order), not the first by order.
    this.state.selectedFeatureId = ledgerOrder(this.state)[0] ?? null;
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
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.toastTimer = null;
    this.feedbackTimer = null;
    // Cancels pending watch reloads and closes every underlying watcher, including resolved
    // symlink-target watches, so no further frames or reloads run after teardown.
    this.liveWatch?.close();
    this.liveWatch = null;
    this.session.leave();
    this.onExit?.();
  }

  private startWatchers(): void {
    if (this.liveWatch) return;
    this.liveWatch = startLiveWatcher({
      paths: [
        { path: this.service.pulseDir, type: "dir" },
        { path: this.service.milestonesDir, type: "dir" },
        { path: this.service.featuresDir, type: "dir" },
        // The root roadmap file: external `pp render` must clear ROADMAP_OUT_OF_SYNC here
        // without a manual refresh. Reloads never write it, so no feedback loop exists.
        { path: this.service.roadmapPath, type: "file" },
      ],
      onEvent: () => {
        if (this.stopped) return;
        if (this.watchDebounce) clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => {
          this.watchDebounce = null;
          if (!this.stopped) this.reloadSync();
        }, 150);
      },
    });
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
      // Beads may have been disabled (config change or --no-beads) while the lookup was in
      // flight; its result must not replace a snapshot for which Beads is out of scope.
      const beadsStillWanted =
        !this.state.noBeads && this.state.payload.config.integrations.beads.enabled;
      if (!beadsStillWanted) return;
      this.state.payload = fullPayload;
      this.reconcileAfterPayloadChange();
      this.state.beadsLoading = false;
      this.render();
    } catch {
      if (this.stopped || gen !== this.loadGeneration) return;
      this.state.beadsLoading = false;
      this.render();
    }
  }

  render(): ScreenBuffer {
    // After stop() the terminal is restored; never write another frame (SIGTERM contract).
    if (this.stopped) return this.currentBuf;
    const w = this.session.width;
    const h = this.session.height;
    const buf = new ScreenBuffer(w, h);
    buf.clear({ bg: TUI_PALETTE.bg, fg: TUI_PALETTE.text });

    const filtered = computeFilteredData(this.state);
    const header = renderHeader(buf, w, this.state, filtered);
    const y = renderTabsAndFilters(buf, header.nextY, w, this.state, filtered, header.tabsInHeader);

    const contentH = Math.max(4, h - y - 1);
    const hasDrawer =
      Boolean(this.state.drawerFeatureId) &&
      this.state.payload.features.some((f) => f.id === this.state.drawerFeatureId);
    const drawerLayout = hasDrawer ? getDrawerRect(w, h, y) : null;
    const mainW = drawerLayout && drawerLayout.mode === "split" ? Math.max(30, drawerLayout.x) : w;
    const rect: Rect = { x: 0, y, w: mainW, h: contentH };
    this.mainRect = rect;

    if (this.state.viewMode === "roadmap") {
      const res = renderLedgerView(buf, rect, this.state, filtered);
      this.lastRoadmapMaxScroll = res.maxScrollY;
      this.lastOrderedIds = res.orderedFeatureIds;
      this.lastRoadmapBounds = res.featureBounds;
      this.lastGraphLayout = null;
    } else if (this.state.viewMode === "activity") {
      if (!this.state.activity) this.loadActivity();
      const res = renderActivityView(buf, rect, this.state);
      this.lastOrderedIds = res.orderedFeatureIds;
      this.lastActivityMaxScroll = res.maxScrollY;
      this.lastGraphLayout = null;
    } else {
      this.lastGraphLayout = renderWaterfallGraphView(buf, rect, this.state, filtered);
      this.lastOrderedIds = this.lastGraphLayout
        ? this.lastGraphLayout.orderedNodes.map((n) => n.feature.id)
        : [];
    }

    const drawerResult = renderFeatureDrawer(buf, w, h, y, this.state, {
      revealNote: this.noteRevealPending,
      revealKey: this.feedbackRevealPending ? this.state.drawerFeedback?.key : undefined,
    });
    this.noteRevealPending = false;
    this.feedbackRevealPending = false;
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
        this.ensurePickerRowVisible(this.state.pickerSelectedIndex);
        this.render();
        return;
      }
      if (ev.key === "down" || ev.key === "j") {
        this.state.pickerSelectedIndex = Math.min(opts.length - 1, this.state.pickerSelectedIndex + 1);
        this.ensurePickerRowVisible(this.state.pickerSelectedIndex);
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
      if (ev.key === "q") {
        this.stop();
        return;
      }
      if (ev.key === "?") {
        this.state.openPicker = null;
        this.state.helpOpen = true;
        this.render();
      }
      return;
    }

    if (this.state.helpOpen) {
      if (ev.key === "q") {
        this.stop();
        return;
      }
      if (ev.key === "escape" || ev.key === "?") {
        this.state.helpOpen = false;
        this.render();
      }
      return;
    }

    if (this.state.healthPanelOpen) {
      if (ev.key === "q") {
        this.stop();
        return;
      }
      if (ev.key === "?") {
        this.state.helpOpen = true;
        this.render();
        return;
      }
      if (ev.key === "escape") {
        this.state.healthPanelOpen = false;
        this.render();
        return;
      }
      if (ev.key === "pagedown" || ev.key === "down" || ev.key === "j") {
        this.state.healthScrollY += ev.key === "pagedown" ? 4 : 1;
        this.render();
        return;
      }
      if (ev.key === "pageup" || ev.key === "up" || ev.key === "k") {
        this.state.healthScrollY = Math.max(0, this.state.healthScrollY - (ev.key === "pageup" ? 4 : 1));
        this.render();
        return;
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
        this.state.search = segmentText(this.state.search).slice(0, -1).join("");
        this.afterFilterChange();
        this.render();
        return;
      }
      if (!ev.ctrl && !ev.alt && isPrintableTextInput(ev.key)) {
        this.state.search += ev.key;
        this.afterFilterChange();
        this.render();
        return;
      }
      return;
    }

    const noteTarget = this.state.drawerFeatureId;
    const noteFeature = noteTarget
      ? this.state.payload.features.find((f) => f.id === noteTarget)
      : undefined;
    if (noteTarget && this.state.drawerFocus === "note" && noteFeature) {
      this.handleDrawerNoteKey(ev, noteTarget);
      return;
    }
    if (noteTarget && !noteFeature) {
      // Feature removed on disk mid-note-entry: the drawer is already unpainted,
      // so release the editor instead of swallowing keys into an invisible draft.
      this.state.drawerFeatureId = null;
      this.state.drawerFocus = "criteria";
      this.state.drawerFeedback = null;
      this.state.pendingShip = null;
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

    const feature = this.state.drawerFeatureId
      ? this.state.payload.features.find((f) => f.id === this.state.drawerFeatureId)
      : undefined;

    // Ship confirmation inside the drawer: ←/→ choose, Enter confirms, Esc cancels.
    if (feature && this.state.pendingShip && this.state.pendingShip.featureId === feature.id) {
      if (ev.key === "left" || ev.key === "h" || ev.key === "shift-tab") {
        this.state.pendingShip.choice = (this.state.pendingShip.choice + 2) % 3;
        this.render();
        return;
      }
      if (ev.key === "right" || ev.key === "l" || ev.key === "tab") {
        this.state.pendingShip.choice = (this.state.pendingShip.choice + 1) % 3;
        this.render();
        return;
      }
      if (ev.key === "enter" || ev.key === " ") {
        this.confirmShip(feature.id, this.state.pendingShip.choice);
        return;
      }
      if (ev.key === "escape") {
        this.confirmShip(feature.id, 2);
        return;
      }
      return;
    }

    if (ev.key === "escape") {
      if (this.state.drawerFeatureId) {
        this.closeDrawer();
      } else if (this.state.toast) {
        this.clearToast();
        this.render();
      }
      return;
    }

    if (feature) {
      if (ev.key === "x" && this.state.drawerFeedback) {
        this.state.drawerFeedback = null;
        this.render();
        return;
      }
      if (ev.key === "e") {
        this.state.healthPanelOpen = true;
        this.state.healthScrollY = 0;
        this.render();
        return;
      }
      if (ev.key === "n") {
        if (this.refuseIfFrozen(feature.id, "note")) return;
        this.focusDrawerNote(feature.id);
        return;
      }
      if (ev.key === "tab" || ev.key === "shift-tab") {
        // Tab moves between the status pills and the criteria (n types a note).
        const next = this.state.drawerFocus === "status" ? "criteria" : "status";
        this.state.drawerFocus = next;
        if (next === "status") this.state.drawerStatusIndex = Math.max(0, DRAWER_STATUSES.indexOf(feature.status));
        this.render();
        return;
      }
      if (this.state.drawerFocus === "status") {
        if (ev.key === "left" || ev.key === "h") {
          this.state.drawerStatusIndex = (this.state.drawerStatusIndex + DRAWER_STATUSES.length - 1) % DRAWER_STATUSES.length;
          this.render();
          return;
        }
        if (ev.key === "right" || ev.key === "l") {
          this.state.drawerStatusIndex = (this.state.drawerStatusIndex + 1) % DRAWER_STATUSES.length;
          this.render();
          return;
        }
        if (ev.key === "enter" || ev.key === " ") {
          this.updateFeatureStatus(feature.id, DRAWER_STATUSES[this.state.drawerStatusIndex]!);
          return;
        }
      }
      if (ev.key === " " && feature.ship_criteria.length > 0) {
        const crit = feature.ship_criteria[this.state.drawerCriterionIndex];
        if (crit) {
          this.toggleCriterion(feature.id, crit.id, !crit.done);
        }
        return;
      }
      if ((ev.key === "down" || ev.key === "j") && feature.ship_criteria.length > 0) {
        this.state.drawerFocus = "criteria";
        this.state.drawerCriterionIndex = Math.min(feature.ship_criteria.length - 1, this.state.drawerCriterionIndex + 1);
        this.render();
        return;
      }
      if ((ev.key === "up" || ev.key === "k") && feature.ship_criteria.length > 0) {
        this.state.drawerFocus = "criteria";
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
      this.switchView("roadmap");
      return;
    }
    if (ev.key === "2") {
      this.switchView("graph");
      return;
    }
    if (ev.key === "3") {
      this.switchView("activity");
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
      this.refresh();
      return;
    }
    if (!feature) {
      if (ev.key === "s" || ev.key === "a" || ev.key === "M") {
        this.openPicker(ev.key === "s" ? "status" : ev.key === "a" ? "area" : "milestone", 1, 3);
        return;
      }
      if (ev.key === "c") {
        this.resetFilters();
        return;
      }
    }
    if (this.state.viewMode === "activity") {
      if (ev.key === "w") {
        this.state.activityWindow = this.state.activityWindow === "7d" ? "30d" : "7d";
        this.state.activitySelectedIndex = 0;
        this.state.activityScrollY = 0;
        this.loadActivity();
        this.render();
        return;
      }
      if (ev.key === "down" || ev.key === "j" || ev.key === "up" || ev.key === "k") {
        const total = visibleActivityEvents(this.state).length;
        const delta = ev.key === "down" || ev.key === "j" ? 1 : -1;
        this.state.activitySelectedIndex = Math.max(0, Math.min(total - 1, this.state.activitySelectedIndex + delta));
        this.render();
        return;
      }
      if (ev.key === "pagedown" || ev.key === "pageup") {
        const total = visibleActivityEvents(this.state).length;
        const delta = ev.key === "pagedown" ? 6 : -6;
        this.state.activitySelectedIndex = Math.max(0, Math.min(total - 1, this.state.activitySelectedIndex + delta));
        this.render();
        return;
      }
      if (ev.key === "enter") {
        const entry = visibleActivityEvents(this.state)[this.state.activitySelectedIndex];
        if (entry && this.state.payload.features.some((f) => f.id === entry.featureId)) this.openDrawer(entry.featureId);
        return;
      }
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
          // Full drawer initialization (fresh scroll, criteria focus, first criterion)
          // instead of a bare drawerFeatureId assignment.
          this.openDrawer(fid);
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
    if (ev.key === "enter") {
      const target = this.state.selectedFeatureId;
      if (target && this.isFeatureVisible(target)) {
        this.openDrawer(target);
      }
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
      if (hit?.kind === "picker-option" || hit?.kind === "picker-backdrop") {
        this.state.pickerScrollY += 3;
        this.render();
        return;
      }
      if (hit?.kind === "health-backdrop" || hit?.kind === "health-jump" || hit?.kind === "health-close") {
        this.state.healthScrollY += 3;
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
      if (hit?.kind === "picker-option" || hit?.kind === "picker-backdrop") {
        this.state.pickerScrollY = Math.max(0, this.state.pickerScrollY - 3);
        this.render();
        return;
      }
      if (hit?.kind === "health-backdrop" || hit?.kind === "health-jump" || hit?.kind === "health-close") {
        this.state.healthScrollY = Math.max(0, this.state.healthScrollY - 3);
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
          this.state.drawerFocus = "status";
          this.state.drawerStatusIndex = Math.max(0, DRAWER_STATUSES.indexOf(String(hit.data) as FeatureStatus));
          this.updateFeatureStatus(this.state.drawerFeatureId, String(hit.data) as FeatureStatus);
        }
        break;
      }
      case "drawer-ship-choice": {
        if (this.state.drawerFeatureId) this.confirmShip(this.state.drawerFeatureId, Number(hit.data ?? 2));
        break;
      }
      case "drawer-dismiss": {
        this.state.drawerFeedback = null;
        this.render();
        break;
      }
      case "drawer-freeze": {
        this.state.healthPanelOpen = true;
        this.state.healthScrollY = 0;
        this.render();
        break;
      }
      case "activity-entry": {
        const idx = Number(hit.data ?? 0);
        this.state.activitySelectedIndex = idx;
        const entry = visibleActivityEvents(this.state)[idx];
        if (entry && this.state.payload.features.some((f) => f.id === entry.featureId)) this.openDrawer(entry.featureId);
        else this.render();
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
          this.render();
        } else {
          this.openPicker(info.kind, info.anchorX, info.anchorY);
        }
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
        this.resetFilters();
        break;
      }
      case "health-toggle": {
        this.state.openPicker = null;
        this.state.healthPanelOpen = !this.state.healthPanelOpen;
        this.state.healthScrollY = 0;
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
        this.refresh();
        break;
      }
      case "dist-filter": {
        const target = String(hit.data ?? "");
        this.state.statusFilter = this.state.statusFilter === target ? "" : target;
        this.state.openPicker = null;
        this.afterFilterChange();
        this.render();
        break;
      }
      case "quit-btn": {
        this.stop();
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

  /** Entering a view selects its first visible item; no drawer opens. */
  private switchView(mode: TuiViewMode): void {
    this.state.viewMode = mode;
    this.state.openPicker = null;
    this.state.drawerFeatureId = null;
    this.state.drawerFocus = "criteria";
    this.state.pendingShip = null;
    this.state.drawerFeedback = null;
    if (mode === "roadmap") {
      this.state.roadmapScrollY = 0;
      this.state.selectedFeatureId = ledgerOrder(this.state)[0] ?? null;
    } else if (mode === "graph") {
      // Fit on entry; select the first node in graph order.
      this.state.graphCamera.initialized = false;
      const filtered = computeFilteredData(this.state);
      const layout = computeWaterfallLayout(filtered.filteredFeatures, this.state.payload.milestones, "overview");
      const first = layout.orderedNodes[0]?.feature.id ?? null;
      this.state.graphSelectedId = first;
      this.state.selectedFeatureId = first;
      this.state.graphHoverId = null;
    } else {
      this.state.activitySelectedIndex = 0;
      this.state.activityScrollY = 0;
      this.loadActivity();
    }
    this.syncMouseMode();
    this.render();
  }

  private applyFilter(kind: PickerKind, value: string): void {
    if (kind === "milestone") this.state.milestoneFilter = value;
    else if (kind === "status") this.state.statusFilter = value;
    else this.state.areaFilter = value;
    this.afterFilterChange();
  }

  /** Scroll positions restart and the selection moves to a visible item after any filter change. */
  private afterFilterChange(): void {
    this.state.roadmapScrollY = 0;
    this.state.activityScrollY = 0;
    this.state.activitySelectedIndex = 0;
    this.reconcileSelection();
  }

  private resetFilters(): void {
    this.state.milestoneFilter = "";
    this.state.statusFilter = "";
    this.state.areaFilter = "";
    this.state.search = "";
    this.state.openPicker = null;
    this.afterFilterChange();
    this.render();
  }

  private openPicker(kind: PickerKind, anchorX: number, anchorY: number): void {
    const filtered = computeFilteredData(this.state);
    const options = buildPickerOptions(kind, this.state, filtered);
    const activeVal = kind === "milestone" ? this.state.milestoneFilter : kind === "status" ? this.state.statusFilter : this.state.areaFilter;
    this.state.openPicker = { kind, x: anchorX, y: anchorY, options };
    this.state.pickerSelectedIndex = Math.max(0, options.findIndex((o) => o.value === activeVal));
    this.state.pickerScrollY = 0;
    this.ensurePickerRowVisible(this.state.pickerSelectedIndex);
    this.render();
  }

  /** Builds (or reuses) the Activity feed for the current window. Errors become the error state. */
  private loadActivity(): void {
    try {
      const key = activityCacheKey(this.service, this.state.activityWindow);
      if (this.state.activity?.key === key && this.state.activity.result) return;
      this.state.activity = { key, result: buildActivity(this.service, { since: this.state.activityWindow }), error: null };
    } catch (error) {
      this.state.activity = { key: "", result: null, error: (error as Error).message || "Failed to load activity" };
    }
  }

  private setToast(kind: "ok" | "err" | "info", message: string): void {
    this.state.toast = { kind, message };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    // Transient notifications expire after 3 seconds; persistent drawer errors are separate state.
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      if (this.stopped) return;
      this.state.toast = null;
      this.render();
    }, 3000);
  }

  private clearToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.state.toast = null;
  }

  /** Feedback on the control that changed. Successes fade after 3 s; failures stay until dismissed. */
  private setDrawerFeedback(key: string, kind: "ok" | "err" | "info", message: string): void {
    const fb = { key, kind, message };
    this.state.drawerFeedback = fb;
    this.feedbackRevealPending = true;
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = null;
    if (kind !== "err") {
      this.feedbackTimer = setTimeout(() => {
        this.feedbackTimer = null;
        if (this.stopped || this.state.drawerFeedback !== fb) return;
        this.state.drawerFeedback = null;
        this.render();
      }, 3000);
    }
  }

  private isFrozen(): boolean {
    return this.state.payload.check.editable === false;
  }

  /** Refuses an edit while the roadmap has write-blocking errors, saying so on the control. */
  private refuseIfFrozen(featureId: string, key: string): boolean {
    if (!this.isFrozen()) return false;
    const n = (this.state.payload.check.blocking ?? this.state.payload.check.errors).length;
    this.state.drawerFeatureId = featureId;
    this.setDrawerFeedback(key, "err", `Editing paused — ${n} ${n === 1 ? "error" : "errors"} to fix first. Press e for Health.`);
    this.render();
    return true;
  }

  /** Outcome-aware refresh shared by R and the Live pill. */
  private refresh(): void {
    const ok = this.reloadSync();
    if (ok) {
      if (this.state.viewMode === "activity") {
        this.state.activity = null;
        this.loadActivity();
      }
      this.setToast("ok", "Refreshed from disk");
    } else {
      this.setToast("err", `Refresh failed: ${this.state.loadError ?? "unknown error"}`);
    }
    this.render();
  }

  private toggleMouse(): void {
    this.state.mouseEnabled = !this.state.mouseEnabled;
    this.syncMouseMode();
    this.setToast(
      "info",
      this.state.mouseEnabled ? "Mouse on (m turns it off for native selection)" : "Mouse off: native selection works; m turns it back on"
    );
    this.render();
  }

  private reloadSync(options: { preserveFeedback?: boolean } = {}): boolean {
    let loaded: LoadedStore;
    let fastCheck: CheckResult;
    try {
      loaded = this.service.load();
      fastCheck = this.service.check();
    } catch (error) {
      // Config can be transiently missing or malformed while a watcher or manual reload fires.
      // Keep the last good snapshot on screen, surface the failure, and recover on repair.
      this.handleReloadFailure(error);
      return false;
    }
    const hadLoadError = this.state.loadError !== null;
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
    const beadsWanted = !this.state.noBeads && loaded.config.integrations.beads.enabled;
    this.state.payload = {
      config: loaded.config,
      milestones,
      features: loaded.features,
      check: checkPayload(fastCheck),
      // Prior Beads data must not survive a snapshot where Beads is out of scope.
      beads: beadsWanted ? this.state.payload.beads : {},
    };
    if (beadsWanted) {
      void this.refreshBeadsAsync();
    } else {
      // Advance the generation so any in-flight Beads lookup is discarded and clear loading.
      this.loadGeneration++;
      this.state.beadsLoading = false;
    }
    // Reloads clear transient feedback; a failure stays on its control until dismissed.
    if (!options.preserveFeedback && this.state.drawerFeedback?.kind !== "err") {
      this.state.drawerFeedback = null;
    }
    if (hadLoadError) {
      this.state.loadError = null;
      this.setToast("ok", "Recovered roadmap from disk");
    }
    if (this.state.viewMode === "activity" && this.state.activity) this.loadActivity();
    this.reconcileAfterPayloadChange();
    this.render();
    return true;
  }

  private handleReloadFailure(error: unknown): void {
    const message = (error as Error).message || "Unknown reload failure";
    this.state.loadError = message;
    this.state.beadsLoading = false;
    this.setToast("err", `Reload failed: ${message}`);
    this.render();
  }

  private openDrawer(featureId: string): void {
    this.state.selectedFeatureId = featureId;
    this.state.graphSelectedId = featureId;
    this.state.drawerFeatureId = featureId;
    this.state.drawerScrollY = 0;
    this.state.drawerFocus = "criteria";
    this.state.drawerCriterionIndex = 0;
    this.state.drawerFeedback = null;
    this.state.pendingShip = null;
    this.render();
  }

  private closeDrawer(): void {
    this.state.drawerFeatureId = null;
    this.state.drawerFocus = "criteria";
    this.state.drawerFeedback = null;
    this.state.pendingShip = null;
    this.render();
  }

  private focusDrawerNote(featureId: string): void {
    this.state.drawerFocus = "note";
    this.state.noteCursor = segmentText(this.state.noteDrafts[featureId] ?? "").length;
    // Reveal the inline input on short panes during the next frame.
    this.noteRevealPending = true;
    this.render();
  }

  private copyActiveFeatureId(explicitId?: string): void {
    const exists = (id: string | null | undefined): id is string =>
      Boolean(id) && this.state.payload.features.some((f) => f.id === id);
    const visible = this.visibleFeatureIds();
    const target =
      (exists(explicitId) && explicitId) ||
      (exists(this.state.drawerFeatureId) && this.state.drawerFeatureId) ||
      (this.state.viewMode === "graph" &&
        this.state.graphSelectedId &&
        visible.has(this.state.graphSelectedId) &&
        this.state.graphSelectedId) ||
      (this.state.selectedFeatureId &&
        visible.has(this.state.selectedFeatureId) &&
        this.state.selectedFeatureId) ||
      null;
    if (!target) {
      this.setToast("info", "No feature selected to copy");
      this.render();
      return;
    }
    this.session.copyToClipboard(target);
    this.setToast("ok", `Copied ID to clipboard: ${target}`);
    this.render();
  }

  private toggleCriterion(featureId: string, criterionId: string, done: boolean): void {
    const key = `crit:${criterionId}`;
    if (this.refuseIfFrozen(featureId, key)) return;
    try {
      this.service.checkFeatureCriterion(featureId, criterionId, done);
      this.setDrawerFeedback(key, "ok", done ? "Saved — done" : "Saved — reopened");
      this.setToast("ok", "Saved criterion");
      this.reloadSync({ preserveFeedback: true });
    } catch (error) {
      this.setDrawerFeedback(key, "err", `Couldn't save: ${(error as Error).message}`);
      this.render();
    }
  }

  /** Choosing shipped with open criteria opens the confirm first (soft invariant). */
  private updateFeatureStatus(featureId: string, status: FeatureStatus): void {
    if (this.refuseIfFrozen(featureId, "status")) return;
    const feature = this.state.payload.features.find((f) => f.id === featureId);
    if (!feature || feature.status === status) {
      this.render();
      return;
    }
    if (status === "shipped" && feature.ship_criteria.some((c) => !c.done)) {
      this.state.pendingShip = { featureId, choice: 0 };
      this.render();
      return;
    }
    this.writeStatus(featureId, { id: featureId, status }, `Saved — ${statusLabel(status)}`);
  }

  private confirmShip(featureId: string, choice: number): void {
    const feature = this.state.payload.features.find((f) => f.id === featureId);
    this.state.pendingShip = null;
    if (!feature || choice === 2) {
      this.state.drawerFocus = "status";
      this.state.drawerStatusIndex = DRAWER_STATUSES.indexOf("shipped");
      this.render();
      return;
    }
    const open = feature.ship_criteria.filter((c) => !c.done).map((c) => c.id);
    if (choice === 0) {
      this.writeStatus(featureId, { id: featureId, status: "shipped", check_criteria: open }, "Saved — shipped with every criterion done");
    } else {
      this.writeStatus(featureId, { id: featureId, status: "shipped" }, "Saved — shipped with open criteria");
    }
  }

  private writeStatus(featureId: string, input: { id: string; status: FeatureStatus; check_criteria?: string[] }, okMessage: string): void {
    try {
      this.service.logFeaturePulse(input);
      this.setDrawerFeedback("status", "ok", okMessage);
      this.setToast("ok", okMessage);
      this.reloadSync({ preserveFeedback: true });
    } catch (error) {
      this.setDrawerFeedback("status", "err", `Couldn't save: ${(error as Error).message}`);
      this.render();
    }
  }

  private submitPulseNote(featureId: string): void {
    const note = (this.state.noteDrafts[featureId] ?? "").trim();
    if (!note) return;
    if (this.refuseIfFrozen(featureId, "note")) return;
    try {
      this.service.addFeatureNote(featureId, note);
      delete this.state.noteDrafts[featureId];
      this.state.noteCursor = 0;
      this.setDrawerFeedback("note", "ok", "Logged");
      this.setToast("ok", "Logged note");
      this.reloadSync({ preserveFeedback: true });
    } catch (error) {
      this.setDrawerFeedback("note", "err", `Couldn't save: ${(error as Error).message}`);
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
    const glyphs = segmentText(this.state.noteDrafts[featureId] ?? "");
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
    if (!ev.ctrl && !ev.alt && isPrintableTextInput(ev.key)) {
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
    if (!nextId) {
      this.render();
      return;
    }
    if (this.state.viewMode === "graph") {
      this.state.graphSelectedId = nextId;
      this.revealGraphNode(nextId);
      this.render();
      return;
    }
    this.revealListSelection(nextId);
    this.render();
  }

  /**
   * Scrolls the active cards/board view by the selected card's real row geometry so
   * every keyboard selection stays on screen (replacing the old fixed two-row nudge).
   */
  private revealListSelection(featureId: string): void {
    if (this.state.viewMode !== "roadmap") return;
    const bounds = this.lastRoadmapBounds.get(featureId);
    if (!bounds) return;
    const viewH = Math.max(1, this.mainRect.h);
    let scroll = this.state.roadmapScrollY;
    if (bounds.y < scroll) {
      scroll = bounds.y;
    } else if (bounds.y + bounds.h > scroll + viewH) {
      scroll = bounds.y + bounds.h - viewH;
    }
    this.state.roadmapScrollY = Math.max(0, Math.min(this.lastRoadmapMaxScroll, scroll));
  }

  /**
   * Pans the graph camera minimally (existing tx/ty translation, then clamp) so the
   * selected node's full bounding box is inside the viewport.
   */
  private revealGraphNode(featureId: string): void {
    const layout = this.lastGraphLayout;
    const node = layout?.nodes.get(featureId);
    if (!layout || !node) return;
    const vpRect = getGraphViewportRect(this.mainRect);
    const innerX = vpRect.x + 1;
    const innerY = vpRect.y + 1;
    const innerW = Math.max(1, vpRect.w - 2);
    const innerH = Math.max(1, vpRect.h - 2);
    const cam = this.state.graphCamera;
    const left = innerX + cam.tx + node.x;
    const top = innerY + cam.ty + node.y;
    if (left < innerX) {
      cam.tx += innerX - left;
    } else if (left + node.w > innerX + innerW) {
      cam.tx -= left + node.w - (innerX + innerW);
    }
    if (top < innerY) {
      cam.ty += innerY - top;
    } else if (top + node.h > innerY + innerH) {
      cam.ty -= top + node.h - (innerY + innerH);
    }
    clampGraphCamera(layout.stageW, layout.stageH, vpRect, cam);
  }

  /** Feature ids present under the active filters — the ids keyboard actions may address. */
  private visibleFeatureIds(): Set<string> {
    return new Set(computeFilteredData(this.state).filteredFeatures.map((f) => f.id));
  }

  private isFeatureVisible(featureId: string): boolean {
    return this.visibleFeatureIds().has(featureId);
  }

  /**
   * Nudges the picker scroll window so the keyboard-focused option stays inside it.
   * Wheel offsets are respected; only out-of-window focus moves the window.
   */
  private ensurePickerRowVisible(index: number): void {
    const picker = this.state.openPicker;
    if (!picker) return;
    const maxRows = pickerVisibleRows(this.session.height, picker.options.length);
    const maxScroll = Math.max(0, picker.options.length - maxRows);
    const scroll = this.state.pickerScrollY;
    if (index < scroll) {
      this.state.pickerScrollY = index;
    } else if (index >= scroll + maxRows) {
      this.state.pickerScrollY = index - maxRows + 1;
    }
    this.state.pickerScrollY = Math.max(0, Math.min(this.state.pickerScrollY, maxScroll));
  }

  /**
   * Keeps selectedFeatureId (and its graph mirror) pointing at a feature visible under
   * the active filters, moving the highlight to the first visible feature otherwise.
   * Reconciling never opens the drawer.
   */
  private reconcileSelection(): void {
    const filteredFeatures = computeFilteredData(this.state).filteredFeatures;
    const current = this.state.selectedFeatureId;
    if (current && filteredFeatures.some((f) => f.id === current)) {
      if (
        this.state.graphSelectedId &&
        !filteredFeatures.some((f) => f.id === this.state.graphSelectedId)
      ) {
        this.state.graphSelectedId = current;
      }
      return;
    }
    const next = ledgerOrder(this.state)[0] ?? filteredFeatures[0]?.id ?? null;
    this.state.selectedFeatureId = next;
    this.state.graphSelectedId = next;
  }

  /**
   * Reconciles drawer and selection state after the payload snapshot is replaced: a
   * feature removed on disk closes the drawer (releasing any note draft input), and the
   * selection moves to a still-visible feature without opening anything.
   */
  private reconcileAfterPayloadChange(): void {
    const drawerId = this.state.drawerFeatureId;
    if (drawerId && !this.state.payload.features.some((f) => f.id === drawerId)) {
      this.state.drawerFeatureId = null;
      this.state.drawerFocus = "criteria";
      this.state.drawerFeedback = null;
      this.state.pendingShip = null;
      delete this.state.noteDrafts[drawerId];
      this.state.noteCursor = 0;
    }
    this.reconcileSelection();
  }

  private handleGraphClick(targetNodeId: string | null): void {
    if (!targetNodeId) {
      this.state.graphSelectedId = null;
      this.render();
      return;
    }
    if (this.state.graphHoverEnabled) {
      this.openDrawer(targetNodeId);
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
    if (this.state.viewMode === "roadmap") {
      this.state.roadmapScrollY = Math.max(0, Math.min(this.lastRoadmapMaxScroll, this.state.roadmapScrollY + delta));
    } else if (this.state.viewMode === "activity") {
      const total = visibleActivityEvents(this.state).length;
      this.state.activitySelectedIndex = Math.max(0, Math.min(total - 1, this.state.activitySelectedIndex + delta));
    }
    this.render();
  }

  private scrollAtPoint(_x: number, _y: number, delta: number, _hit: HitRegion | null): void {
    if (this.state.viewMode === "roadmap") {
      this.state.roadmapScrollY = Math.max(0, Math.min(this.lastRoadmapMaxScroll, this.state.roadmapScrollY + delta));
      this.render();
      return;
    }
    if (this.state.viewMode === "activity") {
      this.state.activityScrollY = Math.max(0, Math.min(this.lastActivityMaxScroll, this.state.activityScrollY + delta));
      this.render();
    }
  }
}

/** The check fields the TUI payload carries (editable/blocking/stale drive the drawer freeze). */
function checkPayload(check: CheckResult): RoadmapViewPayload["check"] {
  return {
    ok: check.ok,
    errors: check.errors,
    warnings: check.warnings,
    editable: check.editable ?? check.ok,
    blocking: check.blocking ?? check.errors,
    stale: check.stale ?? false,
  };
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
  const { promise, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();
  let controller: TuiController;
  let offSignal: (() => void) | undefined;
  try {
    controller = new TuiController({
      rootDir,
      noBeads: options.noBeads,
      beadsClient: options.beadsClient,
      session,
      onExit: () => {
        offSignal?.();
        resolveDone();
      },
    });
    // A signal must behave like an interactive exit: cancel pending watch reloads, restore
    // the terminal, resolve the run promise. render() is inert once stopped, so no frame is
    // written after the terminal is restored.
    offSignal = session.onSignal?.(() => controller.stop());
    controller.start();
  } catch (error) {
    offSignal?.();
    session.leave();
    rejectDone(error);
  }
  await promise;
}
