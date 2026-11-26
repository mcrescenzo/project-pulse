import type {
  BeadStatusInfo,
  Feature,
  Milestone,
  PulseConfig,
  ValidationIssue,
} from "./types";

import { DASHBOARD_CLIENT_SCRIPT } from "./dashboard/client";
import { DASHBOARD_CSS } from "./dashboard/styles";
import { EARLY_THEME_SCRIPT, FAVICON_DATA_URL, SHARED_THEME_CSS } from "./dashboard/theme";

export { FAVICON_DATA_URL, FAVICON_SVG } from "./dashboard/theme";
export { buildPortfolioHtml } from "./dashboard/portfolio";

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

  // Offline snapshots are opened from disk: lock them down to inline code/styles with no network access.
  const staticCspMeta =
    mode === "static"
      ? `\n  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />`
      : "";

  const liveBadgeInitial =
    mode === "static"
      ? `<span class="pill pill-snapshot" id="live-badge">Offline Snapshot</span>`
      : `<span class="pill pill-live" id="live-badge"><span class="dot"></span> Live</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />${staticCspMeta}
  <title>Project Pulse — Roadmap</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URL}" />
  ${EARLY_THEME_SCRIPT}
  <style>
    ${SHARED_THEME_CSS}${DASHBOARD_CSS}  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        ${switcherHtml}
        <h1 id="project-name">Loading roadmap…</h1>
        <p class="subtitle" id="project-summary"></p>
        <div class="load-status" id="load-status" role="alert" hidden></div>
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
    const PP_RUNTIME = ${escapeJsonForScript(runtimeConfig)};${DASHBOARD_CLIENT_SCRIPT}  </script>
</body>
</html>`;
}
