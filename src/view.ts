import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
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

function buildDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Pulse — Roadmap</title>
  <style>
    :root {
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
      :root {
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
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
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
      margin-bottom: 20px;
    }
    h1 { margin: 0; font-size: 1.85rem; letter-spacing: -0.02em; }
    .subtitle { margin: 6px 0 0; color: var(--muted); max-width: 72ch; }
    .header-badges { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .pill-live { background: var(--green-soft); color: var(--green); border-color: rgba(52, 211, 153, 0.3); }
    .pill-live .dot { background: var(--green); }
    .pill-warn { background: var(--amber-soft); color: var(--amber); }
    .pill-err { background: var(--red-soft); color: var(--red); }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
    }
    .stat-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .stat-value { font-size: 1.4rem; font-weight: 700; margin-top: 2px; }
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
    }
    .filters input[type="search"] { min-width: 200px; flex: 1; }
    .toggle-label { display: inline-flex; align-items: center; gap: 6px; font-size: 0.86rem; color: var(--muted); cursor: pointer; }
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
      font-size: 0.78rem;
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
      padding: 14px;
      cursor: pointer;
      transition: transform 0.12s ease, border-color 0.12s ease;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card:hover { transform: translateY(-1px); border-color: var(--accent); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .card-title { font-weight: 650; font-size: 0.98rem; }
    .card-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.76rem; color: var(--muted); }
    .card-pulse { font-size: 0.82rem; color: var(--muted); border-left: 2px solid var(--border); padding-left: 8px; }
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
      gap: 18px;
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
    }
    .section-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 6px; font-weight: 700; }
    .criteria-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .criteria-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: var(--surface-2);
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .criteria-item input { margin-top: 3px; cursor: pointer; }
    .note-form { display: flex; gap: 8px; }
    .note-form input {
      flex: 1;
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .updates-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .update-entry { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 0.86rem; }
    .update-at { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.74rem; color: var(--muted); }
    .dep-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.76rem;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      cursor: pointer;
      border: none;
    }
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
        <span class="pill" id="health-badge">Checking…</span>
      </div>
    </header>

    <section class="stats" id="stats"></section>

    <section class="filters">
      <select id="filter-milestone"><option value="">All Milestones</option></select>
      <select id="filter-status">
        <option value="">All Statuses</option>
        <option value="planned">planned</option>
        <option value="in-progress">in-progress</option>
        <option value="shipped">shipped</option>
        <option value="paused">paused</option>
        <option value="cut">cut</option>
      </select>
      <select id="filter-area"><option value="">All Areas</option></select>
      <input type="search" id="filter-search" placeholder="Filter features..." />
      <label class="toggle-label">
        <input type="checkbox" id="toggle-deps" checked />
        Show dependencies
      </label>
    </section>

    <main id="milestones"></main>
  </div>

  <div class="drawer-backdrop" id="drawer-backdrop">
    <aside class="drawer" id="drawer"></aside>
  </div>

  <script>
    const state = {
      data: null,
      selectedFeatureId: null,
      milestoneFilter: "",
      statusFilter: "",
      areaFilter: "",
      search: "",
      showDeps: true,
    };

    function esc(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    async function fetchRoadmap() {
      const res = await fetch("/api/roadmap");
      if (!res.ok) throw new Error("Failed to load /api/roadmap");
      state.data = await res.json();
      renderAll();
    }

    async function sendPulse(featureId, body) {
      const res = await fetch("/api/features/" + encodeURIComponent(featureId) + "/pulse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Update failed" }));
        alert(err.error || "Update failed");
        return;
      }
      await fetchRoadmap();
    }

    function renderAll() {
      const data = state.data;
      if (!data) return;

      document.getElementById("project-name").textContent = data.config.project.name || "Roadmap";
      document.getElementById("project-summary").textContent = data.config.project.summary || "";

      const healthBadge = document.getElementById("health-badge");
      if (data.check.ok && data.check.warnings.length === 0) {
        healthBadge.className = "pill status-shipped";
        healthBadge.textContent = "Check OK";
      } else if (data.check.ok) {
        healthBadge.className = "pill pill-warn";
        healthBadge.textContent = data.check.warnings.length + " warning(s)";
      } else {
        healthBadge.className = "pill pill-err";
        healthBadge.textContent = data.check.errors.length + " error(s)";
      }

      const features = data.features;
      const shipped = features.filter((f) => f.status === "shipped").length;
      const inProgress = features.filter((f) => f.status === "in-progress").length;
      const planned = features.filter((f) => f.status === "planned").length;
      document.getElementById("stats").innerHTML = [
        ["Milestones", data.milestones.length],
        ["Features", features.length],
        ["Shipped", shipped],
        ["In Progress", inProgress],
        ["Planned", planned],
      ]
        .map(([label, val]) => '<div class="stat-card"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + esc(val) + "</div></div>")
        .join("");

      const milestoneSel = document.getElementById("filter-milestone");
      const currentM = state.milestoneFilter;
      milestoneSel.innerHTML = '<option value="">All Milestones</option>' +
        data.milestones.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.title) + "</option>").join("");
      milestoneSel.value = currentM;

      const areaSel = document.getElementById("filter-area");
      const areas = Array.from(new Set(features.map((f) => f.area).filter(Boolean))).sort();
      const currentA = state.areaFilter;
      areaSel.innerHTML = '<option value="">All Areas</option>' +
        areas.map((a) => '<option value="' + esc(a) + '">' + esc(a) + "</option>").join("");
      areaSel.value = currentA;

      const container = document.getElementById("milestones");
      const q = state.search.trim().toLowerCase();
      const visibleMilestones = data.milestones.filter((m) => !state.milestoneFilter || m.id === state.milestoneFilter);

      if (visibleMilestones.length === 0) {
        container.innerHTML = '<p class="empty-msg">No milestones match the active filter.</p>';
      } else {
        container.innerHTML = visibleMilestones
          .map((m) => {
            const allMFeatures = features.filter((f) => f.milestone === m.id);
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
                  const latest = f.updates.length ? f.updates[f.updates.length - 1] : null;
                  const beads = (data.beads && data.beads[f.id]) || [];
                  const depsHtml = state.showDeps && f.depends_on.length
                    ? '<div class="card-meta">Depends on: ' + f.depends_on.map((d) => '<span class="code-tag">' + esc(d) + "</span>").join(" ") + "</div>"
                    : "";
                  const refsHtml = f.refs.length
                    ? '<div class="card-meta">' + f.refs.map((r) => {
                        const b = beads.find((x) => x.ref === r);
                        const suffix = b && b.available ? (b.found ? " [" + b.status + "]" : " [missing]") : "";
                        return '<span class="code-tag">' + esc(r + suffix) + "</span>";
                      }).join(" ") + "</div>"
                    : "";
                  return '<article class="card" data-feature-id="' + esc(f.id) + '">' +
                    '<div class="card-top"><div><div class="card-title">' + esc(f.title) + '</div><span class="code-tag">' + esc(f.id) + "</span></div>" +
                    '<span class="pill status-' + esc(f.status) + '">' + esc(f.status) + "</span></div>" +
                    '<div class="card-meta">' +
                      (f.area ? '<span class="code-tag">' + esc(f.area) + "</span>" : "") +
                      (total > 0 ? "<span>Criteria: " + done + "/" + total + "</span>" : "<span>No criteria</span>") +
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
        el.addEventListener("click", () => {
          state.selectedFeatureId = el.getAttribute("data-feature-id");
          renderDrawer();
        });
      });

      renderDrawer();
    }

    function renderDrawer() {
      const backdrop = document.getElementById("drawer-backdrop");
      const drawer = document.getElementById("drawer");
      if (!state.selectedFeatureId || !state.data) {
        backdrop.classList.remove("open");
        drawer.innerHTML = "";
        return;
      }
      const feature = state.data.features.find((f) => f.id === state.selectedFeatureId);
      if (!feature) {
        backdrop.classList.remove("open");
        return;
      }
      backdrop.classList.add("open");

      const beads = (state.data.beads && state.data.beads[feature.id]) || [];
      const statuses = ["planned", "in-progress", "shipped", "paused", "cut"];

      drawer.innerHTML =
        '<div class="drawer-head">' +
          '<div><h2 style="margin:0">' + esc(feature.title) + '</h2><div style="margin-top:4px;display:flex;gap:8px;align-items:center"><span class="code-tag">' + esc(feature.id) + '</span><span class="code-tag">' + esc(feature.milestone) + "</span>" +
          (feature.area ? '<span class="code-tag">' + esc(feature.area) + "</span>" : "") + "</div></div>" +
          '<button class="close-btn" id="drawer-close">Close</button>' +
        "</div>" +
        '<div><div class="section-label">Status</div>' +
          '<select id="drawer-status" style="width:100%;padding:8px;border-radius:8px;background:var(--surface-2);color:var(--text);border:1px solid var(--border)">' +
            statuses.map((s) => '<option value="' + s + '"' + (s === feature.status ? " selected" : "") + ">" + s + "</option>").join("") +
          "</select></div>" +
        (feature.description ? '<div><div class="section-label">Overview</div><p style="margin:0">' + esc(feature.description) + "</p></div>" : "") +
        (feature.depends_on.length ? '<div><div class="section-label">Depends On</div><div style="display:flex;gap:6px;flex-wrap:wrap">' +
          feature.depends_on.map((d) => '<button class="dep-chip" data-jump="' + esc(d) + '">' + esc(d) + "</button>").join("") + "</div></div>" : "") +
        (feature.refs.length ? '<div><div class="section-label">External Refs</div><div style="display:flex;gap:6px;flex-wrap:wrap">' +
          feature.refs.map((r) => {
            const b = beads.find((x) => x.ref === r);
            const info = b && b.available ? (b.found ? " — " + b.status + (b.title ? ": " + b.title : "") : " — NOT FOUND") : "";
            return '<span class="code-tag">' + esc(r + info) + "</span>";
          }).join("") + "</div></div>" : "") +
        '<div><div class="section-label">Ship Criteria</div>' +
          (feature.ship_criteria.length === 0
            ? '<p class="empty-msg">No ship criteria defined.</p>'
            : '<ul class="criteria-list">' + feature.ship_criteria.map((c) =>
                '<li class="criteria-item"><input type="checkbox" data-criterion-id="' + esc(c.id) + '"' + (c.done ? " checked" : "") + ' /><span>' + esc(c.text) + ' <span class="code-tag">' + esc(c.id) + "</span></span></li>"
              ).join("") + "</ul>") +
        "</div>" +
        '<div><div class="section-label">Add Pulse Note</div>' +
          '<form class="note-form" id="drawer-note-form"><input id="drawer-note-input" placeholder="Log milestone update..." required /><button class="btn-primary" type="submit">Log</button></form>' +
        "</div>" +
        '<div><div class="section-label">Pulse Updates</div>' +
          (feature.updates.length === 0
            ? '<p class="empty-msg">No updates logged yet.</p>'
            : '<ul class="updates-list">' + feature.updates.slice().reverse().map((u) =>
                '<li class="update-entry"><div class="update-at">' + esc(u.at) + "</div><div>" + esc(u.note) + "</div></li>"
              ).join("") + "</ul>") +
        "</div>";

      document.getElementById("drawer-close").addEventListener("click", () => {
        state.selectedFeatureId = null;
        renderDrawer();
      });
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
          state.selectedFeatureId = btn.getAttribute("data-jump");
          renderDrawer();
        });
      });
      document.getElementById("drawer-note-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("drawer-note-input");
        const note = input.value.trim();
        if (!note) return;
        input.value = "";
        sendPulse(feature.id, { note });
      });
    }

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
    document.getElementById("drawer-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "drawer-backdrop") {
        state.selectedFeatureId = null;
        renderDrawer();
      }
    });

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

      if (req.method === "GET" && url.pathname === "/api/roadmap") {
        try {
          const loaded = service.load();
          const check = await service.checkWithBeads({
            beads: loaded.config.integrations.beads.enabled,
            beadsClient,
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
        const featureId = decodeURIComponent(pulseMatch[1]!);
        try {
          const body = (await req.json()) as {
            status?: FeatureStatus;
            toggleCriterionId?: string;
            done?: boolean;
            note?: string;
          };
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

  const actualPort = server.port ?? requestedPort;
  const viewUrl = `http://${hostname}:${actualPort}`;

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
    port: actualPort,
    url: viewUrl,
    stop,
  };
}
