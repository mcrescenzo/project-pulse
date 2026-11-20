import type {
  BeadStatusInfo,
  Feature,
  Milestone,
  PulseConfig,
  ValidationIssue,
} from "./types";

export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><path d="M5 17h5l3-8 5 14 3-6h6" fill="none" stroke="#60a5fa" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

export interface RoadmapViewPayload {
  config: PulseConfig;
  milestones: Milestone[];
  features: Feature[];
  check: {
    ok: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  };
  beads: Record<string, BeadStatusInfo[]>;
}

export interface DashboardHtmlOptions {
  mode: "live" | "static";
  apiBasePath?: string;
  projectSwitcher?: {
    currentSlug: string;
    portfolioUrl: string;
  };
  embeddedData?: RoadmapViewPayload;
}

/**
 * Serializes JSON cleanly for safe embedding inside an HTML `<script>` element.
 */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const SHARED_THEME_CSS = `
    :root {
      color-scheme: dark;
      --bg: #0b0f17;
      --surface: #121826;
      --surface-2: #192234;
      --border: #263147;
      --text: #e6edf7;
      --muted: #93a4bd;
      --accent: #60a5fa;
      --accent-soft: rgba(96, 165, 250, 0.14);
      --green: #34d399;
      --green-soft: rgba(52, 211, 153, 0.14);
      --amber: #fbbf24;
      --amber-soft: rgba(251, 191, 36, 0.14);
      --red: #f87171;
      --red-soft: rgba(248, 113, 113, 0.14);
      --slate: #94a3b8;
      --slate-soft: rgba(148, 163, 184, 0.15);
      --shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
      --radius: 12px;
    }
    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        color-scheme: light;
        --bg: #f6f8fc;
        --surface: #ffffff;
        --surface-2: #f1f5f9;
        --border: #dbe3ef;
        --text: #0f172a;
        --muted: #475569;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.1);
        --green: #059669;
        --green-soft: rgba(5, 150, 105, 0.12);
        --amber: #d97706;
        --amber-soft: rgba(217, 119, 6, 0.12);
        --red: #dc2626;
        --red-soft: rgba(220, 38, 38, 0.12);
        --slate: #64748b;
        --slate-soft: rgba(100, 116, 139, 0.12);
        --shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
      }
    }
    :root[data-theme="light"] {
      color-scheme: light;
      --bg: #f6f8fc;
      --surface: #ffffff;
      --surface-2: #f1f5f9;
      --border: #dbe3ef;
      --text: #0f172a;
      --muted: #475569;
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.1);
      --green: #059669;
      --green-soft: rgba(5, 150, 105, 0.12);
      --amber: #d97706;
      --amber-soft: rgba(217, 119, 6, 0.12);
      --red: #dc2626;
      --red-soft: rgba(220, 38, 38, 0.12);
      --slate: #64748b;
      --slate-soft: rgba(100, 116, 139, 0.12);
      --shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
    }
`;

const EARLY_THEME_SCRIPT = `
  <script>
    (function () {
      try {
        var saved = localStorage.getItem("pp-theme");
        if (saved === "light" || saved === "dark") {
          document.documentElement.dataset.theme = saved;
        }
      } catch (e) {}
    })();
  </script>
`;

/**
 * Builds the dashboard HTML document supporting live server mode, hub routing, and static offline snapshots.
 */
