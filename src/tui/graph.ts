import type { Feature, Milestone } from "../types";
import { ScreenBuffer, TUI_PALETTE, textCellWidth, truncateText, type CellStyle } from "./screen";
import {
  drawPill,
  getStatusStyle,
  renderFilteredEmpty,
  type FilteredData,
  type GraphCameraState,
  type GraphZoomLevel,
  type Rect,
  type TuiState,
} from "./views";

export interface WaterfallSpec {
  zoom: GraphZoomLevel;
  label: string;
  nodeW: number;
  nodeH: number;
  colGap: number;
  rowGap: number;
  padX: number;
  padY: number;
}

export const WATERFALL_SPECS: Record<GraphZoomLevel, WaterfallSpec> = {
  full: {
    zoom: "full",
    label: "100%",
    nodeW: 28,
    nodeH: 4,
    colGap: 3,
    rowGap: 3,
    padX: 2,
    padY: 1,
  },
  compact: {
    zoom: "compact",
    label: "60%",
    nodeW: 24,
    nodeH: 3,
    colGap: 2,
    rowGap: 2,
    padX: 2,
    padY: 1,
  },
  overview: {
    zoom: "overview",
    label: "30%",
    nodeW: 20,
    nodeH: 1,
    colGap: 2,
    rowGap: 2,
    padX: 2,
    padY: 1,
  },
};

