import type { BeadsClient } from "../beads";
import { buildRoadmapViewPayload } from "../view";
import { RoadmapService } from "../store";
import { NodeTerminalSession, type InputEvent, type KeyEvent, type MouseEvent, type TerminalSession } from "./input";
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
  private mainRect: Rect = { x: 0, y: 0, w: 80, h: 20 };
  private loadGeneration = 0;

  constructor(options: TuiControllerOptions) {
    this.service = options.service ?? new RoadmapService(options.rootDir);
    this.service.requireInitialized();
    this.beadsClient = options.beadsClient;
    this.session = options.session;
    this.onExit = options.onExit;

    const loaded = this.service.load();
    const fastCheck = this.service.check(loaded);
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
      { noBeads: Boolean(options.noBeads), beadsLoading: beadsWanted }
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
    this.session.enter({ mouse: this.state.mouseEnabled, hover: this.state.graphHoverEnabled });
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
    this.session.leave();
    this.onExit?.();
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
    let y = renderHeaderAndKpis(buf, w, this.state, filtered);
    y = renderTabsAndFilters(buf, y, w, this.state, filtered);

    const contentH = Math.max(4, h - y - 1);
    const rect: Rect = { x: 0, y, w, h: contentH };
    this.mainRect = rect;

    if (this.state.viewMode === "cards") {
      const res = renderCardsView(buf, rect, this.state, filtered);
      this.lastCardsMaxScroll = res.maxScrollY;
      this.lastOrderedIds = res.orderedFeatureIds;
    } else if (this.state.viewMode === "board") {
      const res = renderBoardView(buf, rect, this.state, filtered);
      this.lastBoardCols = res.columns;
      this.lastOrderedIds = res.orderedFeatureIds;
    } else {
      buf.drawBox(rect.x + 1, rect.y, Math.max(20, rect.w - 2), rect.h, {
        borderStyle: { fg: TUI_PALETTE.border },
        fillStyle: { bg: TUI_PALETTE.surface },
        title: "Waterfall Dependency Graph",
        titleStyle: { fg: TUI_PALETTE.accent, bold: true },
      });
      buf.writeText(
        rect.x + 3,
        rect.y + 2,
        `Showing ${filtered.filteredFeatures.length} feature(s) in Graph view.`,
        rect.w - 6,
        { fg: TUI_PALETTE.muted }
      );
      this.lastOrderedIds = filtered.filteredFeatures.map((f) => f.id);
    }

    renderFloatingPicker(buf, w, h, this.state);
    renderHealthOverlay(buf, w, h, this.state);
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

    if (ev.key === "q") {
      this.stop();
      return;
    }

    if (ev.key === "escape") {
      if (this.state.drawerFeatureId) {
        this.state.drawerFeatureId = null;
        this.render();
      } else if (this.state.toast) {
        this.state.toast = null;
        this.render();
      }
      return;
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
      this.state.drawerFeatureId = this.state.selectedFeatureId;
      this.render();
    }
  }

  private handleMouse(ev: MouseEvent): void {
    const hit = this.currentBuf.hitTest(ev.x, ev.y);
    if (ev.action === "wheel-down") {
      this.scrollAtPoint(ev.x, ev.y, 3, hit);
      return;
    }
    if (ev.action === "wheel-up") {
      this.scrollAtPoint(ev.x, ev.y, -3, hit);
      return;
    }
    if (ev.action !== "down" || ev.button !== "left" || !hit) return;

    this.state.searchFocused = false;
    switch (hit.kind) {
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
          this.state.selectedFeatureId = targetId;
          this.state.drawerFeatureId = targetId;
        }
        this.render();
        break;
      }
      case "mouse-toggle": {
        this.toggleMouse();
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
          this.state.selectedFeatureId = fid;
          this.state.drawerFeatureId = fid;
          this.render();
        }
        break;
      }
    }
  }

  private switchView(mode: TuiViewMode): void {
    this.state.viewMode = mode;
    this.state.openPicker = null;
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
    this.session.setMouseMode({
      enabled: this.state.mouseEnabled,
      hover: this.state.graphHoverEnabled,
    });
    this.state.toast = {
      kind: "info",
      message: this.state.mouseEnabled
        ? "Mouse mode ON (press m to toggle native text selection)"
        : "Mouse mode OFF (native drag-select enabled; press m to re-enable)",
    };
    this.render();
  }

  private reloadSync(): void {
    const loaded = this.service.load();
    const fastCheck = this.service.check(loaded);
    this.state.payload = {
      config: loaded.config,
      milestones: loaded.milestones,
      features: loaded.features,
      check: { ok: fastCheck.ok, errors: fastCheck.errors, warnings: fastCheck.warnings },
      beads: this.state.payload.beads,
    };
    this.render();
    if (!this.state.noBeads && loaded.config.integrations.beads.enabled) {
      void this.refreshBeadsAsync();
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
    this.state.selectedFeatureId = this.lastOrderedIds[nextIdx] ?? null;
    this.scrollActiveView(delta * 2);
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
