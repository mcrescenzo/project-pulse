import { existsSync, watch, type FSWatcher } from "node:fs";
import { CliBeadsClient, type BeadsClient } from "./beads";
import { RoadmapService } from "./store";
import type { BeadStatusInfo, FeatureStatus } from "./types";

export interface ViewServerOptions {
  port?: number;
  hostname?: string;
  beadsClient?: BeadsClient;
}

export interface ViewServerHandle {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  url: string;
  stop: () => void;
}

const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><path d="M5 17h5l3-8 5 14 3-6h6" fill="none" stroke="#60a5fa" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

function buildAllowedHosts(boundPort: number, hostname: string): Set<string> {
  const hosts = new Set<string>([
    `127.0.0.1:${boundPort}`,
    `localhost:${boundPort}`,
    `[::1]:${boundPort}`,
    `${hostname.toLowerCase()}:${boundPort}`,
  ]);
  if (boundPort === 80) {
    hosts.add("127.0.0.1");
    hosts.add("localhost");
    hosts.add("[::1]");
    hosts.add(hostname.toLowerCase());
  }
  return hosts;
}

function validateMutationRequest(
  req: Request,
  boundPort: number,
  hostname: string
): { status: number; error: string } | null {
  const contentType = (req.headers.get("content-type") ?? "").trim().toLowerCase();
  if (!(contentType === "application/json" || contentType.startsWith("application/json;"))) {
    return { status: 415, error: "Content-Type must be application/json" };
  }

  const allowedHosts = buildAllowedHosts(boundPort, hostname);

  const hostHeader = req.headers.get("host");
  if (hostHeader !== null && !allowedHosts.has(hostHeader.trim().toLowerCase())) {
    return { status: 403, error: "Forbidden host header for local dashboard mutation" };
  }

  const originHeader = req.headers.get("origin");
  if (originHeader !== null) {
    const trimmed = originHeader.trim();
    if (trimmed.toLowerCase() === "null") {
      return { status: 403, error: "Forbidden null origin" };
    }
    try {
      const originUrl = new URL(trimmed);
      if (originUrl.protocol !== "http:" || !allowedHosts.has(originUrl.host.toLowerCase())) {
        return { status: 403, error: "Forbidden cross-origin request" };
      }
    } catch {
      return { status: 403, error: "Invalid Origin header" };
    }
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    const site = secFetchSite.trim().toLowerCase();
    if (site !== "same-origin" && site !== "none") {
      return { status: 403, error: `Forbidden cross-site request (${secFetchSite})` };
    }
  }

  return null;
}

function buildDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Pulse — Roadmap</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URL}" />
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
  <style>
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
    .card:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .container { max-width: 1180px; margin: 0 auto; padding: 28px 24px 72px; }
    header {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 18px;
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
      margin-bottom: 20px;
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
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
      margin-bottom: 28px;
    }
    .filters select, .filters input[type="search"] {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 0.88rem;
      font-family: inherit;
    }
    .filters input[type="search"] { min-width: 200px; flex: 1; }
    .toggle-label { display: inline-flex; align-items: center; gap: 6px; font-size: 0.86rem; color: var(--muted); cursor: pointer; }
    .btn-ghost {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-ghost:hover { border-color: var(--accent); background: var(--accent-soft); }
    .milestone {
      margin-bottom: 34px;
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
    .mini-fill { height: 100%; background: var(--accent); }
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
    .criteria-item input { margin-top: 3px; cursor: pointer; flex-shrink: 0; }
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
        <h1 id="project-name">Loading roadmap…</h1>
        <p class="subtitle" id="project-summary"></p>
      </div>
      <div class="header-badges">
        <span class="pill pill-live" id="live-badge"><span class="dot"></span> Live</span>
        <button type="button" class="pill pill-btn" id="health-badge" aria-expanded="false" aria-controls="health-panel">Checking…</button>
        <button type="button" class="icon-btn" id="theme-toggle" aria-label="Toggle color theme" title="Switch light or dark theme">Theme</button>
      </div>
    </header>

    <section class="health-panel" id="health-panel" hidden aria-label="Roadmap validation and Beads health details"></section>

    <section class="stats" id="stats"></section>

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

    <main id="milestones"></main>
  </div>

  <div class="drawer-backdrop" id="drawer-backdrop" aria-hidden="true">
    <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"></aside>
  </div>

  <script>
    const state = {
      data: null,
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
    };

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
        const card = document.querySelector('.card[data-feature-id="' + CSS.escape(returnId) + '"]');
        if (card && typeof card.focus === "function") {
          card.focus();
        }
      }
      state.lastFocusedCardId = null;
    }

    async function fetchRoadmap() {
      const res = await fetch("/api/roadmap");
      if (!res.ok) throw new Error("Failed to load /api/roadmap");
      state.data = await res.json();
      renderAll();
    }

    async function sendPulse(featureId, body, onSuccess) {
      state.saving = true;
      state.feedback = { kind: "saving", message: "Saving..." };
      renderFeedback();
      try {
        const res = await fetch("/api/features/" + encodeURIComponent(featureId) + "/pulse", {
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

      const container = document.getElementById("milestones");
      if (visibleMilestones.length === 0) {
        container.innerHTML = '<p class="empty-msg">No milestones match the active filter.</p>';
      } else {
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
                        ? "<span>" + done + "/" + total + ' criteria</span><span class="mini-track" aria-hidden="true"><span class="mini-fill" style="width:' + criteriaPct + '%"></span></span>'
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
      }

      document.querySelectorAll(".card[data-feature-id]").forEach((el) => {
        const activate = () => {
          const id = el.getAttribute("data-feature-id");
          if (id) {
            state.lastFocusedCardId = id;
            openDrawer(id, { focusDrawer: true });
          }
        };
        el.addEventListener("click", activate);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          }
        });
      });

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

      // Preserve active note input draft, focus, and caret selection across SSE reloads
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

      drawer.innerHTML =
        '<div class="drawer-head">' +
          '<div><h2 id="drawer-title" style="margin:0">' + esc(feature.title) + '</h2><div style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="code-tag">' + esc(feature.id) + '</span><span class="code-tag">' + esc(feature.milestone) + "</span>" +
          (feature.area ? '<span class="area-badge">' + esc(feature.area) + "</span>" : "") + "</div></div>" +
          '<button type="button" class="close-btn" id="drawer-close" aria-label="Close feature details">Close</button>' +
        "</div>" +
        '<div id="drawer-feedback" class="drawer-feedback" role="status" aria-live="polite"></div>' +
        '<div><label class="section-label" for="drawer-status">Status</label>' +
          '<select id="drawer-status" aria-label="Feature status" style="width:100%;padding:8px;border-radius:8px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);font-family:inherit">' +
            statuses.map((s) => '<option value="' + s + '"' + (s === feature.status ? " selected" : "") + ">" + s + "</option>").join("") +
          "</select></div>" +
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
                '<li><label class="criteria-item"><input type="checkbox" data-criterion-id="' + esc(c.id) + '"' + (c.done ? " checked" : "") + ' /><div class="criteria-body"><div class="criteria-text">' + esc(c.text) + '</div><div class="criteria-id">' + esc(c.id) + "</div></div></label></li>"
              ).join("") + "</ul>") +
        "</div>" +
        '<div><label class="section-label" for="drawer-note-input">Add Pulse Note</label>' +
          '<form class="note-form" id="drawer-note-form"><input id="drawer-note-input" aria-label="Add pulse note" placeholder="Log milestone update..." required /><button class="btn-primary" id="drawer-note-submit" type="submit">Log</button></form>' +
        "</div>" +
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
      noteInput.value = currentDraft;
      noteInput.addEventListener("input", () => {
        state.noteDrafts[feature.id] = noteInput.value;
      });

      if (restoreInputFocus) {
        noteInput.focus();
        if (selStart !== null && selEnd !== null && typeof noteInput.setSelectionRange === "function") {
          noteInput.setSelectionRange(selStart, selEnd);
        }
      } else if (opts && opts.focusClose) {
        document.getElementById("drawer-close").focus();
      }

      document.getElementById("drawer-close").addEventListener("click", closeDrawer);
      document.getElementById("drawer-status").addEventListener("change", (e) => {
        sendPulse(feature.id, { status: e.target.value });
      });
      drawer.querySelectorAll("input[data-criterion-id]").forEach((cb) => {
        cb.addEventListener("change", () => {
          sendPulse(feature.id, {
            toggleCriterionId: cb.getAttribute("data-criterion-id"),
            done: cb.checked,
          });
        });
      });
      drawer.querySelectorAll("[data-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetId = btn.getAttribute("data-jump");
          if (targetId) {
            state.feedback = null;
            openDrawer(targetId, { focusDrawer: true });
          }
        });
      });
      document.getElementById("drawer-note-form").addEventListener("submit", async (e) => {
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
      }
    });

    syncThemeButton();

    const events = new EventSource("/api/events");
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

    fetchRoadmap().catch((err) => {
      document.getElementById("project-name").textContent = "Failed to load roadmap";
      document.getElementById("project-summary").textContent = err.message;
    });
  </script>