export interface PlacedGraphNode {
  feature: Feature;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface WaterfallLayout {
  spec: WaterfallSpec;
  stageW: number;
  stageH: number;
  nodes: Map<string, PlacedGraphNode>;
  orderedNodes: PlacedGraphNode[];
  edges: GraphEdge[];
  ancestors: Map<string, Set<string>>;
  descendants: Map<string, Set<string>>;
  /** Structure key (visible features and their dependencies); a change re-fits the camera. */
  layoutKey: string;
  /** World-space cells per edge (index-aligned with `edges`). */
  routes: RouteCell[][];
}

export interface WaterfallLayoutOptions {
  /** Upper bound on node width (Fit shrinks overview nodes so wide layers fit). */
  nodeWCap?: number;
  colGap?: number;
}

const ZOOM_ORDER: GraphZoomLevel[] = ["overview", "compact", "full"];

export function stepGraphZoom(current: GraphZoomLevel, delta: number): GraphZoomLevel {
  const idx = ZOOM_ORDER.indexOf(current);
  const next = Math.max(0, Math.min(ZOOM_ORDER.length - 1, idx + delta));
  return ZOOM_ORDER[next] ?? current;
}

/** Node width follows the title (plus chrome) up to the density's cap. */
function nodeWidth(f: Feature, spec: WaterfallSpec, cap: number): number {
  const titleW = textCellWidth(f.title);
  if (spec.nodeH === 1) return Math.max(Math.min(8, cap), Math.min(cap, titleW + 4));
  if (spec.nodeH === 3) return Math.max(Math.min(14, cap), Math.min(cap, titleW + 6));
  return Math.max(Math.min(18, cap), Math.min(cap, titleW + 6));
}

/**
 * Computes a cycle-safe, top-to-bottom parent-barycenter waterfall layout at the chosen density.
 *
 * Every edge gets its own route: edges into one node arrive at distinct cells along its top,
 * each horizontal jog gets a channel row in its gap (jogs share a row only when their spans do
 * not overlap), and gaps grow with the number of channels they need. Skip-layer edges drop
 * through a free lane between the nodes of the layers they pass.
 */
export function computeWaterfallLayout(
  features: Feature[],
  milestones: Milestone[],
  zoom: GraphZoomLevel,
  opts: WaterfallLayoutOptions = {}
): WaterfallLayout {
  const spec = WATERFALL_SPECS[zoom];
  const cap = Math.max(6, Math.min(spec.nodeW, opts.nodeWCap ?? spec.nodeW));
  const colGap = opts.colGap ?? spec.colGap;
  const milestoneOrder = new Map(milestones.map((m) => [m.id, m.order]));
  const byId = new Map(features.map((f) => [f.id, f]));
  const visibleSet = new Set(byId.keys());
  const layerMap = new Map<string, number>();

  function computeLayer(id: string, visiting: Set<string>): number {
    if (layerMap.has(id)) return layerMap.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const feat = byId.get(id);
    let maxDep = -1;
    if (feat) {
      for (const dep of feat.depends_on) {
        if (visibleSet.has(dep) && dep !== id) {
          maxDep = Math.max(maxDep, computeLayer(dep, visiting));
        }
      }
    }
    visiting.delete(id);
    const layer = maxDep + 1;
    layerMap.set(id, layer);
    return layer;
  }

  for (const f of features) computeLayer(f.id, new Set());

  const rows = new Map<number, Feature[]>();
  let maxLayer = 0;
  for (const f of features) {
    const layer = layerMap.get(f.id) ?? 0;
    maxLayer = Math.max(maxLayer, layer);
    const list = rows.get(layer) ?? [];
    list.push(f);
    rows.set(layer, list);
  }

  const compareBase = (a: Feature, b: Feature): number => {
    const ma = milestoneOrder.get(a.milestone) ?? 9999;
    const mb = milestoneOrder.get(b.milestone) ?? 9999;
    if (ma !== mb) return ma - mb;
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const colIndexMap = new Map<string, number>();
  for (let layer = 0; layer <= maxLayer; layer++) {
    const list = rows.get(layer) ?? [];
    if (layer === 0) {
      list.sort(compareBase);
    } else {
      list.sort((a, b) => {
        const avgParentCol = (feat: Feature): number => {
          let sum = 0;
          let count = 0;
          for (const dep of feat.depends_on) {
            if (visibleSet.has(dep) && colIndexMap.has(dep)) {
              sum += colIndexMap.get(dep)!;
              count += 1;
            }
          }
          return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
        };
        const pa = avgParentCol(a);
        const pb = avgParentCol(b);
        if (Math.abs(pa - pb) > 0.001) return pa - pb;
        return compareBase(a, b);
      });
    }
    list.forEach((f, idx) => colIndexMap.set(f.id, idx));
  }

  const widths = new Map(features.map((f) => [f.id, nodeWidth(f, spec, cap)]));
  const rowWidth = (list: Feature[]) =>
    list.reduce((sum, f) => sum + widths.get(f.id)!, 0) + Math.max(0, list.length - 1) * colGap;
  let maxRowW = 0;
  for (let layer = 0; layer <= maxLayer; layer++) maxRowW = Math.max(maxRowW, rowWidth(rows.get(layer) ?? []));
  let stageW = Math.max(cap + spec.padX * 2, spec.padX * 2 + maxRowW);

  // Horizontal placement (rows centred on the stage); vertical placement waits for the channels.
  const nodes = new Map<string, PlacedGraphNode>();
  const orderedNodes: PlacedGraphNode[] = [];
  for (let layer = 0; layer <= maxLayer; layer++) {
    const list = rows.get(layer) ?? [];
    let x = Math.floor((stageW - rowWidth(list)) / 2);
    for (const f of list) {
      const placed: PlacedGraphNode = { feature: f, x, y: 0, w: widths.get(f.id)!, h: spec.nodeH, layer };
      nodes.set(f.id, placed);
      orderedNodes.push(placed);
      x += placed.w + colGap;
    }
  }

  const edges: GraphEdge[] = [];
  const outgoing = new Map<string, string[]>();
  for (const f of features) {
    for (const dep of f.depends_on) {
      if (visibleSet.has(dep) && dep !== f.id) {
        edges.push({ from: dep, to: f.id });
        const arr = outgoing.get(dep) ?? [];
        arr.push(f.id);
        outgoing.set(dep, arr);
      }
    }
  }

  // ---- anchors: departures at the parent's centre, arrivals spread along the child's top.
  const center = (n: PlacedGraphNode) => n.x + Math.floor(n.w / 2);
  const arrivalX = new Map<number, number>();
  const incoming = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const list = incoming.get(e.to) ?? [];
    list.push(i);
    incoming.set(e.to, list);
  });
  for (const [to, list] of incoming) {
    const child = nodes.get(to)!;
    list.sort((a, b) => center(nodes.get(edges[a]!.from)!) - center(nodes.get(edges[b]!.from)!));
    const inner = Math.max(1, child.w - 2);
    list.forEach((edgeIdx, i) => {
      const x = list.length === 1 ? center(child) : child.x + 1 + Math.floor(((i + 1) * inner) / (list.length + 1));
      arrivalX.set(edgeIdx, Math.min(child.x + child.w - 2, Math.max(child.x + 1, x)));
    });
  }