export function buildDashboardHtml(options: DashboardHtmlOptions = { mode: "live" }): string {
  const mode = options.mode ?? "live";
  const apiBase = (options.apiBasePath ?? "").replace(/\/+$/, "");
  const runtimeConfig = {
    mode,
    apiBase,
    projectSwitcher: options.projectSwitcher ?? null,
  };
  const embeddedDataScript =
    mode === "static"
      ? `<script id="pp-embedded-data" type="application/json">${escapeJsonForScript(
          options.embeddedData ?? {}
        )}</script>`
      : "";

  const switcherHtml = options.projectSwitcher
    ? `<div class="hub-nav">
        <a class="hub-home-link" href="${options.projectSwitcher.portfolioUrl.replace(/"/g, "&quot;")}">All Projects</a>
        <select id="project-switcher" class="hub-select" aria-label="Switch project"></select>
      </div>`
    : "";

  const liveBadgeInitial =
    mode === "static"
      ? `<span class="pill pill-snapshot" id="live-badge">Offline Snapshot</span>`
      : `<span class="pill pill-live" id="live-badge"><span class="dot"></span> Live</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Pulse — Roadmap</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URL}" />
  ${EARLY_THEME_SCRIPT}
  <style>
    ${SHARED_THEME_CSS}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    button:focus-visible,
    select:focus-visible,
    input:focus-visible,
    a:focus-visible,
    .card:focus-visible,
    .board-card:focus-visible,
    .graph-node:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .container { max-width: 1220px; margin: 0 auto; padding: 28px 24px 72px; }
    header {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 18px;
    }
    .hub-nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .hub-home-link {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      border: 1px solid rgba(96, 165, 250, 0.25);
    }
    .hub-home-link:hover { filter: brightness(1.1); }
    .hub-select {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 0.82rem;
      font-family: inherit;
    }
    h1 { margin: 0; font-size: 1.85rem; letter-spacing: -0.02em; }
    .subtitle { margin: 6px 0 0; color: var(--muted); max-width: 72ch; }
    .header-badges { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      border: 1px solid transparent;
      font-family: inherit;
    }
    .pill-btn {
      cursor: pointer;
      transition: filter 0.12s ease, transform 0.12s ease;
    }
    .pill-btn:hover { filter: brightness(1.08); }
    .pill-live { background: var(--green-soft); color: var(--green); border-color: rgba(52, 211, 153, 0.3); }
    .pill-live .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--green); }
    .pill-snapshot { background: var(--accent-soft); color: var(--accent); border-color: rgba(96, 165, 250, 0.3); }
    .pill-warn { background: var(--amber-soft); color: var(--amber); border-color: rgba(251, 191, 36, 0.35); }
    .pill-err { background: var(--red-soft); color: var(--red); border-color: rgba(248, 113, 113, 0.35); }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      cursor: pointer;
      font-family: inherit;
    }
    .icon-btn:hover { border-color: var(--accent); }
    .health-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 18px;
      margin-bottom: 18px;
      box-shadow: var(--shadow);
    }
    .health-panel[hidden] { display: none; }
    .health-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .health-head h3 { margin: 0; font-size: 0.96rem; }
    .health-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .health-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 0.85rem;
    }
    .health-item-main { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    @media (max-width: 960px) {
      .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .container { padding: 20px 14px 56px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
      min-width: 0;
    }
    .stat-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .stat-value { font-size: 1.4rem; font-weight: 700; margin-top: 2px; display: flex; align-items: baseline; gap: 6px; }
    .stat-sub { font-size: 0.76rem; font-weight: 500; color: var(--muted); }
    .controls-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .view-tabs {
      display: inline-flex;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 4px;
      gap: 4px;
    }
    .view-tab {
      background: transparent;
      color: var(--muted);
      border: none;
      border-radius: 7px;
      padding: 6px 12px;
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .view-tab:hover { color: var(--text); }
    .view-tab.is-active {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .filters {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 12px;
      min-width: 280px;
    }
    .filters select, .filters input[type="search"] {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 0.86rem;
      font-family: inherit;
    }
    .filters input[type="search"] { min-width: 170px; flex: 1; }
    .toggle-label { display: inline-flex; align-items: center; gap: 6px; font-size: 0.84rem; color: var(--muted); cursor: pointer; }
    .btn-ghost {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-ghost:hover { border-color: var(--accent); background: var(--accent-soft); }
    .milestone {
      margin-bottom: 30px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
    }
    .milestone-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .milestone-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .milestone-title h2 { margin: 0; font-size: 1.25rem; }
    .code-tag {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.76rem;
      padding: 2px 7px;
      border-radius: 6px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .milestone-desc { margin: 6px 0 14px; color: var(--muted); font-size: 0.92rem; }
    .progress-track {
      width: 100%;
      height: 7px;
      background: var(--surface-2);
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .progress-fill { height: 100%; background: var(--green); transition: width 0.25s ease; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 15px;
      cursor: pointer;
      transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .card:hover { transform: translateY(-1px); border-color: var(--accent); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .card-title-wrap { min-width: 0; }
    .card-title { font-weight: 650; font-size: 0.99rem; line-height: 1.3; }
    .card-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.74rem;
      color: var(--muted);
      margin-top: 2px;
      word-break: break-word;
    }
    .card-desc {
      margin: 0;
      font-size: 0.84rem;
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.76rem; color: var(--muted); }
    .area-badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 5px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .mini-track {
      flex: 1;
      min-width: 48px;
      max-width: 96px;
      height: 5px;
      background: var(--surface);
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .mini-fill { display: block; height: 100%; background: var(--accent); }
    .mini-fill.is-done { background: var(--green); }
    .ref-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.73rem;
      padding: 2px 7px;
      border-radius: 6px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .ref-closed { color: var(--green); border-color: rgba(52, 211, 153, 0.35); }
    .ref-in_progress, .ref-in-progress { color: var(--accent); border-color: rgba(96, 165, 250, 0.35); }
    .ref-missing { color: var(--red); border-color: rgba(248, 113, 113, 0.4); }
    .card-pulse { font-size: 0.81rem; color: var(--muted); border-left: 2px solid var(--border); padding-left: 8px; }
    .status-planned { background: var(--slate-soft); color: var(--slate); }
    .status-in-progress, .status-active { background: var(--accent-soft); color: var(--accent); }
    .status-shipped { background: var(--green-soft); color: var(--green); }
    .status-paused { background: var(--amber-soft); color: var(--amber); }
    .status-cut, .status-archived { background: var(--red-soft); color: var(--red); }

    /* Dependency Graph View */
    body.view-mode-graph .container {
      max-width: none;
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 14px 20px 16px;
    }
    body.view-mode-graph header { padding-bottom: 10px; margin-bottom: 10px; }
    body.view-mode-graph h1 { font-size: 1.45rem; }
    body.view-mode-graph .subtitle { margin-top: 2px; font-size: 0.88rem; }
    body.view-mode-graph .stats { gap: 8px; margin-bottom: 10px; }
    body.view-mode-graph .stat-card {
      padding: 7px 12px;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    body.view-mode-graph .stat-value { font-size: 1.15rem; margin-top: 0; }
    body.view-mode-graph .controls-row { margin-bottom: 10px; gap: 8px; }
    body.view-mode-graph .filters { padding: 7px 10px; }
    body.view-mode-graph main#milestones {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: max(420px, 55vh);
    }
    body.view-mode-graph .graph-shell {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding: 12px 14px 14px;
    }
    .graph-shell {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
    }
    .graph-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    .graph-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 0;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .legend-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .graph-controls {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 3px;
    }
    .graph-ctrl-btn {
      min-width: 28px;
      height: 26px;
      padding: 0 8px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .graph-ctrl-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .graph-zoom-readout { min-width: 50px; font-variant-numeric: tabular-nums; }
    .graph-viewport {
      flex: 1 1 auto;
      min-height: 360px;
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 10px;
      background-color: var(--bg);
      background-image: radial-gradient(color-mix(in srgb, var(--border) 65%, transparent) 1px, transparent 1px);
      background-size: 24px 24px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .graph-viewport.is-dragging { cursor: grabbing; }
    .graph-viewport.is-dragging .graph-node { cursor: grabbing; }
    .graph-canvas {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      will-change: transform;
    }
    .graph-stage { position: relative; min-height: 240px; }
    .graph-edges {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .graph-edge {
      fill: none;
      stroke: var(--border);
      stroke-width: 1.8;
      marker-end: url(#pp-arrow);
      transition: stroke 0.14s ease, opacity 0.14s ease, stroke-width 0.14s ease;
    }
    .graph-edge.is-upstream { stroke: var(--amber); stroke-width: 2.6; opacity: 1; marker-end: url(#pp-arrow-up); }
    .graph-edge.is-downstream { stroke: var(--green); stroke-width: 2.6; opacity: 1; marker-end: url(#pp-arrow-down); }
    .graph-edge.is-dimmed { opacity: 0.18; }
    .graph-node {
      position: absolute;
      text-align: left;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      cursor: pointer;
      font-family: inherit;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 6px;
      transition: border-color 0.14s ease, box-shadow 0.14s ease, opacity 0.14s ease, transform 0.14s ease;
    }
    .graph-node:hover { border-color: var(--accent); }
    .graph-node.is-active {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-soft);
      transform: translateY(-1px);
    }
    .graph-node.is-upstream {
      border-color: var(--amber);
      box-shadow: 0 0 0 2px var(--amber-soft);
    }
    .graph-node.is-downstream {
      border-color: var(--green);
      box-shadow: 0 0 0 2px var(--green-soft);
    }
    .graph-node.is-dimmed { opacity: 0.28; }
    .graph-node-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
    .graph-node-title {
      font-weight: 650;
      font-size: 0.85rem;
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .graph-node-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 0.72rem;
      color: var(--muted);
    }

    /* Status Board View */
    .board-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .board-col {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 180px;
    }
    .board-col-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .board-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 7px;
      transition: border-color 0.12s ease, transform 0.12s ease;
    }
    .board-card:hover { border-color: var(--accent); transform: translateY(-1px); }

    /* Drawer */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: none;
      justify-content: flex-end;
      z-index: 50;
    }
    .drawer-backdrop.open { display: flex; }
    .drawer {
      width: min(560px, 100vw);
      height: 100%;
      background: var(--surface);
      border-left: 1px solid var(--border);
      padding: 24px;
      overflow-y: auto;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .close-btn {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-weight: 600;
      font-family: inherit;
    }
    .close-btn:hover { border-color: var(--accent); }
    .drawer-feedback {
      min-height: 20px;
      font-size: 0.82rem;
      border-radius: 8px;
      padding: 0;
    }
    .drawer-feedback.is-visible { padding: 7px 10px; border: 1px solid var(--border); }
    .drawer-feedback.is-saving { background: var(--accent-soft); color: var(--accent); border-color: rgba(96, 165, 250, 0.35); }
    .drawer-feedback.is-ok { background: var(--green-soft); color: var(--green); border-color: rgba(52, 211, 153, 0.35); }
    .drawer-feedback.is-err { background: var(--red-soft); color: var(--red); border-color: rgba(248, 113, 113, 0.35); }
    .section-label { display: block; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 6px; font-weight: 700; }
    .criteria-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .criteria-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: var(--surface-2);
      padding: 9px 11px;
      border-radius: 8px;
      border: 1px solid var(--border);
      cursor: pointer;
    }
    .criteria-item:hover { border-color: var(--accent); }
    .criteria-item.is-readonly { cursor: default; }
    .criteria-item.is-readonly:hover { border-color: var(--border); }
    .criteria-item input { margin-top: 3px; cursor: pointer; flex-shrink: 0; }
    .criteria-item.is-readonly input { cursor: default; }
    .criteria-body { min-width: 0; flex: 1; }
    .criteria-text { font-size: 0.9rem; }
    .criteria-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.72rem;
      color: var(--muted);
      margin-top: 2px;
      word-break: break-word;
    }
    .note-form { display: flex; gap: 8px; }
    .note-form input {
      flex: 1;
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      font-family: inherit;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-primary:disabled { opacity: 0.65; cursor: progress; }
    .updates-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .update-entry { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 0.86rem; }
    .update-at { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.74rem; color: var(--muted); margin-bottom: 2px; }
    .dep-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.76rem;
      padding: 3px 9px;
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      cursor: pointer;
      border: 1px solid transparent;
      font-family: inherit;
    }
    .dep-chip:hover { border-color: var(--accent); }
    .empty-msg { color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        ${switcherHtml}
        <h1 id="project-name">Loading roadmap…</h1>
        <p class="subtitle" id="project-summary"></p>
      </div>
      <div class="header-badges">
        ${liveBadgeInitial}
        <button type="button" class="pill pill-btn" id="health-badge" aria-expanded="false" aria-controls="health-panel">Checking…</button>
        <button type="button" class="icon-btn" id="theme-toggle" aria-label="Toggle color theme" title="Switch light or dark theme">Theme</button>
      </div>
    </header>

    <section class="health-panel" id="health-panel" hidden aria-label="Roadmap validation and Beads health details"></section>

    <section class="stats" id="stats"></section>

    <div class="controls-row">
      <div class="view-tabs" role="tablist" aria-label="Roadmap view modes">
        <button type="button" class="view-tab is-active" id="tab-cards" role="tab" aria-selected="true" data-view="cards">Milestone Cards</button>
        <button type="button" class="view-tab" id="tab-graph" role="tab" aria-selected="false" data-view="graph">Dependency Graph</button>
        <button type="button" class="view-tab" id="tab-board" role="tab" aria-selected="false" data-view="board">Status Board</button>
      </div>

      <section class="filters" aria-label="Roadmap filters">
        <select id="filter-milestone" aria-label="Filter by milestone"><option value="">All Milestones</option></select>
        <select id="filter-status" aria-label="Filter by status">
          <option value="">All Statuses</option>
          <option value="planned">planned</option>
          <option value="in-progress">in-progress</option>
          <option value="shipped">shipped</option>
          <option value="paused">paused</option>
          <option value="cut">cut</option>
        </select>
        <select id="filter-area" aria-label="Filter by area"><option value="">All Areas</option></select>
        <input type="search" id="filter-search" aria-label="Filter features by text" placeholder="Filter features..." />
        <label class="toggle-label">
          <input type="checkbox" id="toggle-deps" checked />
          Show dependencies
        </label>
        <button type="button" class="btn-ghost" id="filter-reset" hidden>Reset filters</button>
      </section>
    </div>

    <main id="milestones"></main>
  </div>

  <div class="drawer-backdrop" id="drawer-backdrop" aria-hidden="true">
    <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"></aside>
  </div>

  ${embeddedDataScript}
  <script>
    const PP_RUNTIME = ${escapeJsonForScript(runtimeConfig)};
    const state = {
      data: null,
      viewMode: "cards",
      selectedFeatureId: null,
      lastFocusedCardId: null,
      milestoneFilter: "",
      statusFilter: "",
      areaFilter: "",
      search: "",
      showDeps: true,
      healthPanelOpen: false,
      noteDrafts: {},
      feedback: null,
      saving: false,
      graphCamera: { scale: 1, tx: 0, ty: 0, initialized: false, layoutKey: "" },
    };
    let activeGraphApi = null;

    function apiUrl(path) {
      return (PP_RUNTIME.apiBase || "") + path;
    }

    function esc(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTimestamp(iso) {
      if (!iso) return "";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
      } catch {
        return iso;
      }
    }

    function getEffectiveTheme() {
      const explicit = document.documentElement.dataset.theme;
      if (explicit === "light" || explicit === "dark") return explicit;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }

    function syncThemeButton() {
      const btn = document.getElementById("theme-toggle");
      if (!btn) return;
      const eff = getEffectiveTheme();
      btn.textContent = eff === "light" ? "Light theme" : "Dark theme";
      btn.setAttribute("aria-pressed", String(eff === "light"));
    }

    function openDrawer(featureId, opts) {
      const focusDrawer = !opts || opts.focusDrawer !== false;
      state.lastFocusedCardId = state.lastFocusedCardId || featureId;
      state.selectedFeatureId = featureId;
      renderDrawer({ focusClose: focusDrawer });
    }

    function closeDrawer() {
      const returnId = state.lastFocusedCardId || state.selectedFeatureId;
      state.selectedFeatureId = null;
      state.feedback = null;
      renderDrawer();
      if (returnId) {
        const trigger = document.querySelector('[data-feature-id="' + CSS.escape(returnId) + '"]');
        if (trigger && typeof trigger.focus === "function") {
          trigger.focus();
        }
      }
      state.lastFocusedCardId = null;
    }

    async function loadProjectSwitcher() {
      if (!PP_RUNTIME.projectSwitcher) return;
      const select = document.getElementById("project-switcher");
      if (!select) return;
      try {
        const res = await fetch("/api/hub/projects");
        if (!res.ok) return;
        const payload = await res.json();
        const projects = payload.projects || [];
        select.innerHTML = projects.map((p) => {
          const selected = p.slug === PP_RUNTIME.projectSwitcher.currentSlug ? " selected" : "";
          return '<option value="' + esc(p.url) + '"' + selected + ">" + esc(p.name || p.slug) + " (" + esc(p.slug) + ")</option>";
        }).join("");
        select.addEventListener("change", (e) => {
          if (e.target.value) {
            window.location.assign(e.target.value);
          }
        });
      } catch {
        // Ignore transient hub switcher lookup error
      }
    }

    async function fetchRoadmap() {
      if (PP_RUNTIME.mode === "static") {
        const el = document.getElementById("pp-embedded-data");
        state.data = el ? JSON.parse(el.textContent || "{}") : null;
        renderAll();
        return;
      }
      const res = await fetch(apiUrl("/api/roadmap"));
      if (!res.ok) throw new Error("Failed to load /api/roadmap");
      state.data = await res.json();
      renderAll();
    }

    async function sendPulse(featureId, body, onSuccess) {
      if (PP_RUNTIME.mode === "static") return false;
      state.saving = true;
      state.feedback = { kind: "saving", message: "Saving..." };
      renderFeedback();
      try {
        const res = await fetch(apiUrl("/api/features/" + encodeURIComponent(featureId) + "/pulse"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Update failed" }));
          state.saving = false;
          state.feedback = { kind: "err", message: err.error || "Update failed" };
          renderFeedback();
          return false;
        }
        if (typeof onSuccess === "function") onSuccess();
        state.saving = false;
        state.feedback = { kind: "ok", message: "Saved" };
        await fetchRoadmap();
        return true;
      } catch (err) {
        state.saving = false;
        state.feedback = { kind: "err", message: (err && err.message) || "Network error while saving" };
        renderFeedback();
        return false;
      }
    }

    function renderFeedback() {
      const el = document.getElementById("drawer-feedback");
      if (!el) return;
      if (!state.feedback) {
        el.className = "drawer-feedback";
        el.textContent = "";
        return;
      }
      const cls = state.feedback.kind === "err" ? "is-err" : state.feedback.kind === "saving" ? "is-saving" : "is-ok";
      el.className = "drawer-feedback is-visible " + cls;
      el.textContent = state.feedback.message;
    }

    function renderHealthPanel() {
      const panel = document.getElementById("health-panel");
      const badge = document.getElementById("health-badge");
      if (!panel || !badge || !state.data) return;

      badge.setAttribute("aria-expanded", String(state.healthPanelOpen));
      panel.hidden = !state.healthPanelOpen;
      if (!state.healthPanelOpen) {
        panel.innerHTML = "";
        return;
      }

      const check = state.data.check || { ok: true, errors: [], warnings: [] };
      const allIssues = []
        .concat((check.errors || []).map((e) => ({ level: "error", item: e })))
        .concat((check.warnings || []).map((w) => ({ level: "warning", item: w })));
      const featureIds = new Set((state.data.features || []).map((f) => f.id));

      const bodyHtml = allIssues.length === 0
        ? '<p style="margin:0;color:var(--green);font-size:0.9rem">All schema, dependency DAG, ROADMAP.md sync, and Beads checks passed with 0 errors and 0 warnings.</p>'
        : '<ul class="health-list">' + allIssues.map(({ level, item }) => {
            const pillClass = level === "error" ? "pill-err" : "pill-warn";
            const jumpBtn = item.entityId && featureIds.has(item.entityId)
              ? '<button type="button" class="dep-chip" data-health-jump="' + esc(item.entityId) + '">Inspect ' + esc(item.entityId) + "</button>"
              : "";
            return '<li class="health-item"><div class="health-item-main">' +
              '<span class="pill ' + pillClass + '">' + esc(item.code || level.toUpperCase()) + "</span>" +
              "<span>" + esc(item.message) + "</span>" +
            "</div>" + jumpBtn + "</li>";
          }).join("") + "</ul>";

      panel.innerHTML =
        '<div class="health-head">' +
          "<h3>Health & Drift Diagnostics</h3>" +
          '<button type="button" class="close-btn" id="health-panel-close" aria-label="Close health diagnostics">Close</button>' +
        "</div>" +
        bodyHtml;

      document.getElementById("health-panel-close").addEventListener("click", () => {
        state.healthPanelOpen = false;
        renderHealthPanel();
        badge.focus();
      });
      panel.querySelectorAll("[data-health-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-health-jump");
          if (id) {
            state.lastFocusedCardId = id;
            openDrawer(id, { focusDrawer: true });
          }
        });
      });
    }

    function wireFeatureTriggers(container) {
      container.querySelectorAll("[data-feature-id]").forEach((el) => {
        const activate = () => {
          const id = el.getAttribute("data-feature-id");
          if (id) {
            state.lastFocusedCardId = id;
            openDrawer(id, { focusDrawer: true });
          }
        };
        el.addEventListener("click", activate);
        if (el.tagName !== "BUTTON") {
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              activate();
            }
          });
        }
      });
    }

    function renderCardsView(container, data, visibleMilestones) {
      const q = state.search.trim().toLowerCase();
      if (visibleMilestones.length === 0) {
        container.innerHTML = '<p class="empty-msg">No milestones match the active filter.</p>';
        return;
      }

      container.innerHTML = visibleMilestones
        .map((m) => {
          const allMFeatures = data.features.filter((f) => f.milestone === m.id);
          const mFeatures = allMFeatures.filter((f) => {
            if (state.statusFilter && f.status !== state.statusFilter) return false;
            if (state.areaFilter && f.area !== state.areaFilter) return false;
            if (q && !(f.title.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q))) return false;
            return true;
          });
          const mShipped = allMFeatures.filter((f) => f.status === "shipped").length;
          const pct = allMFeatures.length ? Math.round((mShipped / allMFeatures.length) * 100) : 0;

          const cardsHtml = mFeatures.length === 0
            ? '<p class="empty-msg">No features match in this milestone.</p>'
            : '<div class="cards">' +
              mFeatures.map((f) => {
                const done = f.ship_criteria.filter((c) => c.done).length;
                const total = f.ship_criteria.length;
                const criteriaPct = total > 0 ? Math.round((done / total) * 100) : 0;
                const latest = f.updates.length ? f.updates[f.updates.length - 1] : null;
                const beads = (data.beads && data.beads[f.id]) || [];
                const depsHtml = state.showDeps && f.depends_on.length
                  ? '<div class="card-meta"><span>Deps:</span> ' + f.depends_on.map((d) => '<span class="ref-chip">' + esc(d) + "</span>").join(" ") + "</div>"
                  : "";
                const refsHtml = f.refs.length
                  ? '<div class="card-meta">' + f.refs.map((r) => {
                      const b = beads.find((x) => x.ref === r);
                      const stateCls = b && b.available ? (b.found ? "ref-" + esc(b.status || "open") : "ref-missing") : "";
                      const suffix = b && b.available ? (b.found ? " [" + b.status + "]" : " [missing]") : "";
                      return '<span class="ref-chip ' + stateCls + '">' + esc(r + suffix) + "</span>";
                    }).join(" ") + "</div>"
                  : "";
                return '<article class="card" tabindex="0" role="button" aria-label="Open ' + esc(f.title) + ' (' + esc(f.status) + ')" data-feature-id="' + esc(f.id) + '">' +
                  '<div class="card-top"><div class="card-title-wrap"><div class="card-title">' + esc(f.title) + '</div><div class="card-id">' + esc(f.id) + "</div></div>" +
                  '<span class="pill status-' + esc(f.status) + '">' + esc(f.status) + "</span></div>" +
                  (f.description ? '<p class="card-desc">' + esc(f.description) + "</p>" : "") +
                  '<div class="card-meta">' +
                    (f.area ? '<span class="area-badge">' + esc(f.area) + "</span>" : "") +
                    (total > 0
                      ? "<span>" + done + "/" + total + ' criteria</span><span class="mini-track" aria-hidden="true"><span class="mini-fill' + (criteriaPct === 100 ? " is-done" : "") + '" style="width:' + criteriaPct + '%"></span></span>'
                      : "<span>No criteria</span>") +
                  "</div>" +
                  depsHtml +
                  refsHtml +
                  (latest ? '<div class="card-pulse">' + esc(latest.note) + "</div>" : "") +
                "</article>";
              }).join("") +
              "</div>";

          return '<section class="milestone">' +
            '<div class="milestone-head">' +
              '<div class="milestone-title"><h2>' + esc(m.title) + '</h2><span class="code-tag">' + esc(m.id) + '</span><span class="pill status-' + esc(m.status) + '">' + esc(m.status) + "</span>" +
              (m.target ? '<span class="code-tag">' + esc(m.target) + "</span>" : "") + "</div>" +
              '<div class="code-tag">' + mShipped + "/" + allMFeatures.length + " shipped (" + pct + "%)</div>" +
            "</div>" +
            (m.description ? '<p class="milestone-desc">' + esc(m.description) + "</p>" : "") +
            '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
            cardsHtml +
          "</section>";
        })
        .join("");

      wireFeatureTriggers(container);
    }

    function renderGraphView(container, data, filteredFeatures) {
      if (filteredFeatures.length === 0) {
        activeGraphApi = null;
        container.innerHTML = '<div class="graph-shell"><p class="empty-msg">No features match the active filter.</p></div>';
        return;
      }

      const milestoneOrder = new Map(data.milestones.map((m) => [m.id, m.order]));
      const byId = new Map(filteredFeatures.map((f) => [f.id, f]));
      const visibleSet = new Set(byId.keys());
      const layerMap = new Map();

      function computeLayer(id, visiting) {
        if (layerMap.has(id)) return layerMap.get(id);
        if (visiting.has(id)) return 0;
        visiting.add(id);
        const feat = byId.get(id);
        let maxDep = -1;
        if (feat) {
          for (const dep of feat.depends_on || []) {
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

      for (const f of filteredFeatures) {
        computeLayer(f.id, new Set());
      }

      const rows = new Map();
      let maxLayer = 0;
      for (const f of filteredFeatures) {
        const layer = layerMap.get(f.id) || 0;
        maxLayer = Math.max(maxLayer, layer);
        if (!rows.has(layer)) rows.set(layer, []);
        rows.get(layer).push(f);
      }

      function compareBase(a, b) {
        const ma = milestoneOrder.get(a.milestone) ?? 9999;
        const mb = milestoneOrder.get(b.milestone) ?? 9999;
        if (ma !== mb) return ma - mb;
        if (a.order !== b.order) return a.order - b.order;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }

      const colIndexMap = new Map();
      for (let layer = 0; layer <= maxLayer; layer++) {
        const list = rows.get(layer) || [];
        if (layer === 0) {
          list.sort(compareBase);
        } else {
          list.sort((a, b) => {
            function avgParentCol(feat) {
              let sum = 0;
              let count = 0;
              for (const dep of feat.depends_on || []) {
                if (visibleSet.has(dep) && colIndexMap.has(dep)) {
                  sum += colIndexMap.get(dep);
                  count += 1;
                }
              }
              return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
            }
            const pa = avgParentCol(a);
            const pb = avgParentCol(b);
            if (Math.abs(pa - pb) > 0.001) return pa - pb;
            return compareBase(a, b);
          });
        }
        list.forEach((f, idx) => colIndexMap.set(f.id, idx));
      }

      const NODE_W = 248;
      const NODE_H = 92;
      const COL_GAP = 24;
      const ROW_GAP = 64;
      const PAD = 40;

      let maxRowW = 0;
      for (let layer = 0; layer <= maxLayer; layer++) {
        const list = rows.get(layer) || [];
        const rowW = list.length * NODE_W + Math.max(0, list.length - 1) * COL_GAP;
        maxRowW = Math.max(maxRowW, rowW);
      }

      const stageW = Math.max(760, PAD * 2 + maxRowW);
      const stageH = Math.max(280, PAD * 2 + (maxLayer + 1) * NODE_H + maxLayer * ROW_GAP);

      const pos = new Map();
      for (let layer = 0; layer <= maxLayer; layer++) {
        const list = rows.get(layer) || [];
        const rowW = list.length * NODE_W + Math.max(0, list.length - 1) * COL_GAP;
        const startX = Math.round((stageW - rowW) / 2);
        list.forEach((f, idx) => {
          pos.set(f.id, {
            x: startX + idx * (NODE_W + COL_GAP),
            y: PAD + layer * (NODE_H + ROW_GAP),
          });
        });
      }

      const edges = [];
      const outgoing = new Map();
      for (const f of filteredFeatures) {
        for (const dep of f.depends_on || []) {
          if (visibleSet.has(dep) && dep !== f.id) {
            edges.push({ from: dep, to: f.id });
            if (!outgoing.has(dep)) outgoing.set(dep, []);
            outgoing.get(dep).push(f.id);
          }
        }
      }

      const ancestors = new Map();
      const descendants = new Map();
      function collectAncestors(id, visited) {
        const f = byId.get(id);
        if (!f) return;
        for (const dep of f.depends_on || []) {
          if (visibleSet.has(dep) && dep !== id && !visited.has(dep)) {
            visited.add(dep);
            collectAncestors(dep, visited);
          }
        }
      }
      function collectDescendants(id, visited) {
        for (const next of outgoing.get(id) || []) {
          if (!visited.has(next)) {
            visited.add(next);
            collectDescendants(next, visited);
          }
        }
      }
      for (const f of filteredFeatures) {
        const anc = new Set();
        collectAncestors(f.id, anc);
        ancestors.set(f.id, anc);
        const desc = new Set();
        collectDescendants(f.id, desc);
        descendants.set(f.id, desc);
      }

      const svgPaths = edges.map((e) => {
        const p1 = pos.get(e.from);
        const p2 = pos.get(e.to);
        const x1 = p1.x + NODE_W / 2;
        const y1 = p1.y + NODE_H;
        const x2 = p2.x + NODE_W / 2;
        const y2 = p2.y;
        const dy = Math.max(32, Math.abs(y2 - y1) * 0.45);
        const d = "M " + x1 + " " + y1 + " C " + x1 + " " + (y1 + dy) + ", " + x2 + " " + (y2 - dy) + ", " + x2 + " " + y2;
        return '<path class="graph-edge" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '" d="' + d + '" />';
      }).join("");

      const nodesHtml = filteredFeatures.map((f) => {
        const p = pos.get(f.id);
        const done = f.ship_criteria.filter((c) => c.done).length;
        const total = f.ship_criteria.length;
        return '<button type="button" class="graph-node" data-feature-id="' + esc(f.id) + '" style="left:' + p.x + "px;top:" + p.y + "px;width:" + NODE_W + "px;height:" + NODE_H + 'px">' +
          '<div class="graph-node-top"><span class="graph-node-title">' + esc(f.title) + '</span><span class="pill status-' + esc(f.status) + '" style="padding:2px 7px;font-size:0.7rem">' + esc(f.status) + "</span></div>" +
          '<div class="graph-node-meta"><span>' + esc(f.milestone) + (f.area ? " · " + esc(f.area) : "") + "</span><span>" + done + "/" + total + " criteria</span></div>" +
        "</button>";
      }).join("");

      container.innerHTML =
        '<div class="graph-shell">' +
          '<div class="graph-bar">' +
            '<div class="graph-legend">' +
              '<span>Hover or focus a feature to trace dependencies · Drag to pan · Scroll to zoom</span>' +
              '<span class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span> Selected</span>' +
              '<span class="legend-item"><span class="legend-swatch" style="background:var(--amber)"></span> Upstream prerequisites</span>' +
              '<span class="legend-item"><span class="legend-swatch" style="background:var(--green)"></span> Downstream dependents</span>' +
            "</div>" +
            '<div class="graph-controls" role="toolbar" aria-label="Dependency graph zoom controls">' +
              '<button type="button" class="graph-ctrl-btn" id="graph-zoom-out" aria-label="Zoom out" title="Zoom out (-)">−</button>' +
              '<button type="button" class="graph-ctrl-btn graph-zoom-readout" id="graph-zoom-reset" aria-label="Reset zoom to 100%" title="Reset view (0)">100%</button>' +
              '<button type="button" class="graph-ctrl-btn" id="graph-zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>' +
              '<button type="button" class="graph-ctrl-btn" id="graph-zoom-fit" aria-label="Fit graph to view" title="Fit graph to view (F)">Fit</button>' +
            "</div>" +
          "</div>" +
          '<div class="graph-viewport" id="graph-viewport">' +
            '<div class="graph-canvas" id="graph-canvas">' +
              '<div class="graph-stage" style="width:' + stageW + "px;height:" + stageH + 'px">' +
                '<svg class="graph-edges" width="' + stageW + '" height="' + stageH + '" viewBox="0 0 ' + stageW + " " + stageH + '">' +
                  "<defs>" +
                    '<marker id="pp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" style="color:var(--muted)" /></marker>' +
                    '<marker id="pp-arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" style="color:var(--amber)" /></marker>' +
                    '<marker id="pp-arrow-down" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" style="color:var(--green)" /></marker>' +
                  "</defs>" +
                  svgPaths +
                "</svg>" +
                nodesHtml +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>";

      const viewportEl = document.getElementById("graph-viewport");
      const canvasEl = document.getElementById("graph-canvas");
      const zoomOutBtn = document.getElementById("graph-zoom-out");
      const zoomResetBtn = document.getElementById("graph-zoom-reset");
      const zoomInBtn = document.getElementById("graph-zoom-in");
      const zoomFitBtn = document.getElementById("graph-zoom-fit");

      const MIN_ZOOM = 0.25;
      const MAX_ZOOM = 2.0;
      const cam = state.graphCamera;

      function clamp(val, minVal, maxVal) {
        return Math.min(maxVal, Math.max(minVal, val));
      }

      function getViewportSize() {
        return {
          vw: Math.max(320, viewportEl.clientWidth || 760),
          vh: Math.max(320, viewportEl.clientHeight || 420),
        };
      }

      function clampCamera() {
        const { vw, vh } = getViewportSize();
        const scaledW = stageW * cam.scale;
        const scaledH = stageH * cam.scale;
        const padX = Math.min(80, Math.floor(vw * 0.35), Math.floor(scaledW * 0.5));
        const padY = Math.min(80, Math.floor(vh * 0.35), Math.floor(scaledH * 0.5));
        cam.tx = clamp(cam.tx, padX - scaledW, vw - padX);
        cam.ty = clamp(cam.ty, padY - scaledH, vh - padY);
      }

      function applyCamera() {
        canvasEl.style.transform = "translate(" + Math.round(cam.tx) + "px, " + Math.round(cam.ty) + "px) scale(" + cam.scale + ")";
        canvasEl.dataset.scale = cam.scale.toFixed(3);
        if (zoomResetBtn) {
          zoomResetBtn.textContent = Math.round(cam.scale * 100) + "%";
        }
        const gridStep = Math.max(10, Math.round(24 * cam.scale));
        viewportEl.style.backgroundSize = gridStep + "px " + gridStep + "px";
        viewportEl.style.backgroundPosition = Math.round(cam.tx) + "px " + Math.round(cam.ty) + "px";
      }

      function resetView() {
        const { vw, vh } = getViewportSize();
        cam.scale = 1;
        const scaledW = stageW * cam.scale;
        const scaledH = stageH * cam.scale;
        cam.tx = Math.round((vw - scaledW) / 2);
        cam.ty = scaledH <= vh - 32 ? Math.round((vh - scaledH) / 2) : 20;
        clampCamera();
        applyCamera();
      }

      function fitView() {
        const { vw, vh } = getViewportSize();
        const rawScale = Math.min(1, (vw - 56) / stageW, (vh - 56) / stageH);
        cam.scale = clamp(rawScale, MIN_ZOOM, 1);
        const scaledW = stageW * cam.scale;
        const scaledH = stageH * cam.scale;
        cam.tx = Math.round((vw - scaledW) / 2);
        cam.ty = Math.round((vh - scaledH) / 2);
        clampCamera();
        applyCamera();
      }

      function zoomAt(nextScale, cx, cy) {
        const clamped = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
        if (Math.abs(clamped - cam.scale) < 0.0001) return;
        const worldX = (cx - cam.tx) / cam.scale;
        const worldY = (cy - cam.ty) / cam.scale;
        cam.scale = clamped;
        cam.tx = cx - worldX * clamped;
        cam.ty = cy - worldY * clamped;
        clampCamera();
        applyCamera();
      }

      function zoomFromCenter(factor) {
        const { vw, vh } = getViewportSize();
        zoomAt(cam.scale * factor, vw / 2, vh / 2);
      }

      const layoutKey = filteredFeatures.map((f) => f.id).join(",") + "|" + stageW + "x" + stageH;
      if (!cam.initialized || cam.layoutKey !== layoutKey) {
        cam.initialized = true;
        cam.layoutKey = layoutKey;
        resetView();
      } else {
        clampCamera();
        applyCamera();
      }

      let dragState = null;
      let suppressNextClick = false;

      viewportEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest(".graph-controls")) return;
        suppressNextClick = false;
        dragState = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          startTx: cam.tx,
          startTy: cam.ty,
          dragging: false,
        };
      });

      viewportEl.addEventListener("pointermove", (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.dragging) {
          if (Math.hypot(dx, dy) <= 5) return;
          dragState.dragging = true;
          viewportEl.classList.add("is-dragging");
          try {
            viewportEl.setPointerCapture(e.pointerId);
          } catch {}
        }
        cam.tx = dragState.startTx + dx;
        cam.ty = dragState.startTy + dy;
        clampCamera();
        applyCamera();
      });

      function endDrag(e) {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        if (dragState.dragging) {
          suppressNextClick = true;
          viewportEl.classList.remove("is-dragging");
          try {
            if (viewportEl.hasPointerCapture(e.pointerId)) {
              viewportEl.releasePointerCapture(e.pointerId);
            }
          } catch {}
        }
        dragState = null;
      }

      viewportEl.addEventListener("pointerup", endDrag);
      viewportEl.addEventListener("pointercancel", endDrag);
      viewportEl.addEventListener("lostpointercapture", () => {
        viewportEl.classList.remove("is-dragging");
        dragState = null;
      });

      viewportEl.addEventListener("click", (e) => {
        if (suppressNextClick) {
          suppressNextClick = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);

      viewportEl.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = viewportEl.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const step = e.ctrlKey ? -e.deltaY * 0.01 : -e.deltaY * 0.0014;
        const factor = Math.exp(Math.max(-0.35, Math.min(0.35, step)));
        zoomAt(cam.scale * factor, cx, cy);
      }, { passive: false });

      if (zoomInBtn) zoomInBtn.addEventListener("click", () => zoomFromCenter(1.2));
      if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => zoomFromCenter(1 / 1.2));
      if (zoomResetBtn) zoomResetBtn.addEventListener("click", resetView);
      if (zoomFitBtn) zoomFitBtn.addEventListener("click", fitView);

      function ensureNodeVisible(el) {
        const vpRect = viewportEl.getBoundingClientRect();
        const nodeRect = el.getBoundingClientRect();
        const margin = 24;
        let dx = 0;
        let dy = 0;
        if (nodeRect.left < vpRect.left + margin) dx = vpRect.left + margin - nodeRect.left;
        else if (nodeRect.right > vpRect.right - margin) dx = vpRect.right - margin - nodeRect.right;
        if (nodeRect.top < vpRect.top + margin) dy = vpRect.top + margin - nodeRect.top;
        else if (nodeRect.bottom > vpRect.bottom - margin) dy = vpRect.bottom - margin - nodeRect.bottom;
        if (dx !== 0 || dy !== 0) {
          cam.tx += dx;
          cam.ty += dy;
          clampCamera();
          applyCamera();
        }
      }

      activeGraphApi = {
        zoomIn: () => zoomFromCenter(1.2),
        zoomOut: () => zoomFromCenter(1 / 1.2),
        reset: resetView,
        fit: fitView,
        onResize: () => {
          clampCamera();
          applyCamera();
        },
      };

      const nodeEls = Array.from(container.querySelectorAll(".graph-node"));
      const edgeEls = Array.from(container.querySelectorAll(".graph-edge"));

      function applyHighlight(focusId) {
        if (!focusId) {
          for (const el of nodeEls) el.classList.remove("is-active", "is-upstream", "is-downstream", "is-dimmed");
          for (const edge of edgeEls) edge.classList.remove("is-upstream", "is-downstream", "is-dimmed");
          return;
        }
        const anc = ancestors.get(focusId) || new Set();
        const desc = descendants.get(focusId) || new Set();
        for (const el of nodeEls) {
          const nid = el.getAttribute("data-feature-id");
          el.classList.remove("is-active", "is-upstream", "is-downstream", "is-dimmed");
          if (nid === focusId) el.classList.add("is-active");
          else if (anc.has(nid)) el.classList.add("is-upstream");
          else if (desc.has(nid)) el.classList.add("is-downstream");
          else el.classList.add("is-dimmed");
        }
        for (const edge of edgeEls) {
          const from = edge.getAttribute("data-from");
          const to = edge.getAttribute("data-to");
          edge.classList.remove("is-upstream", "is-downstream", "is-dimmed");
          const isUp = (to === focusId || anc.has(to)) && anc.has(from);
          const isDown = (from === focusId || desc.has(from)) && desc.has(to);
          if (isUp) edge.classList.add("is-upstream");
          else if (isDown) edge.classList.add("is-downstream");
          else edge.classList.add("is-dimmed");
        }
      }

      for (const el of nodeEls) {
        const nid = el.getAttribute("data-feature-id");
        el.addEventListener("mouseenter", () => applyHighlight(nid));
        el.addEventListener("focus", () => {
          ensureNodeVisible(el);
          applyHighlight(nid);
        });
        el.addEventListener("mouseleave", () => applyHighlight(null));
        el.addEventListener("blur", () => applyHighlight(null));
      }

      wireFeatureTriggers(container);
    }

    function renderBoardView(container, data, filteredFeatures) {
      const columns = ["planned", "in-progress", "shipped"];
      const hasPaused = state.statusFilter === "paused" || data.features.some((f) => f.status === "paused");
      const hasCut = state.statusFilter === "cut" || data.features.some((f) => f.status === "cut");
      if (hasPaused) columns.push("paused");
      if (hasCut) columns.push("cut");

      const labels = {
        planned: "Planned",
        "in-progress": "In Progress",
        shipped: "Shipped",
        paused: "Paused",
        cut: "Cut",
      };

      container.innerHTML = '<div class="board-grid">' + columns.map((colStatus) => {
        const colFeatures = filteredFeatures.filter((f) => f.status === colStatus);
        const cards = colFeatures.length === 0
          ? '<p class="empty-msg" style="font-size:0.82rem;margin:6px 0">No features</p>'
          : colFeatures.map((f) => {
              const done = f.ship_criteria.filter((c) => c.done).length;
              const total = f.ship_criteria.length;
              return '<article class="board-card" tabindex="0" role="button" aria-label="Open ' + esc(f.title) + ' (' + esc(f.status) + ')" data-feature-id="' + esc(f.id) + '">' +
                '<div class="card-title">' + esc(f.title) + "</div>" +
                '<div class="card-id">' + esc(f.id) + "</div>" +
                '<div class="card-meta">' +
                  '<span class="code-tag">' + esc(f.milestone) + "</span>" +
                  (f.area ? '<span class="area-badge">' + esc(f.area) + "</span>" : "") +
                  (total > 0 ? "<span>" + done + "/" + total + "</span>" : "") +
                  (state.showDeps && f.depends_on.length ? "<span>" + f.depends_on.length + " dep(s)</span>" : "") +
                "</div>" +
              "</article>";
            }).join("");

        return '<section class="board-col" data-status-col="' + esc(colStatus) + '">' +
          '<div class="board-col-head"><span class="pill status-' + esc(colStatus) + '">' + esc(labels[colStatus]) + '</span><span class="code-tag">' + colFeatures.length + "</span></div>" +
          cards +
        "</section>";
      }).join("") + "</div>";

      wireFeatureTriggers(container);
    }

    function renderAll() {
      const data = state.data;
      if (!data) return;

      document.getElementById("project-name").textContent = data.config.project.name || "Roadmap";
      document.getElementById("project-summary").textContent = data.config.project.summary || "";

      const healthBadge = document.getElementById("health-badge");
      if (data.check.ok && data.check.warnings.length === 0) {
        healthBadge.className = "pill pill-btn status-shipped";
        healthBadge.textContent = "Check OK";
      } else if (data.check.ok) {
        healthBadge.className = "pill pill-btn pill-warn";
        healthBadge.textContent = data.check.warnings.length + " warning(s)";
      } else {
        healthBadge.className = "pill pill-btn pill-err";
        healthBadge.textContent = data.check.errors.length + " error(s)";
      }
      renderHealthPanel();

      const milestoneSel = document.getElementById("filter-milestone");
      const currentM = state.milestoneFilter;
      milestoneSel.innerHTML = '<option value="">All Milestones</option>' +
        data.milestones.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.title) + "</option>").join("");
      milestoneSel.value = currentM;

      const areaSel = document.getElementById("filter-area");
      const areas = Array.from(new Set(data.features.map((f) => f.area).filter(Boolean))).sort();
      const currentA = state.areaFilter;
      areaSel.innerHTML = '<option value="">All Areas</option>' +
        areas.map((a) => '<option value="' + esc(a) + '">' + esc(a) + "</option>").join("");
      areaSel.value = currentA;

      const q = state.search.trim().toLowerCase();
      const hasActiveFilters = Boolean(state.milestoneFilter || state.statusFilter || state.areaFilter || q);
      const resetBtn = document.getElementById("filter-reset");
      if (resetBtn) resetBtn.hidden = !hasActiveFilters;

      const visibleMilestones = data.milestones.filter((m) => !state.milestoneFilter || m.id === state.milestoneFilter);
      const filteredFeatures = data.features.filter((f) => {
        if (state.milestoneFilter && f.milestone !== state.milestoneFilter) return false;
        if (state.statusFilter && f.status !== state.statusFilter) return false;
        if (state.areaFilter && f.area !== state.areaFilter) return false;
        if (q && !(f.title.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q))) return false;
        return true;
      });

      const statFeatures = hasActiveFilters ? filteredFeatures : data.features;
      const shipped = statFeatures.filter((f) => f.status === "shipped").length;
      const inProgress = statFeatures.filter((f) => f.status === "in-progress").length;
      const planned = statFeatures.filter((f) => f.status === "planned").length;
      const pausedOrCut = statFeatures.filter((f) => f.status === "paused" || f.status === "cut").length;
      const statCards = [
        ["Milestones", visibleMilestones.length, hasActiveFilters && visibleMilestones.length !== data.milestones.length ? "/ " + data.milestones.length : ""],
        ["Features", statFeatures.length, hasActiveFilters && statFeatures.length !== data.features.length ? "/ " + data.features.length : ""],
        ["Shipped", shipped, ""],
        ["In Progress", inProgress, ""],
        ["Planned", planned, ""],
        ["Paused / Cut", pausedOrCut, ""],
      ];
      document.getElementById("stats").innerHTML = statCards
        .map(([label, val, sub]) =>
          '<div class="stat-card"><div class="stat-label">' + esc(label) + '</div><div class="stat-value"><span>' + esc(val) + "</span>" +
          (sub ? '<span class="stat-sub">' + esc(sub) + "</span>" : "") + "</div></div>"
        )
        .join("");

      document.querySelectorAll(".view-tab").forEach((tab) => {
        const active = tab.getAttribute("data-view") === state.viewMode;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });

      document.body.classList.toggle("view-mode-graph", state.viewMode === "graph");

      const container = document.getElementById("milestones");
      if (state.viewMode === "graph") {
        renderGraphView(container, data, filteredFeatures);
      } else if (state.viewMode === "board") {
        activeGraphApi = null;
        renderBoardView(container, data, filteredFeatures);
      } else {
        activeGraphApi = null;
        renderCardsView(container, data, visibleMilestones);
      }

      renderDrawer();
    }

    function renderDrawer(opts) {
      const backdrop = document.getElementById("drawer-backdrop");
      const drawer = document.getElementById("drawer");
      if (!state.selectedFeatureId || !state.data) {
        backdrop.classList.remove("open");
        backdrop.setAttribute("aria-hidden", "true");
        drawer.innerHTML = "";
        return;
      }
      const feature = state.data.features.find((f) => f.id === state.selectedFeatureId);
      if (!feature) {
        backdrop.classList.remove("open");
        backdrop.setAttribute("aria-hidden", "true");
        drawer.innerHTML = "";
        return;
      }

      const isStatic = PP_RUNTIME.mode === "static";
      const prevInput = document.getElementById("drawer-note-input");
      let restoreInputFocus = false;
      let selStart = null;
      let selEnd = null;
      if (prevInput) {
        state.noteDrafts[feature.id] = prevInput.value;
        if (document.activeElement === prevInput) {
          restoreInputFocus = true;
          selStart = prevInput.selectionStart;
          selEnd = prevInput.selectionEnd;
        }
      }
      const prevScrollTop = drawer.scrollTop;

      backdrop.classList.add("open");
      backdrop.setAttribute("aria-hidden", "false");

      const beads = (state.data.beads && state.data.beads[feature.id]) || [];
      const statuses = ["planned", "in-progress", "shipped", "paused", "cut"];
      const currentDraft = state.noteDrafts[feature.id] || "";

      const statusBlock = isStatic
        ? '<div><div class="section-label">Status</div><span class="pill status-' + esc(feature.status) + '">' + esc(feature.status) + "</span></div>"
        : '<div><label class="section-label" for="drawer-status">Status</label>' +
            '<select id="drawer-status" aria-label="Feature status" style="width:100%;padding:8px;border-radius:8px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);font-family:inherit">' +
              statuses.map((s) => '<option value="' + s + '"' + (s === feature.status ? " selected" : "") + ">" + s + "</option>").join("") +
            "</select></div>";

      const noteFormBlock = isStatic
        ? ""
        : '<div><label class="section-label" for="drawer-note-input">Add Pulse Note</label>' +
            '<form class="note-form" id="drawer-note-form"><input id="drawer-note-input" aria-label="Add pulse note" placeholder="Log milestone update..." required /><button class="btn-primary" id="drawer-note-submit" type="submit">Log</button></form>' +
          "</div>";

      drawer.innerHTML =
        '<div class="drawer-head">' +
          '<div><h2 id="drawer-title" style="margin:0">' + esc(feature.title) + '</h2><div style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="code-tag">' + esc(feature.id) + '</span><span class="code-tag">' + esc(feature.milestone) + "</span>" +
          (feature.area ? '<span class="area-badge">' + esc(feature.area) + "</span>" : "") + "</div></div>" +
          '<button type="button" class="close-btn" id="drawer-close" aria-label="Close feature details">Close</button>' +
        "</div>" +
        '<div id="drawer-feedback" class="drawer-feedback" role="status" aria-live="polite"></div>' +
        statusBlock +
        (feature.description ? '<div><div class="section-label">Overview</div><p style="margin:0">' + esc(feature.description) + "</p></div>" : "") +
        (feature.depends_on.length ? '<div><div class="section-label">Depends On</div><div style="display:flex;gap:6px;flex-wrap:wrap">' +
          feature.depends_on.map((d) => '<button type="button" class="dep-chip" data-jump="' + esc(d) + '">' + esc(d) + "</button>").join("") + "</div></div>" : "") +
        (feature.refs.length ? '<div><div class="section-label">External Refs</div><div style="display:flex;gap:6px;flex-wrap:wrap">' +
          feature.refs.map((r) => {
            const b = beads.find((x) => x.ref === r);
            const stateCls = b && b.available ? (b.found ? "ref-" + esc(b.status || "open") : "ref-missing") : "";
            const info = b && b.available ? (b.found ? " — " + b.status + (b.title ? ": " + b.title : "") : " — NOT FOUND") : "";
            return '<span class="ref-chip ' + stateCls + '">' + esc(r + info) + "</span>";
          }).join("") + "</div></div>" : "") +
        '<div><div class="section-label">Ship Criteria</div>' +
          (feature.ship_criteria.length === 0
            ? '<p class="empty-msg">No ship criteria defined.</p>'
            : '<ul class="criteria-list">' + feature.ship_criteria.map((c) =>
                '<li><label class="criteria-item' + (isStatic ? " is-readonly" : "") + '"><input type="checkbox" data-criterion-id="' + esc(c.id) + '"' + (c.done ? " checked" : "") + (isStatic ? " disabled" : "") + ' /><div class="criteria-body"><div class="criteria-text">' + esc(c.text) + '</div><div class="criteria-id">' + esc(c.id) + "</div></div></label></li>"
              ).join("") + "</ul>") +
        "</div>" +
        noteFormBlock +
        '<div><div class="section-label">Pulse Updates</div>' +
          (feature.updates.length === 0
            ? '<p class="empty-msg">No updates logged yet.</p>'
            : '<ul class="updates-list">' + feature.updates.slice().reverse().map((u) =>
                '<li class="update-entry"><div class="update-at" title="' + esc(u.at) + '">' + esc(formatTimestamp(u.at)) + "</div><div>" + esc(u.note) + "</div></li>"
              ).join("") + "</ul>") +
        "</div>";

      renderFeedback();
      drawer.scrollTop = prevScrollTop;

      const noteInput = document.getElementById("drawer-note-input");
      if (noteInput) {
        noteInput.value = currentDraft;
        noteInput.addEventListener("input", () => {
          state.noteDrafts[feature.id] = noteInput.value;
        });
      }

      if (restoreInputFocus && noteInput) {
        noteInput.focus();
        if (selStart !== null && selEnd !== null && typeof noteInput.setSelectionRange === "function") {
          noteInput.setSelectionRange(selStart, selEnd);
        }
      } else if (opts && opts.focusClose) {
        document.getElementById("drawer-close").focus();
      }

      document.getElementById("drawer-close").addEventListener("click", closeDrawer);

      const statusSel = document.getElementById("drawer-status");
      if (statusSel) {
        statusSel.addEventListener("change", (e) => {
          sendPulse(feature.id, { status: e.target.value });
        });
      }

      if (!isStatic) {
        drawer.querySelectorAll("input[data-criterion-id]").forEach((cb) => {
          cb.addEventListener("change", () => {
            sendPulse(feature.id, {
              toggleCriterionId: cb.getAttribute("data-criterion-id"),
              done: cb.checked,
            });
          });
        });
      }

      drawer.querySelectorAll("[data-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetId = btn.getAttribute("data-jump");
          if (targetId) {
            state.feedback = null;
            openDrawer(targetId, { focusDrawer: true });
          }
        });
      });

      const noteForm = document.getElementById("drawer-note-form");
      if (noteForm && noteInput) {
        noteForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          const note = noteInput.value.trim();
          if (!note) return;
          const submitBtn = document.getElementById("drawer-note-submit");
          if (submitBtn) submitBtn.disabled = true;
          await sendPulse(feature.id, { note }, () => {
            delete state.noteDrafts[feature.id];
            noteInput.value = "";
          });
          const newSubmitBtn = document.getElementById("drawer-note-submit");
          if (newSubmitBtn) newSubmitBtn.disabled = false;
        });
      }
    }

    document.querySelectorAll(".view-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const nextView = tab.getAttribute("data-view");
        if (nextView && nextView !== state.viewMode) {
          state.viewMode = nextView;
          renderAll();
        }
      });
    });

    document.getElementById("health-badge").addEventListener("click", () => {
      state.healthPanelOpen = !state.healthPanelOpen;
      renderHealthPanel();
    });

    document.getElementById("theme-toggle").addEventListener("click", () => {
      const next = getEffectiveTheme() === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("pp-theme", next);
      } catch {}
      syncThemeButton();
    });

    document.getElementById("filter-milestone").addEventListener("change", (e) => {
      state.milestoneFilter = e.target.value;
      renderAll();
    });
    document.getElementById("filter-status").addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      renderAll();
    });
    document.getElementById("filter-area").addEventListener("change", (e) => {
      state.areaFilter = e.target.value;
      renderAll();
    });
    document.getElementById("filter-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderAll();
    });
    document.getElementById("toggle-deps").addEventListener("change", (e) => {
      state.showDeps = e.target.checked;
      renderAll();
    });
    document.getElementById("filter-reset").addEventListener("click", () => {
      state.milestoneFilter = "";
      state.statusFilter = "";
      state.areaFilter = "";
      state.search = "";
      document.getElementById("filter-search").value = "";
      renderAll();
    });
    document.getElementById("drawer-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "drawer-backdrop") {
        closeDrawer();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (state.healthPanelOpen) {
          state.healthPanelOpen = false;
          renderHealthPanel();
          document.getElementById("health-badge").focus();
        } else if (state.selectedFeatureId) {
          closeDrawer();
        }
      } else if (state.viewMode === "graph" && activeGraphApi && !state.selectedFeatureId) {
        const activeTag = document.activeElement && document.activeElement.tagName;
        if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          activeGraphApi.zoomIn();
        } else if (e.key === "-") {
          e.preventDefault();
          activeGraphApi.zoomOut();
        } else if (e.key === "0") {
          e.preventDefault();
          activeGraphApi.reset();
        } else if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          activeGraphApi.fit();
        }
      }
    });
    window.addEventListener("resize", () => {
      if (activeGraphApi) activeGraphApi.onResize();
    });

    syncThemeButton();
    loadProjectSwitcher();

    if (PP_RUNTIME.mode === "live") {
      const events = new EventSource(apiUrl("/api/events"));
      events.addEventListener("reload", () => {
        fetchRoadmap().catch(console.error);
      });
      events.addEventListener("error", () => {
        const badge = document.getElementById("live-badge");
        badge.className = "pill pill-warn";
        badge.textContent = "Reconnecting…";
      });
      events.addEventListener("open", () => {
        const badge = document.getElementById("live-badge");
        badge.className = "pill pill-live";
        badge.innerHTML = '<span class="dot"></span> Live';
      });
    }

    fetchRoadmap().catch((err) => {
      document.getElementById("project-name").textContent = "Failed to load roadmap";
      document.getElementById("project-summary").textContent = err.message;
    });
  </script>
</body>
</html>`;
}

