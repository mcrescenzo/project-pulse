import type {
  BeadStatusInfo,
  Feature,
  Milestone,
  PulseConfig,
  ValidationIssue,
} from "./types";
import type { ActivityResult } from "./activity";

import { DASHBOARD_CLIENT_SCRIPT } from "./dashboard/client";
import { PRESENT_CLIENT_JS, statusLabel, VIEW_LABELS } from "./present";
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
    /** False when write-blocking errors (parse, schema, dependency) freeze editing. */
    editable?: boolean;
    /** The errors behind `editable: false`. */
    blocking?: ValidationIssue[];
    /** ROADMAP.md is stale; editing still works and `pp render` (or any write) fixes it. */
    stale?: boolean;
  };
  beads: Record<string, BeadStatusInfo[]>;
  /** Precomputed Activity for static exports (live pages fetch /api/activity instead). */
  activity?: ActivityResult;
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
    ? `<nav class="hub-bar" aria-label="Hub navigation">
      <a class="hub-home-link" href="${escapeHtmlAttr(options.projectSwitcher.portfolioUrl)}">All projects</a>
      <select id="project-switcher" class="hub-select" aria-label="Switch project"></select>
    </nav>`
    : "";

  // Offline snapshots are opened from disk: lock them down to inline code/styles with no network access.
  const staticCspMeta =
    mode === "static"
      ? `\n  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />`
      : "";

  const liveBadgeInitial =
    mode === "static"
      ? `<span class="pill pill-snapshot" id="live-badge">Read-only snapshot</span>`
      : `<button type="button" class="pill pill-live pill-btn" id="live-badge" title="Reload the roadmap"><span class="dot"></span> Live</button>`;

  const projectName = options.embeddedData?.config?.project?.name;
  const pageTitle = projectName ? `${escapeHtmlText(projectName)} · Project Pulse` : "Project Pulse";
  const statuses = ["planned", "in-progress", "shipped", "paused", "cut"];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />${staticCspMeta}
  <title>${pageTitle}</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URL}" />
  ${EARLY_THEME_SCRIPT}
  <style>
    ${SHARED_THEME_CSS}${DASHBOARD_CSS}  </style>
</head>
<body>
  <div class="page" id="page">
    ${switcherHtml}
    <header class="topbar">
      <div class="who">
        <h1 id="project-name"></h1>
        <p class="subtitle" id="project-summary"></p>
      </div>
      <div class="topbar-right">
        <div class="dist" id="dist" role="group" aria-label="Features by status (click to filter)"></div>
        <button type="button" class="pill pill-btn" id="health-badge" aria-expanded="false" aria-controls="health-panel" hidden></button>
        ${liveBadgeInitial}
        <button type="button" class="icon-btn" id="theme-toggle" aria-pressed="false">Theme</button>
      </div>
    </header>

    <section class="health-panel" id="health-panel" hidden aria-label="Roadmap validation and Beads health details"></section>

    <nav class="toolbar" aria-label="Views and filters">
      <div class="view-tabs" role="tablist" aria-label="Views">
        <button type="button" class="view-tab is-active" id="tab-roadmap" role="tab" aria-selected="true" data-view="roadmap">${VIEW_LABELS.roadmap}</button>
        <button type="button" class="view-tab" id="tab-graph" role="tab" aria-selected="false" data-view="graph">${VIEW_LABELS.graph}</button>
        <button type="button" class="view-tab" id="tab-activity" role="tab" aria-selected="false" data-view="activity">${VIEW_LABELS.activity}</button>
      </div>
      <div class="filters" role="group" aria-label="Filters">
        <select id="filter-milestone" aria-label="Filter by milestone"><option value="">All milestones</option></select>
        <select id="filter-status" aria-label="Filter by status">
          <option value="">All statuses</option>
          ${statuses.map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join("\n          ")}
        </select>
        <select id="filter-area" aria-label="Filter by area"><option value="">All areas</option></select>
        <input type="search" id="filter-search" aria-label="Filter features by text" placeholder="Filter features…" />
        <label class="toggle-label"><input type="checkbox" id="toggle-deps" checked /> Deps</label>
        <button type="button" class="btn-ghost" id="filter-reset" data-visible="false" aria-hidden="true" tabindex="-1">Reset filters</button>
      </div>
    </nav>

    <div class="notice is-warn load-status" id="load-status" role="alert" hidden></div>
    <main id="view" class="view" aria-live="polite"><p class="loading" id="loading">Loading the roadmap…</p></main>
  </div>

  <div class="drawer-backdrop" id="drawer-backdrop" aria-hidden="true">
    <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"></aside>
  </div>

  ${embeddedDataScript}
  <script>
    const PP_RUNTIME = ${escapeJsonForScript(runtimeConfig)};${PRESENT_CLIENT_JS}${DASHBOARD_CLIENT_SCRIPT}  </script>
</body>
</html>`;
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