  // ---- lanes for skip-layer edges and jogs per gap
  type Jog = { edge: number; gap: number; left: number; right: number; row: number; which: 1 | 2 };
  const jogs: Jog[] = [];
  const lanes = new Map<number, number>();
  const usedLanes: Array<{ x: number; from: number; to: number }> = [];
  const nodeBlocks = (x: number, layerFrom: number, layerTo: number): boolean => {
    for (const n of orderedNodes) {
      if (n.layer < layerFrom || n.layer > layerTo) continue;
      if (x >= n.x - 1 && x <= n.x + n.w) return true;
    }
    return false;
  };
  edges.forEach((e, i) => {
    const p = nodes.get(e.from)!;
    const c = nodes.get(e.to)!;
    if (c.layer <= p.layer) return;
    const px = center(p);
    const ax = arrivalX.get(i)!;
    if (c.layer === p.layer + 1) {
      if (px !== ax) jogs.push({ edge: i, gap: p.layer, left: Math.min(px, ax), right: Math.max(px, ax), row: 0, which: 1 });
      return;
    }
    const from = p.layer + 1;
    const to = c.layer - 1;
    const laneFree = (x: number) =>
      x >= 0 && !nodeBlocks(x, from, to) && !usedLanes.some((u) => u.x === x && u.from <= to && u.to >= from);
    let lane = -1;
    for (let d = 0; d < stageW + 4 && lane < 0; d++) {
      for (const cand of d === 0 ? [px] : [px + d, px - d]) {
        if (laneFree(cand)) {
          lane = cand;
          break;
        }
      }
    }
    if (lane < 0) lane = stageW++;
    if (lane >= stageW) stageW = lane + 2;
    usedLanes.push({ x: lane, from, to });
    lanes.set(i, lane);
    if (lane !== px) jogs.push({ edge: i, gap: p.layer, left: Math.min(px, lane), right: Math.max(px, lane), row: 0, which: 1 });
    if (lane !== ax) jogs.push({ edge: i, gap: c.layer - 1, left: Math.min(lane, ax), right: Math.max(lane, ax), row: 0, which: 2 });
  });

  // Interval packing: jogs share a channel row only when their spans are disjoint.
  const channelsPerGap: number[] = new Array(Math.max(1, maxLayer)).fill(0);
  for (let g = 0; g < maxLayer; g++) {
    const gapJogs = jogs.filter((j) => j.gap === g).sort((a, b) => a.left - b.left || a.right - b.right);
    const rowRight: number[] = [];
    for (const j of gapJogs) {
      let r = rowRight.findIndex((right) => right < j.left - 1);
      if (r < 0) {
        r = rowRight.length;
        rowRight.push(j.right);
      } else {
        rowRight[r] = j.right;
      }
      j.row = r;
    }
    channelsPerGap[g] = rowRight.length;
  }

  // Vertical placement: each gap holds its channels plus the arrowhead row.
  const layerY: number[] = [];
  let y = spec.padY;
  for (let layer = 0; layer <= maxLayer; layer++) {
    layerY[layer] = y;
    y += spec.nodeH + (layer < maxLayer ? Math.max(spec.rowGap, (channelsPerGap[layer] ?? 0) + 1) : 0);
  }
  for (const n of orderedNodes) n.y = layerY[n.layer]!;
  const stageH = Math.max(spec.nodeH + spec.padY * 2, y + spec.padY);

  const gapTop = (g: number) => layerY[g]! + spec.nodeH;
  const routes: RouteCell[][] = edges.map((e, i) => {
    const p = nodes.get(e.from)!;
    const c = nodes.get(e.to)!;
    if (c.layer <= p.layer) return EMPTY_ROUTE_CELLS;
    const px = center(p);
    const ax = arrivalX.get(i)!;
    const y1 = p.y + p.h;
    const arrowY = c.y - 1;
    const pts: RoutePoint[] = [{ x: px, y: y1 }];
    const jog1 = jogs.find((j) => j.edge === i && j.which === 1);
    const jog2 = jogs.find((j) => j.edge === i && j.which === 2);
    if (c.layer === p.layer + 1) {
      if (jog1) {
        const ch = gapTop(p.layer) + jog1.row;
        pts.push({ x: px, y: ch }, { x: ax, y: ch });
      }
      pts.push({ x: ax, y: arrowY });
    } else {
      const lane = lanes.get(i)!;
      if (jog1) {
        const ch1 = gapTop(p.layer) + jog1.row;
        pts.push({ x: px, y: ch1 }, { x: lane, y: ch1 });
      }
      if (jog2) {
        const ch2 = gapTop(c.layer - 1) + jog2.row;
        pts.push({ x: lane, y: ch2 }, { x: ax, y: ch2 });
      }
      pts.push({ x: ax, y: arrowY });
    }
    return rasterizeRoute(pts, false);
  });

  const ancestors = new Map<string, Set<string>>();
  const descendants = new Map<string, Set<string>>();
  const collectAncestors = (id: string, acc: Set<string>) => {
    const feat = byId.get(id);
    if (!feat) return;
    for (const dep of feat.depends_on) {
      if (visibleSet.has(dep) && dep !== id && !acc.has(dep)) {
        acc.add(dep);
        collectAncestors(dep, acc);
      }
    }
  };
  const collectDescendants = (id: string, acc: Set<string>) => {
    for (const next of outgoing.get(id) ?? []) {
      if (!acc.has(next)) {
        acc.add(next);
        collectDescendants(next, acc);
      }
    }
  };
  for (const f of features) {
    const anc = new Set<string>();
    collectAncestors(f.id, anc);
    ancestors.set(f.id, anc);
    const desc = new Set<string>();
    collectDescendants(f.id, desc);
    descendants.set(f.id, desc);
  }