</body>
</html>`;
}

/**
 * Starts the live-reloading local browser dashboard server (`pp view`).
 */
export function startViewServer(
  rootDir: string,
  options: ViewServerOptions = {}
): ViewServerHandle {
  const service = new RoadmapService(rootDir);
  service.requireInitialized();

  const beadsClient = options.beadsClient ?? new CliBeadsClient();
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? 4310;
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let boundPort = requestedPort;

  const broadcastReload = (reason = "fs") => {
    if (closed) return;
    const payload = encoder.encode(
      `event: reload\ndata: ${JSON.stringify({ at: new Date().toISOString(), reason })}\n\n`
    );
    for (const controller of clients) {
      try {
        controller.enqueue(payload);
      } catch {
        clients.delete(controller);
      }
    }
  };

  const scheduleBroadcast = () => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcastReload("watch");
    }, 60);
  };

  // Watch only .project-pulse/ directories (never ROADMAP.md) to avoid feedback loops
  for (const dir of [service.pulseDir, service.milestonesDir, service.featuresDir]) {
    if (existsSync(dir)) {
      const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
        if (filename && String(filename).includes(".tmp.")) return;
        scheduleBroadcast();
      });
      watchers.push(watcher);
    }
  }

  keepaliveTimer = setInterval(() => {
    const ping = encoder.encode(": ping\n\n");
    for (const controller of clients) {
      try {
        controller.enqueue(ping);
      } catch {
        clients.delete(controller);
      }
    }
  }, 25_000);

  const dashboardHtml = buildDashboardHtml();

  const server = Bun.serve({
    hostname,
    port: requestedPort,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(dashboardHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        return new Response(FAVICON_SVG, {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/roadmap") {
        try {
          const loaded = service.load();
          const check = await service.checkWithBeads({
            beads: loaded.config.integrations.beads.enabled,
            beadsClient,
            loaded,
          });

          // Include synthetic Backlog group if features reference default milestone without file
          const knownIds = new Set(loaded.milestones.map((m) => m.id));
          const defaultId = loaded.config.defaults.milestone;
          const milestones = [...loaded.milestones];
          if (
            !knownIds.has(defaultId) &&
            loaded.features.some((f) => f.milestone === defaultId)
          ) {
            milestones.push({
              id: defaultId,
              title: "Backlog",
              order: 9999,
              status: "planned",
              description: "Features queued without a specific release milestone.",
            });
          }

          const beads: Record<string, BeadStatusInfo[]> = check.beads ?? {};
          return Response.json({
            config: loaded.config,
            milestones,
            features: loaded.features,
            check: {
              ok: check.ok,
              errors: check.errors,
              warnings: check.warnings,
            },
            beads,
          });
        } catch (error) {
          return Response.json(
            { ok: false, error: (error as Error).message },
            { status: 500 }
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        let clientController: ReadableStreamDefaultController<Uint8Array> | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            clientController = controller;
            clients.add(controller);
            controller.enqueue(encoder.encode(": connected\n\n"));
          },
          cancel() {
            if (clientController) {
              clients.delete(clientController);
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      const pulseMatch = url.pathname.match(/^\/api\/features\/([^/]+)\/pulse$/);
      if (req.method === "POST" && pulseMatch) {
        const securityFailure = validateMutationRequest(req, boundPort, hostname);
        if (securityFailure) {
          return Response.json(
            { ok: false, error: securityFailure.error },
            { status: securityFailure.status }
          );
        }

        let featureId: string;
        try {
          featureId = decodeURIComponent(pulseMatch[1]!);
        } catch {
          return Response.json({ ok: false, error: "Invalid feature id encoding" }, { status: 400 });
        }

        let body: {
          status?: FeatureStatus;
          toggleCriterionId?: string;
          done?: boolean;
          note?: string;
        };
        try {
          const parsedBody = await req.json();
          if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
            return Response.json({ ok: false, error: "Request body must be a JSON object" }, { status: 400 });
          }
          body = parsedBody as typeof body;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
        }

        try {
          const res = service.logFeaturePulse({
            id: featureId,
            status: body.status,
            toggleCriterionId: body.toggleCriterionId,
            done: body.done,
            note: body.note,
          });
          broadcastReload("api");
          return Response.json({
            ok: true,
            feature: res.entity,
            warnings: res.warnings,
          });
        } catch (error) {
          const message = (error as Error).message;
          const status = message.includes("not found") ? 404 : 400;
          return Response.json({ ok: false, error: message }, { status });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  boundPort = server.port ?? requestedPort;
  const viewUrl = `http://${hostname}:${boundPort}`;

  const stop = () => {
    if (closed) return;
    closed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore watcher close failure
      }
    }
    for (const controller of clients) {
      try {
        controller.close();
      } catch {
        // Ignore already-closed stream
      }
    }
    clients.clear();
    server.stop(true);
  };

  return {
    server,
    port: boundPort,
    url: viewUrl,
    stop,
  };
}