/**
 * Builds the multi-project hub portfolio overview page served at `/`.
 */
export function buildPortfolioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Pulse — Portfolio Hub</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URL}" />
  ${EARLY_THEME_SCRIPT}
  <style>
    ${SHARED_THEME_CSS}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .container { max-width: 1120px; margin: 0 auto; padding: 32px 24px 64px; }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    h1 { margin: 0; font-size: 1.85rem; letter-spacing: -0.02em; }
    .subtitle { margin: 6px 0 0; color: var(--muted); }
    .header-actions { display: flex; gap: 10px; align-items: center; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .pill-live { background: var(--green-soft); color: var(--green); }
    .pill-live .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
    .pill-err { background: var(--red-soft); color: var(--red); }
    .icon-btn {
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
      font-family: inherit;
    }
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .project-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .project-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .project-top > div { min-width: 0; }
    .project-title { font-size: 1.15rem; font-weight: 700; margin: 0; }
    .project-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.74rem;
      color: var(--muted);
      word-break: break-all;
      margin-top: 2px;
    }
    .project-summary { margin: 0; color: var(--muted); font-size: 0.88rem; }
    .progress-track { width: 100%; height: 7px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--green); }
    .project-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.8rem; color: var(--muted); }
    .project-actions { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
    .btn-open {
      display: inline-block;
      padding: 7px 14px;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .btn-remove {
      padding: 6px 10px;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
      cursor: pointer;
      font-size: 0.8rem;
      font-family: inherit;
    }
    .btn-remove:hover { color: var(--red); border-color: var(--red); }
    .empty { color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Project Pulse Hub</h1>
        <p class="subtitle">Local portfolio overview across your active repository roadmaps.</p>
      </div>
      <div class="header-actions">
        <span class="pill pill-live"><span class="dot"></span> Hub Active</span>
        <button type="button" class="icon-btn" id="theme-toggle">Theme</button>
      </div>
    </header>
    <main id="projects" class="projects-grid"></main>
  </div>

  <script>
    function esc(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    function getEffectiveTheme() {
      const explicit = document.documentElement.dataset.theme;
      if (explicit === "light" || explicit === "dark") return explicit;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    function syncThemeButton() {
      const eff = getEffectiveTheme();
      document.getElementById("theme-toggle").textContent = eff === "light" ? "Light theme" : "Dark theme";
    }
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const next = getEffectiveTheme() === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("pp-theme", next); } catch {}
      syncThemeButton();
    });
    syncThemeButton();

    async function loadProjects() {
      const container = document.getElementById("projects");
      const res = await fetch("/api/hub/projects");
      if (!res.ok) {
        container.innerHTML = '<p class="empty">Failed to load hub projects.</p>';
        return;
      }
      const data = await res.json();
      const projects = data.projects || [];
      if (projects.length === 0) {
        container.innerHTML = '<p class="empty">No repositories registered yet. Run <code>pp view</code> inside any Project Pulse repository.</p>';
        return;
      }
      container.innerHTML = projects.map((p) => {
        const total = p.totals.features || 0;
        const shipped = p.totals.shipped || 0;
        const pct = total ? Math.round((shipped / total) * 100) : 0;
        const healthPill = p.check && p.check.ok
          ? '<span class="pill pill-live">Check OK</span>'
          : '<span class="pill pill-err">' + ((p.check && p.check.errorCount) || 1) + " error(s)</span>";
        return '<article class="project-card" data-project-slug="' + esc(p.slug) + '">' +
          '<div class="project-top"><div><h2 class="project-title">' + esc(p.name) + '</h2><div class="project-path">' + esc(p.rootDir) + "</div></div>" + healthPill + "</div>" +
          (p.summary ? '<p class="project-summary">' + esc(p.summary) + "</p>" : "") +
          '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="project-meta"><span>' + shipped + "/" + total + " shipped (" + pct + "%)</span><span>" + (p.totals.milestones || 0) + " milestone(s)</span><span>" + (p.totals.inProgress || 0) + " in progress</span></div>" +
          '<div class="project-actions"><a class="btn-open" href="' + esc(p.url) + '">Open Dashboard</a><button type="button" class="btn-remove" data-remove-slug="' + esc(p.slug) + '">Remove</button></div>' +
        "</article>";
      }).join("");

      container.querySelectorAll("[data-remove-slug]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const slug = btn.getAttribute("data-remove-slug");
          if (!slug) return;
          const r = await fetch("/api/hub/projects/" + encodeURIComponent(slug) + "/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (r.ok) loadProjects();
        });
      });
    }

    loadProjects();
  </script>
</body>
</html>`;
}