  return {
    spec,
    stageW,
    stageH,
    nodes,
    orderedNodes,
    edges,
    ancestors,
    descendants,
    layoutKey: features.map((f) => `${f.id}:${f.depends_on.join("+")}`).join(","),
    routes,
  };
}

export function getGraphViewportRect(rect: Rect): Rect {
  return {
    x: rect.x + 1,
    y: rect.y + 1,
    w: Math.max(12, rect.w - 2),
    h: Math.max(4, rect.h - 1),
  };
}

export function clampGraphCamera(
  stageW: number,
  stageH: number,
  vpRect: Rect,
  cam: GraphCameraState
): void {
  const innerW = Math.max(1, vpRect.w - 2);
  const innerH = Math.max(1, vpRect.h - 2);
  const keepX = Math.min(10, Math.floor(innerW * 0.4), Math.floor(stageW * 0.5));
  const keepY = Math.min(5, Math.floor(innerH * 0.4), Math.floor(stageH * 0.5));
  cam.tx = Math.min(innerW - keepX, Math.max(keepX - stageW, cam.tx));
  cam.ty = Math.min(innerH - keepY, Math.max(keepY - stageH, cam.ty));
}

export function resetGraphCamera(
  features: Feature[],
  milestones: Milestone[],
  vpRect: Rect,
  cam: GraphCameraState
): WaterfallLayout {
  cam.zoom = "full";
  cam.nodeWCap = undefined;
  cam.overflow = false;
  const layout = computeWaterfallLayout(features, milestones, "full");
  const innerW = Math.max(1, vpRect.w - 2);
  const innerH = Math.max(1, vpRect.h - 2);
  cam.tx = Math.floor((innerW - layout.stageW) / 2);
  cam.ty = layout.stageH <= innerH ? Math.floor((innerH - layout.stageH) / 2) : 0;
  clampGraphCamera(layout.stageW, layout.stageH, vpRect, cam);
  return layout;
}

/** Layout for the camera's current density (Fit's overview width cap included). */
export function layoutForCamera(features: Feature[], milestones: Milestone[], cam: GraphCameraState): WaterfallLayout {
  return cam.zoom === "overview" && cam.nodeWCap
    ? computeWaterfallLayout(features, milestones, "overview", { nodeWCap: cam.nodeWCap, colGap: 1 })
    : computeWaterfallLayout(features, milestones, cam.zoom);
}

/**
 * Fits the graph: the densest-first density whose stage fits the viewport, then an overview whose
 * nodes shrink until the widest layer fits. When nothing fits, `cam.overflow` is set: the view shows
 * a cue and keyboard selection pans to every node.
 */
export function fitGraphCamera(
  features: Feature[],
  milestones: Milestone[],
  vpRect: Rect,
  cam: GraphCameraState
): WaterfallLayout {
  const innerW = Math.max(1, vpRect.w - 2);
  const innerH = Math.max(1, vpRect.h - 2);
  const fits = (l: WaterfallLayout) => l.stageW <= innerW && l.stageH <= innerH;
  let chosen: WaterfallLayout | null = null;
  let chosenCap: number | undefined;
  for (const zoom of ["full", "compact", "overview"] as GraphZoomLevel[]) {
    const layout = computeWaterfallLayout(features, milestones, zoom);
    if (fits(layout)) {
      chosen = layout;
      break;
    }
  }
  if (!chosen) {
    // Shrink overview nodes until the widest layer fits the viewport width.
    let best: WaterfallLayout | null = null;
    for (let capW = WATERFALL_SPECS.overview.nodeW; capW >= 6; capW--) {
      const layout = computeWaterfallLayout(features, milestones, "overview", { nodeWCap: capW, colGap: 1 });
      best = layout;
      chosenCap = capW;
      if (layout.stageW <= innerW) break;
    }
    chosen = best!;
  }
  cam.zoom = chosen.spec.zoom;
  cam.nodeWCap = chosenCap;
  cam.overflow = !fits(chosen);
  cam.tx = Math.floor((innerW - chosen.stageW) / 2);
  cam.ty = chosen.stageH <= innerH ? Math.floor((innerH - chosen.stageH) / 2) : 0;
  clampGraphCamera(chosen.stageW, chosen.stageH, vpRect, cam);
  return chosen;
}

const BIT_N = 1;
const BIT_S = 2;
const BIT_E = 4;
const BIT_W = 8;

