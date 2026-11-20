import type { Feature, Milestone } from "../types";
import { ScreenBuffer, TUI_PALETTE, truncateText, type CellStyle } from "./screen";
import {
  drawPill,
  getStatusStyle,
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
  layoutKey: string;
}

const ZOOM_ORDER: GraphZoomLevel[] = ["overview", "compact", "full"];

export function stepGraphZoom(current: GraphZoomLevel, delta: number): GraphZoomLevel {
  const idx = ZOOM_ORDER.indexOf(current);
  const next = Math.max(0, Math.min(ZOOM_ORDER.length - 1, idx + delta));
  return ZOOM_ORDER[next] ?? current;
}

/**
 * Computes a cycle-safe, top-to-bottom parent-barycenter waterfall layout at the chosen density.
 */
export function computeWaterfallLayout(
  features: Feature[],
  milestones: Milestone[],
  zoom: GraphZoomLevel
): WaterfallLayout {
  const spec = WATERFALL_SPECS[zoom];
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

  for (const f of features) {
    computeLayer(f.id, new Set());
  }

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

  let maxRowW = 0;
  for (let layer = 0; layer <= maxLayer; layer++) {
    const list = rows.get(layer) ?? [];
    const rowW = list.length * spec.nodeW + Math.max(0, list.length - 1) * spec.colGap;
    maxRowW = Math.max(maxRowW, rowW);
  }

  const stageW = Math.max(spec.nodeW + spec.padX * 2, spec.padX * 2 + maxRowW);
  const stageH = Math.max(
    spec.nodeH + spec.padY * 2,
    spec.padY * 2 + (maxLayer + 1) * spec.nodeH + maxLayer * spec.rowGap
  );

  const nodes = new Map<string, PlacedGraphNode>();
  const orderedNodes: PlacedGraphNode[] = [];
  for (let layer = 0; layer <= maxLayer; layer++) {
    const list = rows.get(layer) ?? [];
    const rowW = list.length * spec.nodeW + Math.max(0, list.length - 1) * spec.colGap;
    const startX = Math.floor((stageW - rowW) / 2);
    list.forEach((f, idx) => {
      const placed: PlacedGraphNode = {
        feature: f,
        x: startX + idx * (spec.nodeW + spec.colGap),
        y: spec.padY + layer * (spec.nodeH + spec.rowGap),
        w: spec.nodeW,
        h: spec.nodeH,
        layer,
      };
      nodes.set(f.id, placed);
      orderedNodes.push(placed);
    });
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
  const layout = computeWaterfallLayout(features, milestones, "full");
  const innerW = Math.max(1, vpRect.w - 2);
  const innerH = Math.max(1, vpRect.h - 2);
  cam.tx = Math.floor((innerW - layout.stageW) / 2);
  cam.ty = layout.stageH <= innerH ? Math.floor((innerH - layout.stageH) / 2) : 0;
  clampGraphCamera(layout.stageW, layout.stageH, vpRect, cam);
  return layout;
}

export function fitGraphCamera(
  features: Feature[],
  milestones: Milestone[],
  vpRect: Rect,
  cam: GraphCameraState
): WaterfallLayout {
  const innerW = Math.max(1, vpRect.w - 2);
  const innerH = Math.max(1, vpRect.h - 2);
  const candidateOrder: GraphZoomLevel[] = ["full", "compact", "overview"];
  let chosen = computeWaterfallLayout(features, milestones, "overview");
  for (const zoom of candidateOrder) {
    const layout = computeWaterfallLayout(features, milestones, zoom);
    if (layout.stageW <= innerW && layout.stageH <= innerH) {
      chosen = layout;
      break;
    }
  }
  cam.zoom = chosen.spec.zoom;
  cam.tx = Math.floor((innerW - chosen.stageW) / 2);
  cam.ty = Math.floor((innerH - chosen.stageH) / 2);
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
    buf.writeText(vpRect.x + 2, vpRect.y + 1, "No features match the active filter.", vpRect.w - 4, {
      fg: TUI_PALETTE.muted,
    });
    return null;
  }

  let layout = computeWaterfallLayout(
    filtered.filteredFeatures,
    state.payload.milestones,
    state.graphCamera.zoom
  );

  if (!state.graphCamera.initialized || state.graphCamera.layoutKey !== layout.layoutKey) {
    state.graphCamera.initialized = true;
    state.graphCamera.layoutKey = layout.layoutKey;
    layout = resetGraphCamera(filtered.filteredFeatures, state.payload.milestones, vpRect, state.graphCamera);
  } else {
    clampGraphCamera(layout.stageW, layout.stageH, vpRect, state.graphCamera);
  }

  // Graph toolbar bar
  const barY = rect.y;
  buf.fillRect(rect.x, barY, rect.w, 1, { bg: TUI_PALETTE.bg });
  let bx = rect.x + 1;
  const controlsW = 34;
  if (rect.w > controlsW + 26) {
    const items: Array<{ label: string; style: CellStyle }> = [
      { label: "■ Selected ", style: { fg: TUI_PALETTE.accent, bold: true } },
      { label: "■ Upstream ", style: { fg: TUI_PALETTE.amber, bold: true } },
      { label: "■ Downstream", style: { fg: TUI_PALETTE.green, bold: true } },
    ];
    for (const item of items) {
      if (bx + item.label.length >= rect.x + rect.w - controlsW) break;
      buf.writeText(bx, barY, item.label, item.label.length, item.style);
      bx += item.label.length + 1;
    }
  }

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
  let rx = Math.max(bx + 1, rect.x + rect.w - rightTotal - 1);
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

  for (const edge of layout.edges) {
    const p1 = layout.nodes.get(edge.from);
    const p2 = layout.nodes.get(edge.to);
    if (!p1 || !p2) continue;

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

    const x1 = toScreenX(p1.x + Math.floor(p1.w / 2));
    const y1 = toScreenY(p1.y + p1.h);
    const x2 = toScreenX(p2.x + Math.floor(p2.w / 2));
    const y2 = toScreenY(p2.y - 1);

    if (y2 < y1) continue;
    if (x1 === x2) {
      for (let sy = y1; sy < y2; sy++) {
        addMask(x1, sy, BIT_N | BIT_S, priority, edgeStyle);
      }
      addMask(x2, y2, BIT_N, priority, edgeStyle, true);
    } else {
      const midY = layout.spec.rowGap >= 2 ? y2 - 1 : y2;
      for (let sy = y1; sy < midY; sy++) {
        addMask(x1, sy, BIT_N | BIT_S, priority, edgeStyle);
      }
      const goRight = x2 > x1;
      if (midY === y2) {
        addMask(x1, midY, BIT_N | (goRight ? BIT_E : BIT_W), priority, edgeStyle);
        const step = goRight ? 1 : -1;
        for (let sx = x1 + step; sx !== x2; sx += step) {
          addMask(sx, midY, BIT_E | BIT_W, priority, edgeStyle);
        }
        addMask(x2, y2, goRight ? BIT_W : BIT_E, priority, edgeStyle, true);
      } else {
        addMask(x1, midY, BIT_N | (goRight ? BIT_E : BIT_W), priority, edgeStyle);
        const step = goRight ? 1 : -1;
        for (let sx = x1 + step; sx !== x2; sx += step) {
          addMask(sx, midY, BIT_E | BIT_W, priority, edgeStyle);
        }
        addMask(x2, midY, BIT_S | (goRight ? BIT_W : BIT_E), priority, edgeStyle);
        for (let sy = midY + 1; sy < y2; sy++) {
          addMask(x2, sy, BIT_N | BIT_S, priority, edgeStyle);
        }
        addMask(x2, y2, BIT_N, priority, edgeStyle, true);
      }
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
      const pillLabel = `${st.icon} ${f.id}`;
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

  return layout;
}