const MASK_TO_GLYPH: Record<number, string> = {
  [BIT_N]: "│",
  [BIT_S]: "│",
  [BIT_N | BIT_S]: "│",
  [BIT_E]: "─",
  [BIT_W]: "─",
  [BIT_E | BIT_W]: "─",
  [BIT_S | BIT_E]: "╭",
  [BIT_S | BIT_W]: "╮",
  [BIT_N | BIT_E]: "╰",
  [BIT_N | BIT_W]: "╯",
  [BIT_N | BIT_E | BIT_W]: "┴",
  [BIT_S | BIT_E | BIT_W]: "┬",
  [BIT_N | BIT_S | BIT_E]: "├",
  [BIT_N | BIT_S | BIT_W]: "┤",
  [BIT_N | BIT_S | BIT_E | BIT_W]: "┼",
};

interface EdgeCell {
  mask: number;
  arrow: boolean;
  priority: number;
  style: CellStyle;
}

interface RouteCell {
  /** World-space column; routes are computed once per layout so their shape holds under pan/zoom. */
  x: number;
  /** World-space row. */
  y: number;
  mask: number;
  arrow: boolean;
}

interface RoutePoint {
  x: number;
  y: number;
}

const EMPTY_ROUTE_CELLS: RouteCell[] = [];

/**
 * Rasterizes an axis-aligned world-space polyline into edge cells. Consecutive duplicate
 * points collapse first, so zero-length segments are impossible by construction and every
 * loop terminates. The start cell joins upward into the parent node unless the route
 * immediately jogs aside (dodges), which turns it into a corner glyph.
 */
function rasterizeRoute(points: RoutePoint[], cornerAtStart: boolean): RouteCell[] {
  const pts: RoutePoint[] = [];
  for (const point of points) {
    const prev = pts[pts.length - 1];
    if (!prev || prev.x !== point.x || prev.y !== point.y) pts.push(point);
  }
  const cells: RouteCell[] = [];
  if (pts.length === 1) {
    const only = pts[0]!;
    cells.push({ x: only.x, y: only.y, mask: BIT_N, arrow: true });
    return cells;
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const from = pts[i]!;
    const to = pts[i + 1]!;
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    const outDir = dx > 0 ? BIT_E : dx < 0 ? BIT_W : dy > 0 ? BIT_S : BIT_N;
    const backDir = dy > 0 ? BIT_N : dy < 0 ? BIT_S : dx > 0 ? BIT_W : BIT_E;
    if (i === 0) {
      cells.push({ x: from.x, y: from.y, mask: cornerAtStart ? outDir : BIT_N | outDir, arrow: false });
    } else {
      const prev = pts[i - 1]!;
      const inDx = Math.sign(from.x - prev.x);
      const inDy = Math.sign(from.y - prev.y);
      cells.push({
        x: from.x,
        y: from.y,
        mask: (inDy > 0 ? BIT_N : inDy < 0 ? BIT_S : inDx > 0 ? BIT_W : BIT_E) | outDir,
        arrow: false,
      });
    }
    for (let x = from.x + dx, y = from.y + dy; x !== to.x || y !== to.y; x += dx, y += dy) {
      cells.push({ x, y, mask: dx !== 0 ? BIT_E | BIT_W : BIT_N | BIT_S, arrow: false });
    }
    if (i + 2 === pts.length) {
      cells.push({ x: to.x, y: to.y, mask: backDir, arrow: true });
    }
  }
  return cells;
}

/**
 * Renders the top toolbar and full-height pannable waterfall DAG viewport.
 */
export function renderWaterfallGraphView(
  buf: ScreenBuffer,
  rect: Rect,
  state: TuiState,
  filtered: FilteredData
): WaterfallLayout | null {
  const vpRect = getGraphViewportRect(rect);

  if (filtered.filteredFeatures.length === 0) {
    buf.drawBox(vpRect.x, vpRect.y, vpRect.w, vpRect.h, {
      borderStyle: { fg: TUI_PALETTE.border },
      fillStyle: { bg: TUI_PALETTE.bg },
    });
    const inner: Rect = { x: vpRect.x + 1, y: vpRect.y, w: vpRect.w - 2, h: vpRect.h };
    if (state.payload.features.length === 0) {
      buf.writeText(inner.x + 1, inner.y + 1, "No features yet.", inner.w - 2, { fg: TUI_PALETTE.text, bold: true });
    } else {
      renderFilteredEmpty(buf, inner, state, "features");
    }
    return null;
  }

  let layout = layoutForCamera(filtered.filteredFeatures, state.payload.milestones, state.graphCamera);

  // Fit on entry and whenever the visible set (filters) changes.
  if (!state.graphCamera.initialized || state.graphCamera.layoutKey !== layout.layoutKey) {
    state.graphCamera.initialized = true;
    state.graphCamera.layoutKey = layout.layoutKey;
    layout = fitGraphCamera(filtered.filteredFeatures, state.payload.milestones, vpRect, state.graphCamera);
  } else {
    clampGraphCamera(layout.stageW, layout.stageH, vpRect, state.graphCamera);
  }

  // Graph toolbar bar — reserve exact width for right buttons first so they never clip beside split drawer
  const hoverLabel = state.graphHoverEnabled ? "Hover:ON" : "Hover:OFF";
  const rightBtns: Array<{ label: string; style: CellStyle; id: string; kind: string }> = [
    {
      label: hoverLabel,
      style: state.graphHoverEnabled
        ? { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true }
        : { fg: TUI_PALETTE.muted, bg: TUI_PALETTE.surface2 },
      id: "graph-hover-toggle",
      kind: "graph-hover-toggle",
    },
    { label: "−", style: { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 }, id: "graph-zoom-out", kind: "graph-zoom-out" },
    {
      label: layout.spec.label,
      style: { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2, bold: true },
      id: "graph-zoom-reset",
      kind: "graph-zoom-reset",
    },
    { label: "+", style: { fg: TUI_PALETTE.text, bg: TUI_PALETTE.surface2 }, id: "graph-zoom-in", kind: "graph-zoom-in" },
    {
      label: "Fit",
      style: { fg: TUI_PALETTE.accent, bg: TUI_PALETTE.accentSoft, bold: true },
      id: "graph-zoom-fit",
      kind: "graph-zoom-fit",
    },
  ];
  const rightTotal =
    rightBtns.reduce((s, b) => s + Array.from(b.label).length + 2, 0) + (rightBtns.length - 1);

  const barY = rect.y;
  buf.fillRect(rect.x, barY, rect.w, 1, { bg: TUI_PALETTE.bg });
  let bx = rect.x + 1;
  const legendLimit = rect.x + rect.w - rightTotal - 2;
  const items: Array<{ label: string; style: CellStyle }> = [
    { label: "■ Selected ", style: { fg: TUI_PALETTE.accent, bold: true } },
    { label: "■ Upstream ", style: { fg: TUI_PALETTE.amber, bold: true } },
    { label: "■ Downstream", style: { fg: TUI_PALETTE.green, bold: true } },
  ];
  for (const item of items) {
    if (bx + item.label.length > legendLimit) break;
    buf.writeText(bx, barY, item.label, item.label.length, item.style);
    bx += item.label.length + 1;
  }

  let rx = Math.max(rect.x + 1, rect.x + rect.w - rightTotal - 1);
  for (const btn of rightBtns) {
    const used = drawPill(buf, rx, barY, btn.label, btn.style, {
      id: btn.id,
      kind: btn.kind,
      zIndex: 12,
    });
    rx += used + 1;
  }

  // Viewport frame + dot-grid background
  buf.drawBox(vpRect.x, vpRect.y, vpRect.w, vpRect.h, {
    borderStyle: { fg: TUI_PALETTE.border },
    fillStyle: { bg: TUI_PALETTE.bg },
  });
  const innerRect: Rect = {
    x: vpRect.x + 1,
    y: vpRect.y + 1,
    w: Math.max(1, vpRect.w - 2),
    h: Math.max(1, vpRect.h - 2),
  };
  buf.addHitRegion({
    id: "graph-viewport",
    kind: "graph-viewport",
    x: innerRect.x,
    y: innerRect.y,
    w: innerRect.w,
    h: innerRect.h,
    zIndex: 5,
  });

  for (let sy = innerRect.y; sy < innerRect.y + innerRect.h; sy++) {
    for (let sx = innerRect.x; sx < innerRect.x + innerRect.w; sx++) {
      const worldX = sx - innerRect.x - state.graphCamera.tx;
      const worldY = sy - innerRect.y - state.graphCamera.ty;
      if (((worldX % 6) + 6) % 6 === 0 && ((worldY % 3) + 3) % 3 === 0) {
        buf.put(sx, sy, "·", { fg: TUI_PALETTE.border, bg: TUI_PALETTE.bg, dim: true });
      }
    }
  }

  const focusId = state.graphHoverEnabled
    ? state.graphHoverId ?? state.graphSelectedId
    : state.graphSelectedId;
  const focusAnc = focusId ? layout.ancestors.get(focusId) ?? new Set<string>() : null;
  const focusDesc = focusId ? layout.descendants.get(focusId) ?? new Set<string>() : null;

  const edgeGrid = new Map<string, EdgeCell>();
  const addMask = (sx: number, sy: number, bits: number, priority: number, style: CellStyle, arrow = false) => {
    if (
      sx < innerRect.x ||
      sx >= innerRect.x + innerRect.w ||
      sy < innerRect.y ||
      sy >= innerRect.y + innerRect.h
    ) {
      return;
    }
    const key = `${sx},${sy}`;
    const existing = edgeGrid.get(key);
    if (!existing) {
      edgeGrid.set(key, { mask: bits, arrow, priority, style });
      return;
    }
    if (priority > existing.priority) {
      edgeGrid.set(key, {
        mask: existing.mask | bits,
        arrow: existing.arrow || arrow,
        priority,
        style,
      });
    } else if (priority === existing.priority) {
      existing.mask |= bits;
      existing.arrow = existing.arrow || arrow;
    } else {
      existing.mask |= bits;
    }
  };

  const toScreenX = (wx: number) => innerRect.x + state.graphCamera.tx + wx;
  const toScreenY = (wy: number) => innerRect.y + state.graphCamera.ty + wy;

  const routes = layout.routes;
  for (let edgeIdx = 0; edgeIdx < layout.edges.length; edgeIdx++) {
    const edge = layout.edges[edgeIdx]!;

    let priority = 1;
    let edgeStyle: CellStyle = { fg: TUI_PALETTE.border };
    if (focusId && focusAnc && focusDesc) {
      const isUp = (edge.to === focusId || focusAnc.has(edge.to)) && focusAnc.has(edge.from);
      const isDown = (edge.from === focusId || focusDesc.has(edge.from)) && focusDesc.has(edge.to);
      if (isUp) {
        priority = 3;
        edgeStyle = { fg: TUI_PALETTE.amber, bold: true };
      } else if (isDown) {
        priority = 3;
        edgeStyle = { fg: TUI_PALETTE.green, bold: true };
      } else {
        priority = 0;
        edgeStyle = { fg: TUI_PALETTE.border, dim: true };
      }
    }

    for (const cell of routes[edgeIdx] ?? EMPTY_ROUTE_CELLS) {
      addMask(toScreenX(cell.x), toScreenY(cell.y), cell.mask, priority, edgeStyle, cell.arrow);
    }
  }

  for (const [key, cell] of edgeGrid) {
    const [sxStr, syStr] = key.split(",");
    const sx = Number(sxStr);
    const sy = Number(syStr);
    const glyph = cell.arrow ? "▼" : MASK_TO_GLYPH[cell.mask] ?? "·";
    buf.put(sx, sy, glyph, { ...cell.style, bg: TUI_PALETTE.bg });
  }

  // Draw clipped nodes + hit regions
  for (const node of layout.orderedNodes) {
    const f = node.feature;
    const sx = toScreenX(node.x);
    const sy = toScreenY(node.y);
    if (
      sx + node.w <= innerRect.x ||
      sx >= innerRect.x + innerRect.w ||
      sy + node.h <= innerRect.y ||
      sy >= innerRect.y + innerRect.h
    ) {
      continue;
    }

    const isSelected = focusId === f.id;
    const isUp = Boolean(focusAnc?.has(f.id));
    const isDown = Boolean(focusDesc?.has(f.id));
    const isDimmed = Boolean(focusId && !isSelected && !isUp && !isDown);

    const st = getStatusStyle(f.status);
    const borderFg = isSelected
      ? TUI_PALETTE.accent
      : isUp
      ? TUI_PALETTE.amber
      : isDown
      ? TUI_PALETTE.green
      : TUI_PALETTE.border;
    const fillBg = isSelected
      ? TUI_PALETTE.accentSoft
      : isUp
      ? TUI_PALETTE.amberSoft
      : isDown
      ? TUI_PALETTE.greenSoft
      : TUI_PALETTE.surface;
    const borderStyle: CellStyle = { fg: borderFg, bold: isSelected || isUp || isDown, dim: isDimmed };
    const fillStyle: CellStyle = { bg: fillBg };

    const clipWrite = (wx: number, wy: number, text: string, maxW: number, style?: CellStyle) => {
      if (wy < innerRect.y || wy >= innerRect.y + innerRect.h) return;
      const glyphs = Array.from(truncateText(text, maxW));
      for (let i = 0; i < glyphs.length; i++) {
        const cx = wx + i;
        if (cx >= innerRect.x && cx < innerRect.x + innerRect.w) {
          buf.put(cx, wy, glyphs[i]!, style);
        }
      }
    };

    const clipFill = (fx: number, fy: number, fw: number, fh: number, style: CellStyle) => {
      const x0 = Math.max(innerRect.x, fx);
      const y0 = Math.max(innerRect.y, fy);
      const x1 = Math.min(innerRect.x + innerRect.w, fx + fw);
      const y1 = Math.min(innerRect.y + innerRect.h, fy + fh);
      if (x1 > x0 && y1 > y0) {
        buf.fillRect(x0, y0, x1 - x0, y1 - y0, style);
      }
    };

    if (node.h === 1) {
      clipFill(sx, sy, node.w, 1, fillStyle);
      const pillLabel = `${st.icon} ${f.title}`;
      clipWrite(sx + 1, sy, pillLabel, node.w - 2, {
        fg: isSelected || isUp || isDown ? TUI_PALETTE.white : st.fg,
        bg: fillBg,
        bold: isSelected || isUp || isDown,
        dim: isDimmed,
      });
    } else {
      clipFill(sx, sy, node.w, node.h, fillStyle);
      for (let row = sy; row < sy + node.h; row++) {
        if (row < innerRect.y || row >= innerRect.y + innerRect.h) continue;
        for (let col = sx; col < sx + node.w; col++) {
          if (col < innerRect.x || col >= innerRect.x + innerRect.w) continue;
          if (row === sy) {
            const ch = col === sx ? "╭" : col === sx + node.w - 1 ? "╮" : "─";
            buf.put(col, row, ch, borderStyle);
          } else if (row === sy + node.h - 1) {
            const ch = col === sx ? "╰" : col === sx + node.w - 1 ? "╯" : "─";
            buf.put(col, row, ch, borderStyle);
          } else if (col === sx || col === sx + node.w - 1) {
            buf.put(col, row, "│", borderStyle);
          }
        }
      }

      if (node.h === 3) {
        clipWrite(sx + 2, sy + 1, st.icon, 1, { fg: st.fg, bg: fillBg, bold: true, dim: isDimmed });
        clipWrite(sx + 4, sy + 1, f.title, node.w - 6, {
          fg: TUI_PALETTE.text,
          bg: fillBg,
          bold: !isDimmed,
          dim: isDimmed,
        });
      } else {
        clipWrite(sx + 2, sy + 1, f.title, node.w - 6, {
          fg: TUI_PALETTE.text,
          bg: fillBg,
          bold: !isDimmed,
          dim: isDimmed,
        });
        clipWrite(sx + node.w - 3, sy + 1, st.icon, 1, { fg: st.fg, bg: fillBg, bold: true });
        const done = f.ship_criteria.filter((c) => c.done).length;
        const total = f.ship_criteria.length;
        const leftMeta = f.milestone + (f.area ? ` · ${f.area}` : "");
        const rightMeta = `${done}/${total}`;
        clipWrite(sx + 2, sy + 2, leftMeta, Math.max(4, node.w - 5 - rightMeta.length), {
          fg: TUI_PALETTE.muted,
          bg: fillBg,
          dim: isDimmed,
        });
        clipWrite(sx + node.w - 2 - rightMeta.length, sy + 2, rightMeta, rightMeta.length, {
          fg: TUI_PALETTE.slate,
          bg: fillBg,
          dim: isDimmed,
        });
      }
    }

    const hx0 = Math.max(innerRect.x, sx);
    const hy0 = Math.max(innerRect.y, sy);
    const hx1 = Math.min(innerRect.x + innerRect.w, sx + node.w);
    const hy1 = Math.min(innerRect.y + innerRect.h, sy + node.h);
    if (hx1 > hx0 && hy1 > hy0) {
      buf.addHitRegion({
        id: `graph-node-${f.id}`,
        kind: "graph-node",
        x: hx0,
        y: hy0,
        w: hx1 - hx0,
        h: hy1 - hy0,
        zIndex: 10,
        data: f.id,
      });
    }
  }

  // Overflow cue: some node lies outside the viewport (no density fits, or the user zoomed in).
  let hidden = 0;
  for (const node of layout.orderedNodes) {
    const nx = toScreenX(node.x);
    const ny = toScreenY(node.y);
    if (nx < innerRect.x || ny < innerRect.y || nx + node.w > innerRect.x + innerRect.w || ny + node.h > innerRect.y + innerRect.h) {
      hidden += 1;
    }
  }
  if (hidden > 0) {
    const cue = ` ▸ ${hidden} of ${layout.orderedNodes.length} off-screen · j/k reveal · drag/arrows pan `;
    const cueW = Math.min(textCellWidth(cue), innerRect.w);
    buf.writeText(innerRect.x + innerRect.w - cueW, innerRect.y + innerRect.h - 1, cue, cueW, {
      fg: TUI_PALETTE.amber,
      bg: TUI_PALETTE.surface2,
      bold: true,
    });
    buf.addHitRegion({ id: "graph-overflow", kind: "graph-overflow", x: innerRect.x + innerRect.w - cueW, y: innerRect.y + innerRect.h - 1, w: cueW, h: 1, zIndex: 11 });
  }

  return layout;
}
