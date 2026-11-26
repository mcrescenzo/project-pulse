/**
 * Client-side script for the project dashboard. Runs in the browser after PP_RUNTIME and
 * PP_PRESENT are declared.
 *
 * Written as plain ES2020 inside a template literal: no backticks, no "${", and no backslash
 * escapes in this source (the template literal would consume them).
 */
export const DASHBOARD_CLIENT_SCRIPT = `
    const STATUSES = ["planned", "in-progress", "shipped", "paused", "cut"];
    const isStatic = PP_RUNTIME.mode === "static";
    const state = {
      data: null,
      view: "roadmap",
      milestoneFilter: "",
      statusFilter: "",
      areaFilter: "",
      search: "",
      showDeps: true,
      healthPanelOpen: false,
      noteDrafts: Object.create(null),
      ctl: Object.create(null),
      selectedFeatureId: null,
      drawerFeatureId: null,
      drawerReturnFocusEl: null,
      pendingShip: null,
      diagnosticsOpen: false,
      readSeq: 0,
      loadError: null,
      refreshNote: null,
      graphCamera: { scale: 1, tx: 0, ty: 0, initialized: false, layoutKey: "" },
      graphPinned: null,
      activity: { window: "7d", result: null, error: null, loading: false, seq: 0, lastVisit: null },
    };
    let activeGraphApi = null;
    const page = document.getElementById("page");

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

    const label = (s) => PP_PRESENT.statusLabel(s);

    function statusMark(status, extraClass) {
      return '<span class="st st-' + esc(status) + (extraClass ? " " + extraClass : "") + '"><i class="dot" aria-hidden="true"></i><span class="status-word">' + esc(label(status)) + "</span></span>";
    }

    function criteriaDone(f) {
      return f.ship_criteria.filter((c) => c.done).length;
    }

    function isEditable() {
      if (isStatic || !state.data) return false;
      return state.data.check.editable !== false;
    }

    function blockingIssues() {
      const check = (state.data && state.data.check) || {};
      return check.blocking || check.errors || [];
    }

    // ---------------------------------------------------------------- theme

    function getEffectiveTheme() {
      const explicit = document.documentElement.dataset.theme;
      if (explicit === "light" || explicit === "dark") return explicit;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }

    function syncThemeButton() {
      const btn = document.getElementById("theme-toggle");
      if (!btn) return;
      const eff = getEffectiveTheme();
      // Labelled by the action it performs; pressed while the light theme is on.
      btn.textContent = eff === "light" ? "Dark" : "Light";
      btn.setAttribute("aria-pressed", String(eff === "light"));
      btn.title = eff === "light" ? "Switch to the dark theme" : "Switch to the light theme";
    }

    // ---------------------------------------------------------------- filters

    function hasFeatureFilter() {
      return Boolean(state.statusFilter || state.areaFilter || state.search.trim());
    }

    function hasAnyFilter() {
      return Boolean(state.milestoneFilter || hasFeatureFilter());
    }

    function describeFilters() {
      const parts = [];
      if (state.milestoneFilter) {
        const m = state.data && state.data.milestones.find((x) => x.id === state.milestoneFilter);
        parts.push("milestone: " + (m ? m.title : state.milestoneFilter));
      }
      if (state.statusFilter) parts.push("status: " + label(state.statusFilter));
      if (state.areaFilter) parts.push("area: " + state.areaFilter);
      if (state.search.trim()) parts.push('search: "' + state.search.trim() + '"');
      return parts.join(", ");
    }

    function matchesSearch(f, q) {
      return f.title.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q);
    }

    /** Features passing every filter except (optionally) status. */
    function filterFeatures(includeStatus) {
      const q = state.search.trim().toLowerCase();
      return state.data.features.filter((f) => {
        if (state.milestoneFilter && f.milestone !== state.milestoneFilter) return false;
        if (includeStatus && state.statusFilter && f.status !== state.statusFilter) return false;
        if (state.areaFilter && f.area !== state.areaFilter) return false;
        if (q && !matchesSearch(f, q)) return false;
        return true;
      });
    }

    function resetFilters() {
      state.milestoneFilter = "";
      state.statusFilter = "";
      state.areaFilter = "";
      state.search = "";
      document.getElementById("filter-search").value = "";
      renderAll();
    }

    function emptyState(what) {
      // what: "features" | "changes"
      if (hasAnyFilter()) {
        return '<div class="state-msg" data-empty="filtered"><h2>No ' + what + " match " + esc(describeFilters()) + '.</h2><p>Clear the filters to see everything.</p><button type="button" class="btn-ghost" data-action="reset-filters">Reset filters</button></div>';
      }
      if (what === "features") {
        return '<div class="state-msg" data-empty="none"><h2>No features yet.</h2><p>Add one with <code>pp feature add &lt;id&gt; --title "…" --milestone &lt;milestone&gt;</code>; it appears here as soon as it is saved.</p></div>';
      }
      return "";
    }

    function wireCommon(container) {
      container.querySelectorAll('[data-action="reset-filters"]').forEach((btn) => btn.addEventListener("click", resetFilters));
    }

    // ---------------------------------------------------------------- loading

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
          if (e.target.value) window.location.assign(e.target.value);
        });
      } catch {
        // Ignore a transient hub switcher lookup error.
      }
    }

    async function fetchRoadmap() {
      if (isStatic) {
        const el = document.getElementById("pp-embedded-data");
        state.data = el ? JSON.parse(el.textContent || "{}") : null;
        renderAll();
        return true;
      }
      const seq = ++state.readSeq;
      let payload = null;
      let failure = null;
      try {
        const res = await fetch(apiUrl("/api/roadmap"));
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const detail = body && typeof body.error === "string" && body.error ? body.error : "HTTP " + res.status;
          throw new Error(detail);
        }
        payload = await res.json();
      } catch (err) {
        failure = err;
      }
      if (seq !== state.readSeq) return false;
      if (failure) {
        state.loadError = (failure && failure.message) || "Failed to load the roadmap";
        renderAll();
        return false;
      }
      state.data = payload;
      state.loadError = null;
      renderAll();
      if (state.view === "activity") loadActivity();
      return true;
    }

    // ---------------------------------------------------------------- header

    function renderHeader() {
      const data = state.data;
      const healthBadge = document.getElementById("health-badge");
      if (!data) {
        healthBadge.hidden = true;
        document.getElementById("dist").innerHTML = "";
        return;
      }
      const name = data.config.project.name || "Roadmap";
      document.getElementById("project-name").textContent = name;
      const summary = document.getElementById("project-summary");
      summary.textContent = data.config.project.summary || "";
      summary.title = data.config.project.summary || "";
      document.title = name + " · Project Pulse";

      healthBadge.hidden = false;
      const errors = data.check.errors.length;
      const warnings = data.check.warnings.length;
      healthBadge.className = "pill pill-btn " + (errors ? "pill-err" : warnings ? "pill-warn" : "pill-ok");
      healthBadge.textContent = PP_PRESENT.healthText(errors, warnings);
      renderHealthPanel();
      renderDistribution();
    }

    function renderDistribution() {
      const el = document.getElementById("dist");
      const scoped = filterFeatures(false);
      const counts = STATUSES.map((s) => [s, scoped.filter((f) => f.status === s).length]).filter(([, n]) => n > 0);
      const total = counts.reduce((a, [, n]) => a + n, 0);
      el.classList.toggle("is-filtered", Boolean(state.statusFilter));
      if (total === 0) {
        el.innerHTML = '<span class="mono">0 features</span>';
        return;
      }
      el.innerHTML =
        '<span class="dist-bar" aria-hidden="true">' +
          counts.map(([s, n]) => '<button type="button" tabindex="-1" class="dist-seg st-' + s + (state.statusFilter === s ? " is-active" : "") + '" data-status="' + s + '" style="flex:' + n + '" title="' + n + " " + esc(label(s)) + '"></button>').join("") +
        "</span>" +
        '<span class="dist-legend">' +
          counts.map(([s, n]) => '<button type="button" class="dist-item st-' + s + '" data-status="' + s + '" aria-pressed="' + (state.statusFilter === s) + '" title="Show only ' + esc(label(s)) + ' features"><span class="num">' + n + "</span> " + esc(label(s)) + "</button>").join("") +
        "</span>";
      el.querySelectorAll("[data-status]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const s = btn.getAttribute("data-status");
          state.statusFilter = state.statusFilter === s ? "" : s;
          renderAll();
        });
      });
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
      const check = state.data.check;
      const issues = []
        .concat((check.errors || []).map((e) => ({ level: "error", item: e })))
        .concat((check.warnings || []).map((w) => ({ level: "warning", item: w })));
      const ids = new Set(state.data.features.map((f) => f.id));
      const body = issues.length === 0
        ? '<p class="note">Schema, dependencies, ROADMAP.md sync and Beads checks all passed.</p>'
        : '<ul class="health-list">' + issues.map(({ level, item }) =>
            '<li class="health-item"><div class="health-item-main"><span class="pill ' + (level === "error" ? "pill-err" : "pill-warn") + '">' + esc(item.code || level) + "</span><span>" + esc(item.message) + "</span></div>" +
            (item.entityId && ids.has(item.entityId) ? '<button type="button" class="dep-chip" data-health-jump="' + esc(item.entityId) + '">Inspect ' + esc(item.entityId) + "</button>" : "") +
            "</li>").join("") + "</ul>";
      panel.innerHTML = '<div class="health-head"><h3>Health</h3><button type="button" class="close-btn" id="health-panel-close" aria-label="Close health diagnostics">Close</button></div>' + body;
      document.getElementById("health-panel-close").addEventListener("click", () => {
        state.healthPanelOpen = false;
        renderHealthPanel();
        badge.focus();
      });
      panel.querySelectorAll("[data-health-jump]").forEach((btn) => {
        btn.addEventListener("click", () => openDrawer(btn.getAttribute("data-health-jump")));
      });
    }

    function renderFilters() {
      const data = state.data;
      const disabled = !data;
      document.querySelectorAll(".toolbar select, .toolbar input, .view-tab").forEach((el) => { el.disabled = disabled; });
      if (!data) return;
      const ms = document.getElementById("filter-milestone");
      ms.innerHTML = '<option value="">All milestones</option>' + data.milestones.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.title) + "</option>").join("");
      ms.value = state.milestoneFilter;
      ms.title = ms.selectedOptions[0] ? ms.selectedOptions[0].textContent : "";
      document.getElementById("filter-status").value = state.statusFilter;
      const areas = Array.from(new Set(data.features.map((f) => f.area).filter(Boolean))).sort();
      const as = document.getElementById("filter-area");
      as.innerHTML = '<option value="">All areas</option>' + areas.map((a) => '<option value="' + esc(a) + '">' + esc(a) + "</option>").join("");
      as.value = state.areaFilter;
      const reset = document.getElementById("filter-reset");
      const visible = hasAnyFilter();
      reset.dataset.visible = String(visible);
      reset.setAttribute("aria-hidden", String(!visible));
      reset.tabIndex = visible ? 0 : -1;
      document.querySelectorAll(".view-tab").forEach((tab) => {
        const active = tab.getAttribute("data-view") === state.view;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
    }

    // ---------------------------------------------------------------- roadmap ledger

    function bdChips(f) {
      const refs = f.refs.filter((r) => r.startsWith("bd:"));
      if (refs.length === 0) return '<span class="dim">—</span>';
      const beads = (state.data.beads && Array.isArray(state.data.beads[f.id])) ? state.data.beads[f.id] : [];
      const chip = (r) => {
        const b = beads.find((x) => x.ref === r);
        const st = b && b.available ? (b.found ? String(b.status || "open").replace("_", "-") : "missing") : "open";
        const cls = st === "closed" ? "ref-closed" : st === "in-progress" ? "ref-in-progress" : st === "missing" ? "ref-missing" : "ref-open";
        const text = r.slice(3);
        const tip = r + (b && b.available ? (b.found ? " — " + label(b.status || "open") + (b.title ? ": " + b.title : "") : " — not found") : "");
        return '<span class="chip ' + cls + '" title="' + esc(tip) + '">' + esc(text) + "</span>";
      };
      return refs.slice(0, 2).map(chip).join("") + (refs.length > 2 ? '<span class="chip more" title="' + esc(refs.slice(2).join(", ")) + '">+' + (refs.length - 2) + "</span>" : "");
    }

    /** Columns that fit the current width; columns drop progressively below 1200px. */
    function ledgerColumns(withIssues) {
      const w = window.innerWidth || 1440;
      const cols = ["status", "title"];
      if (w > 720) cols.push("id");
      cols.push("crit");
      if (w > 1040) cols.push("area");
      if (w > 900) cols.push("needs");
      if (w > 900 && withIssues) cols.push("issues");
      if (w > 1200) cols.push("latest");
      return cols;
    }

    function renderLedger(container) {
      const data = state.data;
      if (data.features.length === 0 && !hasAnyFilter()) {
        container.innerHTML = emptyState("features");
        return;
      }
      const filtered = filterFeatures(true);
      const milestones = data.milestones.filter((m) => {
        if (state.milestoneFilter && m.id !== state.milestoneFilter) return false;
        if (hasFeatureFilter() && !filtered.some((f) => f.milestone === m.id)) return false;
        return true;
      });
      if (filtered.length === 0 && (hasFeatureFilter() || milestones.length === 0)) {
        container.innerHTML = emptyState("features");
        wireCommon(container);
        return;
      }
      const withIssues = data.features.some((f) => f.refs.some((r) => r.startsWith("bd:")));
      const columns = ledgerColumns(withIssues);
      state.ledgerColumnsKey = columns.join(",");
      const show = (c) => columns.includes(c);
      const cols = columns.length;
      const head =
        "<thead><tr>" +
          '<th class="c-status status-word-cell">Status</th><th class="c-title">Feature</th>' +
          (show("id") ? '<th class="c-id-cell">ID</th>' : "") +
          '<th class="c-crit">Criteria</th>' +
          (show("area") ? '<th class="c-area-cell">Area</th>' : "") +
          (show("needs") ? '<th class="c-needs-cell">Needs</th>' : "") +
          (show("issues") ? '<th class="c-issues-cell">Issues</th>' : "") +
          (show("latest") ? '<th class="c-latest-cell">Latest update</th>' : "") +
        "</tr></thead>";

      const groups = milestones.map((m) => {
        const all = data.features.filter((f) => f.milestone === m.id);
        const rows = filtered.filter((f) => f.milestone === m.id);
        const shipped = all.filter((f) => f.status === "shipped").length;
        const pct = all.length ? Math.round((shipped / all.length) * 100) : 0;
        const groupRow =
          '<tr class="group" data-milestone-id="' + esc(m.id) + '"><td colspan="' + cols + '"><div class="group-line">' +
            '<h2 title="' + esc(m.title + (m.description ? " — " + m.description : "")) + '">' + esc(m.title) + "</h2>" +
            '<span class="mono">' + esc(m.id) + "</span>" +
            statusMark(m.status) +
            (m.target ? '<span class="mono group-target">' + esc(m.target) + "</span>" : "") +
            '<span class="grow"></span>' +
            '<span class="group-progress"><span class="mono">' + shipped + "/" + all.length + ' shipped</span><span class="track is-shipped" aria-hidden="true"><i style="width:' + pct + '%"></i></span></span>' +
          "</div></td></tr>";
        if (rows.length === 0) {
          return groupRow + '<tr class="empty-row"><td colspan="' + cols + '">' + (all.length === 0 ? "No features yet." : "No features match " + esc(describeFilters()) + ".") + "</td></tr>";
        }
        return groupRow + rows.map((f) => {
          const done = criteriaDone(f);
          const total = f.ship_criteria.length;
          const pctC = total ? Math.round((done / total) * 100) : 0;
          const latest = f.updates.length ? f.updates[f.updates.length - 1] : null;
          const needs = state.showDeps && f.depends_on.length ? f.depends_on.join(", ") : "";
          return '<tr class="row" data-row-id="' + esc(f.id) + '">' +
            '<td class="status-word-cell" title="' + esc(label(f.status)) + '">' + statusMark(f.status) + "</td>" +
            '<td><button type="button" class="row-open" data-feature-id="' + esc(f.id) + '" title="' + esc(f.title) + '" aria-label="Open ' + esc(f.title) + " (" + esc(label(f.status)) + ')">' + esc(f.title) + "</button></td>" +
            (show("id") ? '<td class="c-id-cell mono" title="' + esc(f.id) + '">' + esc(f.id) + "</td>" : "") +
            '<td><span class="crit"><span class="mono" title="' + esc(PP_PRESENT.formatCriteria(done, total)) + '">' + (total ? done + "/" + total : "—") + "</span>" +
              (total ? '<span class="track is-criteria' + (done === total ? " is-done" : "") + '" aria-hidden="true"><i style="width:' + pctC + '%"></i></span>' : "") + "</span></td>" +
            (show("area") ? '<td class="c-area-cell" title="' + esc(f.area || "") + '">' + (f.area ? esc(f.area) : '<span class="dim">—</span>') + "</td>" : "") +
            (show("needs") ? '<td class="c-needs-cell mono" title="' + esc(needs) + '">' + (needs ? esc(needs) : '<span class="dim">—</span>') + "</td>" : "") +
            (show("issues") ? '<td class="c-issues-cell">' + bdChips(f) + "</td>" : "") +
            (show("latest") ? '<td class="c-latest-cell note" title="' + esc(latest ? PP_PRESENT.formatTimestamp(latest.at) + " — " + latest.note : "") + '">' + (latest ? esc(latest.note) : "") + "</td>" : "") +
          "</tr>";
        }).join("");
      }).join("");

      container.innerHTML = '<table class="ledger" aria-label="Roadmap">' + head + "<tbody>" + groups + "</tbody></table>";
      container.querySelectorAll("tr.row").forEach((tr) => {
        tr.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          openDrawer(tr.getAttribute("data-row-id"));
        });
      });
      wireFeatureTriggers(container);
      wireCommon(container);
    }

    function wireFeatureTriggers(container) {
      container.querySelectorAll("[data-feature-id]").forEach((el) => {
        if (el.classList.contains("graph-node")) return;
        el.addEventListener("click", () => openDrawer(el.getAttribute("data-feature-id")));
      });
    }

    // ---------------------------------------------------------------- activity

    const LAST_VISIT_KEY = "pp-last-visit:" + (PP_RUNTIME.projectSwitcher ? PP_RUNTIME.projectSwitcher.currentSlug : (PP_RUNTIME.apiBase || location.pathname));

    function initLastVisit() {
      try {
        const prev = localStorage.getItem(LAST_VISIT_KEY);
        if (prev && !Number.isNaN(Date.parse(prev))) state.activity.lastVisit = prev;
        localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
      } catch {}
    }

    function activitySince() {
      if (state.activity.window === "last") return state.activity.lastVisit || "7d";
      return state.activity.window;
    }

    function windowPhrase() {
      if (isStatic) return "in the 30 days before this snapshot";
      if (state.activity.window === "30d") return "in the last 30 days";
      if (state.activity.window === "last") return state.activity.lastVisit ? "since your last visit (" + PP_PRESENT.formatTimestamp(state.activity.lastVisit) + ")" : "in the last 7 days (first visit)";
      return "in the last 7 days";
    }

    async function loadActivity() {
      if (isStatic) {
        state.activity.result = (state.data && state.data.activity) || { events: [], noGit: false, branch: null };
        state.activity.error = null;
        if (state.view === "activity") renderView();
        return;
      }
      const seq = ++state.activity.seq;
      state.activity.loading = !state.activity.result;
      if (state.view === "activity" && state.activity.loading) renderView();
      try {
        const res = await fetch(apiUrl("/api/activity?since=" + encodeURIComponent(activitySince())));
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || body.ok === false) throw new Error((body && body.error) || "HTTP " + res.status);
        if (seq !== state.activity.seq) return;
        state.activity.result = body;
        state.activity.error = null;
      } catch (err) {
        if (seq !== state.activity.seq) return;
        state.activity.error = (err && err.message) || "Failed to load activity";
        state.activity.result = null;
      }
      state.activity.loading = false;
      if (state.view === "activity") renderView();
    }

    function eventKind(e) {
      switch (e.kind) {
        case "note": return '<span class="event-kind k-note">note</span>';
        case "shipped": return '<span class="event-kind">' + statusMark("shipped") + "</span>";
        case "status-change": return '<span class="event-kind">' + statusMark(e.to || "planned") + "</span>";
        case "criterion-done": return '<span class="event-kind">criterion done</span>';
        case "criterion-reopened": return '<span class="event-kind">criterion reopened</span>';
        case "feature-added": return '<span class="event-kind">added</span>';
        case "feature-removed": return '<span class="event-kind">removed</span>';
        default: return '<span class="event-kind">' + esc(e.kind) + "</span>";
      }
    }

    function eventDetail(e) {
      if ((e.kind === "status-change" || e.kind === "shipped") && e.from) return label(e.from) + " → " + label(e.to);
      return e.detail || "";
    }

    function renderActivity(container) {
      const a = state.activity;
      const windows = isStatic ? "" :
        '<div class="activity-window" role="group" aria-label="Activity window">' +
          [["7d", "7 days"], ["30d", "30 days"], ["last", "Since last visit"]].map(([v, t]) =>
            '<button type="button" data-window="' + v + '" aria-pressed="' + (a.window === v) + '">' + t + "</button>").join("") +
        "</div>";
      const branch = a.result && a.result.branch ? ' on <span class="mono">' + esc(a.result.branch) + "</span>" : "";
      let html = '<div class="activity-head"><p>Changes ' + esc(windowPhrase()) + branch + ", newest first.</p>" + windows + "</div>";

      if (a.error) {
        html += '<div class="state-msg is-error" data-state="activity-error"><h2>Couldn' + "'" + 't load activity.</h2><p>' + esc(a.error) + '</p><button type="button" class="btn-primary" data-action="retry-activity">Retry</button></div>';
      } else if (!a.result) {
        html += '<p class="loading">Loading activity…</p>';
      } else {
        if (a.result.noGit) {
          html += '<p class="notice is-warn" data-state="no-git">Status and criteria changes need git history; showing notes.</p>';
        }
        const q = state.search.trim().toLowerCase();
        const events = (a.result.events || []).filter((e) => {
          if (state.milestoneFilter && e.milestone !== state.milestoneFilter) return false;
          if (state.areaFilter && e.area !== state.areaFilter) return false;
          if (q && !(e.title.toLowerCase().includes(q) || e.featureId.toLowerCase().includes(q) || (e.detail || "").toLowerCase().includes(q))) return false;
          return true;
        });
        if (events.length === 0) {
          const filtered = Boolean(state.milestoneFilter || state.areaFilter || q);
          html += filtered
            ? '<div class="state-msg" data-empty="filtered"><h2>No changes match ' + esc(describeFilters()) + '.</h2><p>Clear the filters to see every change.</p><button type="button" class="btn-ghost" data-action="reset-filters">Reset filters</button></div>'
            : '<div class="state-msg" data-empty="none"><h2>No changes ' + esc(windowPhrase()) + ".</h2><p>Notes, status changes, completed criteria and new features appear here once they are made" + (a.result.noGit ? "." : " and committed.") + "</p></div>";
        } else {
          const groups = [];
          for (const e of events) {
            const key = e.uncommitted ? "uncommitted" : PP_PRESENT.formatDay(e.at);
            let g = groups.find((x) => x.key === key);
            if (!g) {
              g = { key, items: [] };
              groups.push(g);
            }
            g.items.push(e);
          }
          html += groups.map((g) =>
            '<section class="day" data-day="' + esc(g.key) + '"><h3>' + (g.key === "uncommitted" ? 'Uncommitted<span class="mono">not in git yet</span>' : esc(g.key)) + "</h3>" +
              '<ul class="events">' + g.items.map((e) => {
                const d = e.at ? new Date(e.at) : null;
                const time = d ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : "—";
                const detail = eventDetail(e);
                return '<li class="event" data-event-feature="' + esc(e.featureId) + '">' +
                  '<span class="mono" title="' + esc(e.at ? PP_PRESENT.formatTimestamp(e.at) : "uncommitted") + '">' + time + "</span>" +
                  eventKind(e) +
                  '<span class="event-main"><button type="button" class="row-open" data-feature-id="' + esc(e.featureId) + '" title="' + esc(e.title) + '">' + esc(e.title) + "</button>" +
                  (detail ? '<span class="event-detail">' + esc(detail) + "</span>" : "") + "</span>" +
                "</li>";
              }).join("") + "</ul></section>").join("");
        }
      }
      container.innerHTML = html;
      container.querySelectorAll("[data-window]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.activity.window = btn.getAttribute("data-window");
          state.activity.result = null;
          renderView();
          loadActivity();
        });
      });
      container.querySelectorAll('[data-action="retry-activity"]').forEach((btn) => btn.addEventListener("click", () => {
        state.activity.error = null;
        renderView();
        loadActivity();
      }));
      container.querySelectorAll("li.event").forEach((li) => {
        li.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          openDrawer(li.getAttribute("data-event-feature"));
        });
      });
      wireFeatureTriggers(container);
      wireCommon(container);
    }

    // ---------------------------------------------------------------- graph

    function renderGraphView(container, filteredFeatures) {
      const data = state.data;
      if (filteredFeatures.length === 0) {
        activeGraphApi = null;
        container.innerHTML = emptyState("features");
        wireCommon(container);
        return;
      }
      const milestoneOrder = new Map(data.milestones.map((m) => [m.id, m.order]));
      const byId = new Map(filteredFeatures.map((f) => [f.id, f]));
      const visible = new Set(byId.keys());
      const layerOf = new Map();
      function computeLayer(id, visiting) {
        if (layerOf.has(id)) return layerOf.get(id);
        if (visiting.has(id)) return 0;
        visiting.add(id);
        let maxDep = -1;
        for (const dep of (byId.get(id) || {}).depends_on || []) {
          if (visible.has(dep) && dep !== id) maxDep = Math.max(maxDep, computeLayer(dep, visiting));
        }
        visiting.delete(id);
        layerOf.set(id, maxDep + 1);
        return maxDep + 1;
      }
      filteredFeatures.forEach((f) => computeLayer(f.id, new Set()));
      const rows = new Map();
      let maxLayer = 0;
      for (const f of filteredFeatures) {
        const l = layerOf.get(f.id) || 0;
        maxLayer = Math.max(maxLayer, l);
        if (!rows.has(l)) rows.set(l, []);
        rows.get(l).push(f);
      }
      const compareBase = (a, b) => {
        const ma = milestoneOrder.get(a.milestone) ?? 9999;
        const mb = milestoneOrder.get(b.milestone) ?? 9999;
        if (ma !== mb) return ma - mb;
        if (a.order !== b.order) return a.order - b.order;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      };
      const colIndex = new Map();
      for (let l = 0; l <= maxLayer; l++) {
        const list = rows.get(l) || [];
        const avgParent = (f) => {
          let sum = 0;
          let n = 0;
          for (const d of f.depends_on || []) if (colIndex.has(d)) { sum += colIndex.get(d); n++; }
          return n ? sum / n : Number.POSITIVE_INFINITY;
        };
        list.sort(l === 0 ? compareBase : (a, b) => {
          const d = avgParent(a) - avgParent(b);
          return Math.abs(d) > 0.001 && Number.isFinite(d) ? d : compareBase(a, b);
        });
        list.forEach((f, i) => colIndex.set(f.id, i));
      }

      // Nodes are sized to their title (two clamped lines) within a cap.
      const NODE_H = 72;
      const COL_GAP = 24;
      const ROW_GAP = 72;
      const PAD = 32;
      const widthOf = (f) => Math.max(168, Math.min(276, Math.ceil((f.title.length * 7.4) / 2) + 34));
      const sizes = new Map(filteredFeatures.map((f) => [f.id, widthOf(f)]));
      let maxRowW = 0;
      for (let l = 0; l <= maxLayer; l++) {
        const list = rows.get(l) || [];
        const w = list.reduce((a, f) => a + sizes.get(f.id), 0) + Math.max(0, list.length - 1) * COL_GAP;
        maxRowW = Math.max(maxRowW, w);
      }
      const stageW = PAD * 2 + maxRowW;
      const stageH = PAD * 2 + (maxLayer + 1) * NODE_H + maxLayer * ROW_GAP;
      const pos = new Map();
      for (let l = 0; l <= maxLayer; l++) {
        const list = rows.get(l) || [];
        const w = list.reduce((a, f) => a + sizes.get(f.id), 0) + Math.max(0, list.length - 1) * COL_GAP;
        let x = Math.round((stageW - w) / 2);
        for (const f of list) {
          pos.set(f.id, { x, y: PAD + l * (NODE_H + ROW_GAP), w: sizes.get(f.id) });
          x += sizes.get(f.id) + COL_GAP;
        }
      }

      const edges = [];
      const outgoing = new Map();
      const incoming = new Map();
      for (const f of filteredFeatures) {
        for (const dep of f.depends_on || []) {
          if (!visible.has(dep) || dep === f.id) continue;
          const e = { from: dep, to: f.id };
          edges.push(e);
          if (!outgoing.has(dep)) outgoing.set(dep, []);
          outgoing.get(dep).push(e);
          if (!incoming.has(f.id)) incoming.set(f.id, []);
          incoming.get(f.id).push(e);
        }
      }
      // Several edges into (or out of) one node use distinct anchor points, each keeping its arrowhead.
      const spread = (list, keyFn, slotKey) => {
        list.sort((a, b) => keyFn(a) - keyFn(b));
        list.forEach((e, i) => { e[slotKey] = (i + 1) / (list.length + 1); });
      };
      for (const list of incoming.values()) spread(list, (e) => pos.get(e.from).x, "inSlot");
      for (const list of outgoing.values()) spread(list, (e) => pos.get(e.to).x, "outSlot");

      const ancestors = new Map();
      const descendants = new Map();
      const walk = (id, next, seen) => {
        for (const n of next(id)) if (!seen.has(n)) { seen.add(n); walk(n, next, seen); }
        return seen;
      };
      for (const f of filteredFeatures) {
        ancestors.set(f.id, walk(f.id, (id) => ((byId.get(id) || {}).depends_on || []).filter((d) => visible.has(d) && d !== id), new Set()));
        descendants.set(f.id, walk(f.id, (id) => (outgoing.get(id) || []).map((e) => e.to), new Set()));
      }

      const paths = edges.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        const x1 = Math.round(a.x + a.w * (0.2 + 0.6 * e.outSlot));
        const y1 = a.y + NODE_H;
        const x2 = Math.round(b.x + b.w * (0.2 + 0.6 * e.inSlot));
        const y2 = b.y;
        const dy = Math.max(28, Math.abs(y2 - y1) * 0.45);
        return '<path class="graph-edge" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '" d="M ' + x1 + " " + y1 + " C " + x1 + " " + (y1 + dy) + ", " + x2 + " " + (y2 - dy) + ", " + x2 + " " + y2 + '" />';
      }).join("");

      const nodes = filteredFeatures.map((f) => {
        const p = pos.get(f.id);
        const done = criteriaDone(f);
        const total = f.ship_criteria.length;
        return '<button type="button" class="graph-node" data-feature-id="' + esc(f.id) + '" style="left:' + p.x + "px;top:" + p.y + "px;width:" + p.w + "px;height:" + NODE_H + 'px" title="' + esc(f.title) + '">' +
          '<span class="graph-node-title">' + esc(f.title) + "</span>" +
          '<span class="graph-node-meta">' + statusMark(f.status) + '<span class="mono">' + (total ? done + "/" + total : "—") + "</span></span>" +
        "</button>";
      }).join("");

      container.innerHTML =
        '<div class="graph-shell">' +
          '<div class="graph-bar">' +
            '<div class="graph-legend">' +
              '<span id="graph-hint">Hover to trace · click to pin · click the pinned node to open · Esc releases</span>' +
              '<span class="legend-item"><span class="legend-swatch" style="background:var(--trace-up)"></span> Needs</span>' +
              '<span class="legend-item"><span class="legend-swatch" style="background:var(--trace-down)"></span> Unblocks</span>' +
            "</div>" +
            '<div class="graph-controls" role="toolbar" aria-label="Graph zoom">' +
              '<button type="button" class="graph-ctrl-btn" id="graph-zoom-out" aria-label="Zoom out" title="Zoom out (-)">−</button>' +
              '<button type="button" class="graph-ctrl-btn" id="graph-zoom-reset" aria-label="Reset zoom to 100%" title="Actual size (0)">100%</button>' +
              '<button type="button" class="graph-ctrl-btn" id="graph-zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>' +
              '<button type="button" class="graph-ctrl-btn" id="graph-zoom-fit" aria-label="Fit graph to view" title="Fit (F)">Fit</button>' +
            "</div>" +
          "</div>" +
          '<div class="graph-viewport" id="graph-viewport">' +
            '<div class="graph-canvas" id="graph-canvas"><div class="graph-stage" style="width:' + stageW + "px;height:" + stageH + 'px">' +
              '<svg class="graph-edges" width="' + stageW + '" height="' + stageH + '" viewBox="0 0 ' + stageW + " " + stageH + '"><defs>' +
                '<marker id="pp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" style="color:var(--muted)" /></marker>' +
                '<marker id="pp-arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" style="color:var(--trace-up)" /></marker>' +
                '<marker id="pp-arrow-down" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" style="color:var(--trace-down)" /></marker>' +
              "</defs>" + paths + "</svg>" + nodes +
            "</div></div>" +
          "</div>" +
        "</div>";

      const viewportEl = document.getElementById("graph-viewport");
      const canvasEl = document.getElementById("graph-canvas");
      const zoomResetBtn = document.getElementById("graph-zoom-reset");
      const MIN_ZOOM = 0.25;
      const MAX_ZOOM = 2;
      const cam = state.graphCamera;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const vpSize = () => ({ vw: Math.max(240, viewportEl.clientWidth || 760), vh: Math.max(200, viewportEl.clientHeight || 420) });
      function clampCamera() {
        const { vw, vh } = vpSize();
        const sw = stageW * cam.scale;
        const sh = stageH * cam.scale;
        const px = Math.min(80, Math.floor(vw * 0.35), Math.floor(sw * 0.5));
        const py = Math.min(80, Math.floor(vh * 0.35), Math.floor(sh * 0.5));
        cam.tx = clamp(cam.tx, px - sw, vw - px);
        cam.ty = clamp(cam.ty, py - sh, vh - py);
      }
      function applyCamera() {
        canvasEl.style.transform = "translate(" + Math.round(cam.tx) + "px, " + Math.round(cam.ty) + "px) scale(" + cam.scale + ")";
        canvasEl.dataset.scale = cam.scale.toFixed(3);
        zoomResetBtn.textContent = Math.round(cam.scale * 100) + "%";
        const step = Math.max(10, Math.round(24 * cam.scale));
        viewportEl.style.backgroundSize = step + "px " + step + "px";
        viewportEl.style.backgroundPosition = Math.round(cam.tx) + "px " + Math.round(cam.ty) + "px";
      }
      function resetView() {
        const { vw, vh } = vpSize();
        cam.scale = 1;
        cam.tx = Math.round((vw - stageW) / 2);
        cam.ty = stageH <= vh - 32 ? Math.round((vh - stageH) / 2) : 16;
        clampCamera();
        applyCamera();
      }
      function fitView() {
        const { vw, vh } = vpSize();
        cam.scale = Math.min(1, (vw - 24) / Math.max(1, stageW), (vh - 24) / Math.max(1, stageH));
        cam.tx = Math.round((vw - stageW * cam.scale) / 2);
        cam.ty = Math.round((vh - stageH * cam.scale) / 2);
        applyCamera();
      }
      function zoomAt(next, cx, cy) {
        const s = clamp(next, Math.min(MIN_ZOOM, cam.scale), MAX_ZOOM);
        if (Math.abs(s - cam.scale) < 0.0001) return;
        const wx = (cx - cam.tx) / cam.scale;
        const wy = (cy - cam.ty) / cam.scale;
        cam.scale = s;
        cam.tx = cx - wx * s;
        cam.ty = cy - wy * s;
        clampCamera();
        applyCamera();
      }
      const zoomCenter = (factor) => {
        const { vw, vh } = vpSize();
        zoomAt(cam.scale * factor, vw / 2, vh / 2);
      };

      // Fit on open and after every filter change (the visible set changes the layout key).
      const layoutKey = filteredFeatures.map((f) => f.id).join(",") + "|" + stageW + "x" + stageH;
      if (!cam.initialized || cam.layoutKey !== layoutKey) {
        cam.initialized = true;
        cam.layoutKey = layoutKey;
        fitView();
      } else {
        applyCamera();
      }

      let drag = null;
      let suppressClick = false;
      viewportEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        suppressClick = false;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty, moving: false };
      });
      viewportEl.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moving) {
          if (Math.hypot(dx, dy) <= 5) return;
          drag.moving = true;
          viewportEl.classList.add("is-dragging");
          try { viewportEl.setPointerCapture(e.pointerId); } catch {}
        }
        cam.tx = drag.tx + dx;
        cam.ty = drag.ty + dy;
        clampCamera();
        applyCamera();
      });
      const endDrag = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (drag.moving) {
          suppressClick = true;
          viewportEl.classList.remove("is-dragging");
          try { if (viewportEl.hasPointerCapture(e.pointerId)) viewportEl.releasePointerCapture(e.pointerId); } catch {}
        }
        drag = null;
      };
      viewportEl.addEventListener("pointerup", endDrag);
      viewportEl.addEventListener("pointercancel", endDrag);
      viewportEl.addEventListener("click", (e) => {
        if (suppressClick) {
          suppressClick = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (!e.target.closest(".graph-node") && state.graphPinned) {
          state.graphPinned = null;
          applyHighlight(null);
        }
      }, true);
      viewportEl.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = viewportEl.getBoundingClientRect();
        const step = e.ctrlKey ? -e.deltaY * 0.01 : -e.deltaY * 0.0014;
        zoomAt(cam.scale * Math.exp(Math.max(-0.35, Math.min(0.35, step))), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      document.getElementById("graph-zoom-in").addEventListener("click", () => zoomCenter(1.2));
      document.getElementById("graph-zoom-out").addEventListener("click", () => zoomCenter(1 / 1.2));
      zoomResetBtn.addEventListener("click", resetView);
      document.getElementById("graph-zoom-fit").addEventListener("click", fitView);

      const nodeEls = Array.from(container.querySelectorAll(".graph-node"));
      const edgeEls = Array.from(container.querySelectorAll(".graph-edge"));
      function applyHighlight(focusId) {
        const id = focusId || state.graphPinned;
        for (const el of nodeEls) el.classList.toggle("is-pinned", el.getAttribute("data-feature-id") === state.graphPinned);
        if (!id || !byId.has(id)) {
          for (const el of nodeEls) el.classList.remove("is-active", "is-upstream", "is-downstream", "is-dimmed");
          for (const el of edgeEls) el.classList.remove("is-upstream", "is-downstream", "is-dimmed");
          return;
        }
        const anc = ancestors.get(id);
        const desc = descendants.get(id);
        for (const el of nodeEls) {
          const nid = el.getAttribute("data-feature-id");
          el.classList.remove("is-active", "is-upstream", "is-downstream", "is-dimmed");
          el.classList.add(nid === id ? "is-active" : anc.has(nid) ? "is-upstream" : desc.has(nid) ? "is-downstream" : "is-dimmed");
        }
        for (const el of edgeEls) {
          const from = el.getAttribute("data-from");
          const to = el.getAttribute("data-to");
          el.classList.remove("is-upstream", "is-downstream", "is-dimmed");
          if ((to === id || anc.has(to)) && anc.has(from)) el.classList.add("is-upstream");
          else if ((from === id || desc.has(from)) && desc.has(to)) el.classList.add("is-downstream");
          else el.classList.add("is-dimmed");
        }
      }
      for (const el of nodeEls) {
        const nid = el.getAttribute("data-feature-id");
        el.addEventListener("mouseenter", () => { if (!state.graphPinned) applyHighlight(nid); });
        el.addEventListener("mouseleave", () => { if (!state.graphPinned) applyHighlight(null); });
        el.addEventListener("focus", () => { if (!state.graphPinned) applyHighlight(nid); });
        el.addEventListener("blur", () => { if (!state.graphPinned) applyHighlight(null); });
        el.addEventListener("click", () => {
          if (state.graphPinned === nid) {
            openDrawer(nid);
          } else {
            state.graphPinned = nid;
            applyHighlight(null);
          }
        });
      }
      if (state.graphPinned && !byId.has(state.graphPinned)) state.graphPinned = null;
      applyHighlight(null);

      activeGraphApi = {
        zoomIn: () => zoomCenter(1.2),
        zoomOut: () => zoomCenter(1 / 1.2),
        reset: resetView,
        fit: fitView,
        release: () => {
          if (!state.graphPinned) return false;
          state.graphPinned = null;
          applyHighlight(null);
          return true;
        },
        onResize: () => { clampCamera(); applyCamera(); },
      };
    }

    // ---------------------------------------------------------------- main render

    function renderLoadError(container) {
      container.innerHTML =
        '<div class="state-msg is-error" data-state="load-error" role="alert">' +
          "<h2>Couldn" + "'" + "t load the roadmap.</h2>" +
          "<p>" + esc(state.loadError) + "</p>" +
          '<p class="mono">GET ' + esc(apiUrl("/api/roadmap")) + "</p>" +
          '<button type="button" class="btn-primary" id="retry-load">Retry</button>' +
        "</div>";
      document.getElementById("retry-load").addEventListener("click", async (e) => {
        e.target.disabled = true;
        e.target.textContent = "Retrying…";
        await fetchRoadmap();
      });
    }

    function renderView() {
      const container = document.getElementById("view");
      document.body.classList.toggle("view-mode-graph", state.view === "graph" && Boolean(state.data));
      if (!state.data) {
        activeGraphApi = null;
        if (state.loadError) renderLoadError(container);
        return;
      }
      if (state.view === "graph") {
        renderGraphView(container, filterFeatures(true));
      } else if (state.view === "activity") {
        activeGraphApi = null;
        renderActivity(container);
      } else {
        activeGraphApi = null;
        renderLedger(container);
      }
    }

    function renderLoadStatus() {
      const el = document.getElementById("load-status");
      // A failed refresh keeps the last good data on screen and says so; a failed first load
      // is shown as the main error state instead.
      if (state.loadError && state.data) {
        el.innerHTML = "Couldn" + "'" + "t refresh the roadmap: " + esc(state.loadError) + ' <button type="button" class="linkish" id="load-status-retry">Retry</button>';
        el.hidden = false;
        document.getElementById("load-status-retry").addEventListener("click", () => fetchRoadmap());
      } else {
        el.innerHTML = "";
        el.hidden = true;
      }
    }

    function renderAll() {
      renderLoadStatus();
      renderHeader();
      renderFilters();
      renderView();
      renderDrawer();
    }

    // ---------------------------------------------------------------- drawer

    function openDrawer(featureId) {
      if (!featureId || !state.data || !state.data.features.some((f) => f.id === featureId)) return;
      if (!state.selectedFeatureId) {
        state.drawerReturnFocusEl = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        state.returnFeatureId = featureId;
      }
      state.selectedFeatureId = featureId;
      state.pendingShip = null;
      state.diagnosticsOpen = false;
      renderDrawer({ focusClose: true, scrollTop: true });
    }

    function closeDrawer() {
      const returnEl = state.drawerReturnFocusEl;
      const returnId = state.returnFeatureId;
      state.selectedFeatureId = null;
      state.drawerReturnFocusEl = null;
      state.pendingShip = null;
      renderDrawer();
      if (returnEl && returnEl.isConnected) {
        returnEl.focus();
      } else if (returnId) {
        const t = document.querySelector('[data-feature-id="' + CSS.escape(returnId) + '"]');
        if (t) t.focus();
      }
    }

    function setBackgroundInert(on) {
      page.inert = on;
      if (on) page.setAttribute("aria-hidden", "true");
      else page.removeAttribute("aria-hidden");
      document.body.classList.toggle("drawer-open", on);
    }

    function ctlFor(fid) {
      if (!state.ctl[fid]) state.ctl[fid] = Object.create(null);
      return state.ctl[fid];
    }

    function feedbackHtml(fid, key) {
      const fb = state.ctl[fid] && state.ctl[fid][key];
      if (!fb) return "";
      if (fb.kind === "err") {
        return '<div class="ctl-feedback is-err" role="alert" data-feedback="' + esc(key) + '"><span>' + esc(fb.message) + '</span><button type="button" class="dismiss" data-dismiss="' + esc(key) + '">Dismiss</button></div>';
      }
      return '<div class="ctl-feedback ' + (fb.kind === "ok" ? "is-ok" : "is-saving") + '" role="status" data-feedback="' + esc(key) + '">' + esc(fb.message) + "</div>";
    }

    function setFeedback(fid, key, fb) {
      const ctl = ctlFor(fid);
      if (ctl[key] && ctl[key].timer) clearTimeout(ctl[key].timer);
      if (!fb) {
        delete ctl[key];
      } else {
        ctl[key] = fb;
        // Drawer renders in the next 1.5s (the live reload this write triggers included) keep this
        // acknowledgment on screen: nearest edge, no jump.
        state.revealFeedback = { fid, key, until: Date.now() + 1500 };
        if (fb.kind === "ok") {
          fb.timer = setTimeout(() => {
            if (ctl[key] === fb) {
              delete ctl[key];
              if (state.drawerFeatureId === fid) renderDrawer();
            }
          }, 1500);
        }
      }
      if (state.drawerFeatureId === fid) renderDrawer();
    }

    async function sendPulse(fid, body, key, okMessage, onSuccess) {
      if (isStatic) return false;
      setFeedback(fid, key, { kind: "saving", message: "Saving…" });
      let res;
      let payload = null;
      try {
        res = await fetch(apiUrl("/api/features/" + encodeURIComponent(fid) + "/pulse"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        payload = await res.json().catch(() => null);
      } catch (err) {
        setFeedback(fid, key, { kind: "err", message: "Couldn" + "'" + "t save: " + ((err && err.message) || "network error") + "." });
        return false;
      }
      if (!res.ok || !payload || payload.ok === false) {
        const msg = (payload && payload.error) || "HTTP " + res.status;
        const frozen = payload && payload.code === "ROADMAP_FROZEN";
        setFeedback(fid, key, { kind: "err", message: frozen ? "Couldn" + "'" + "t save: the roadmap has errors to fix first." : "Couldn" + "'" + "t save: " + msg });
        if (frozen) await fetchRoadmap();
        return false;
      }
      if (typeof onSuccess === "function") onSuccess();
      setFeedback(fid, key, { kind: "ok", message: okMessage || "Saved" });
      await fetchRoadmap();
      return true;
    }

    function trapFocus(e) {
      if (e.key !== "Tab" || !state.selectedFeatureId) return;
      const drawer = document.getElementById("drawer");
      const items = Array.from(drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        drawer.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !drawer.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !drawer.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    function renderDrawer(opts) {
      const backdrop = document.getElementById("drawer-backdrop");
      const drawer = document.getElementById("drawer");
      const clear = () => {
        backdrop.classList.remove("open");
        backdrop.setAttribute("aria-hidden", "true");
        drawer.innerHTML = "";
        state.drawerFeatureId = null;
        state.selectedFeatureId = null;
        state.pendingShip = null;
        setBackgroundInert(false);
      };
      if (!state.selectedFeatureId || !state.data) return clear();
      const feature = state.data.features.find((f) => f.id === state.selectedFeatureId);
      if (!feature) return clear();

      const prevInput = document.getElementById("drawer-note-input");
      let restoreInput = false;
      let selStart = null;
      let selEnd = null;
      if (prevInput && state.drawerFeatureId) {
        state.noteDrafts[state.drawerFeatureId] = prevInput.value;
        if (document.activeElement === prevInput) {
          restoreInput = true;
          selStart = prevInput.selectionStart;
          selEnd = prevInput.selectionEnd;
        }
      }
      const prevFocusKey = document.activeElement && drawer.contains(document.activeElement) ? document.activeElement.getAttribute("data-focus-key") : null;
      const prevScroll = opts && opts.scrollTop ? 0 : drawer.scrollTop;
      const switched = state.drawerFeatureId !== feature.id;

      backdrop.classList.add("open");
      backdrop.setAttribute("aria-hidden", "false");
      setBackgroundInert(true);
      state.drawerFeatureId = feature.id;

      const editable = isEditable();
      const dis = editable ? "" : " disabled";
      const data = state.data;
      const milestone = data.milestones.find((m) => m.id === feature.milestone);
      const beads = data.beads && Array.isArray(data.beads[feature.id]) ? data.beads[feature.id] : [];
      const dependents = data.features.filter((f) => f.depends_on.includes(feature.id));
      const openCriteria = feature.ship_criteria.filter((c) => !c.done);
      const blocking = blockingIssues();

      let notices = "";
      if (isStatic) {
        notices += '<div class="readonly" data-state="read-only"><strong>Read-only snapshot.</strong> This page was exported with pp export; edit the roadmap with pp or the live dashboard.</div>';
      } else if (!editable) {
        notices +=
          '<div class="freeze" data-state="frozen" role="alert"><div><strong>Editing paused — ' + esc(PP_PRESENT.plural(blocking.length, "error")) + ".</strong> The roadmap has errors that block every save. Fix them, then recheck.</div>" +
          '<div class="confirm-actions"><button type="button" class="linkish" id="drawer-show-diagnostics" data-focus-key="diag">' + (state.diagnosticsOpen ? "Hide diagnostics" : "Show diagnostics") + '</button><button type="button" class="btn-ghost" id="drawer-recheck" data-focus-key="recheck">Recheck</button></div>' +
          (state.diagnosticsOpen
            ? '<ul class="diagnostics" id="drawer-diagnostics" tabindex="-1" aria-label="Errors to fix">' + blocking.map((i) => "<li><span class=" + '"mono"' + ">[" + esc(i.code) + "]</span> " + esc(i.message) + "</li>").join("") + "</ul>"
            : "") +
          feedbackHtml(feature.id, "recheck") +
        "</div>";
      } else if (data.check.stale) {
        notices += '<div class="stale" data-state="stale">ROADMAP.md is out of sync — run <code>pp render</code> (or save any change here).</div>';
      }

      const statusPills = STATUSES.map((s) =>
        '<button type="button" class="status-pill st-' + s + '" data-status-pill="' + s + '" data-focus-key="status-' + s + '" aria-pressed="' + (feature.status === s) + '"' + dis + ">" +
          '<i class="dot" aria-hidden="true"></i><span>' + esc(label(s)) + "</span></button>").join("");
      const shipConfirm = state.pendingShip === feature.id && openCriteria.length > 0
        ? '<div class="confirm" data-state="ship-confirm" role="group" aria-label="Ship with open criteria">' +
            "<div><strong>" + esc(PP_PRESENT.plural(openCriteria.length, "criterion", "criteria")) + " still open.</strong> Shipped usually means every criterion is done.</div>" +
            '<div class="confirm-actions">' +
              '<button type="button" class="btn-primary" id="ship-also" data-focus-key="ship-also">Also mark ' + openCriteria.length + " " + (openCriteria.length === 1 ? "criterion" : "criteria") + " done</button>" +
              '<button type="button" class="btn-ghost" id="ship-anyway" data-focus-key="ship-anyway">Ship anyway</button>' +
              '<button type="button" class="btn-ghost" id="ship-cancel" data-focus-key="ship-cancel">Cancel</button>' +
            "</div></div>"
        : "";

      const refsHtml = feature.refs.length
        ? '<div><div class="section-label">External refs</div><div class="link-list">' + feature.refs.map((r) => {
            const b = beads.find((x) => x.ref === r);
            const st = b && b.available ? (b.found ? String(b.status || "open").replace("_", "-") : "missing") : "";
            const cls = st === "closed" ? "ref-closed" : st === "in-progress" ? "ref-in-progress" : st === "missing" ? "ref-missing" : "ref-open";
            const info = b && b.available ? (b.found ? " — " + label(b.status || "open") + (b.title ? ": " + b.title : "") : " — not found") : "";
            return '<span class="chip ' + cls + '" title="' + esc(r + info) + '">' + esc(r + info) + "</span>";
          }).join("") + "</div></div>"
        : "";

      const linkList = (ids, emptyText) => ids.length
        ? '<div class="link-list">' + ids.map((id) => {
            const f = data.features.find((x) => x.id === id);
            return '<button type="button" class="dep-chip" data-jump="' + esc(id) + '" data-focus-key="jump-' + esc(id) + '" title="' + esc(f ? f.title + " (" + label(f.status) + ")" : id + " (missing)") + '">' + esc(id) + "</button>";
          }).join("") + "</div>"
        : '<p class="empty-msg">' + emptyText + "</p>";

      drawer.innerHTML =
        '<div class="drawer-head">' +
          '<div style="min-width:0"><h2 id="drawer-title">' + esc(feature.title) + "</h2>" +
            '<div class="drawer-meta">' + statusMark(feature.status) + '<span class="mono">' + esc(feature.id) + '</span><span class="mono" title="' + esc(milestone ? milestone.title : feature.milestone) + '">' + esc(feature.milestone) + "</span>" +
            (feature.area ? '<span class="mono">' + esc(feature.area) + "</span>" : "") + "</div></div>" +
          '<button type="button" class="close-btn" id="drawer-close" data-focus-key="close" aria-label="Close feature details">Close</button>' +
        "</div>" +
        '<div class="drawer-body">' +
          notices +
          '<div id="drawer-status-block"><div class="section-label" id="status-label">Status</div><div class="status-pills" role="group" aria-labelledby="status-label">' + statusPills + "</div>" + shipConfirm + feedbackHtml(feature.id, "status") + "</div>" +
          (feature.description ? '<div><div class="section-label">Overview</div><p>' + esc(feature.description) + "</p></div>" : "") +
          (milestone && milestone.description ? '<div><div class="section-label">Milestone · ' + esc(milestone.title) + '</div><p class="note">' + esc(milestone.description) + "</p></div>" : "") +
          '<div><div class="section-label">Depends on</div>' + linkList(feature.depends_on, "Nothing — this can start any time.") + "</div>" +
          '<div><div class="section-label">Unblocks</div>' + linkList(dependents.map((f) => f.id), "Nothing depends on this yet.") + "</div>" +
          refsHtml +
          '<div><div class="section-label">Ship criteria · ' + esc(PP_PRESENT.formatCriteria(criteriaDone(feature), feature.ship_criteria.length)) + "</div>" +
            (feature.ship_criteria.length === 0
              ? '<p class="empty-msg">No ship criteria defined.</p>'
              : '<ul class="criteria-list">' + feature.ship_criteria.map((c) => {
                  const key = "crit:" + c.id;
                  const fb = state.ctl[feature.id] && state.ctl[feature.id][key];
                  return '<li data-criterion-row="' + esc(c.id) + '"><label class="criteria-item' + (editable ? "" : " is-readonly") + (fb && fb.kind === "ok" ? " is-saved-flash" : "") + '">' +
                    '<input type="checkbox" data-criterion-id="' + esc(c.id) + '" data-focus-key="' + esc(key) + '"' + (c.done ? " checked" : "") + dis + " />" +
                    '<span class="criteria-body"><span class="criteria-text">' + esc(c.text) + '</span><span class="mono">' + esc(c.id) + "</span></span></label>" +
                    feedbackHtml(feature.id, key) + "</li>";
                }).join("") + "</ul>") +
          "</div>" +
          (isStatic ? "" :
            '<div><label class="section-label" for="drawer-note-input">Add a note</label>' +
              '<form class="note-form" id="drawer-note-form"><input id="drawer-note-input" data-focus-key="note-input" placeholder="What changed?" required' + dis + ' /><button class="btn-primary" id="drawer-note-submit" data-focus-key="note-submit" type="submit"' + dis + ">Log</button></form>" +
              feedbackHtml(feature.id, "note") +
            "</div>") +
          '<div><div class="section-label">Updates</div>' +
            (feature.updates.length === 0
              ? '<p class="empty-msg">No updates logged yet.</p>'
              : '<ul class="updates-list">' + feature.updates.slice().reverse().map((u) =>
                  '<li class="update-entry"><span class="update-at" title="' + esc(u.at) + '">' + esc(PP_PRESENT.formatTimestamp(u.at)) + "</span><span>" + esc(u.note) + "</span></li>").join("") + "</ul>") +
          "</div>" +
        "</div>";

      drawer.scrollTop = switched ? 0 : prevScroll;
      if (state.revealFeedback && Date.now() > state.revealFeedback.until) state.revealFeedback = null;
      if (state.revealFeedback && state.revealFeedback.fid === feature.id) {
        const fbEl = drawer.querySelector('[data-feedback="' + CSS.escape(state.revealFeedback.key) + '"]');
        if (fbEl) {
          const d = drawer.getBoundingClientRect();
          const r = fbEl.getBoundingClientRect();
          if (r.bottom > d.bottom) drawer.scrollTop += r.bottom - d.bottom + 8;
          else if (r.top < d.top + 72) drawer.scrollTop -= d.top + 72 - r.top;
        }
      }

      const noteInput = document.getElementById("drawer-note-input");
      if (noteInput) {
        noteInput.value = state.noteDrafts[feature.id] || "";
        noteInput.addEventListener("input", () => { state.noteDrafts[feature.id] = noteInput.value; });
      }
      if (restoreInput && noteInput && !noteInput.disabled) {
        noteInput.focus();
        if (selStart !== null && typeof noteInput.setSelectionRange === "function") noteInput.setSelectionRange(selStart, selEnd);
      } else if (opts && opts.focusClose) {
        document.getElementById("drawer-close").focus();
      } else if (opts && opts.focusKey) {
        const el = drawer.querySelector('[data-focus-key="' + CSS.escape(opts.focusKey) + '"]');
        if (el) el.focus();
      } else if (prevFocusKey) {
        const el = drawer.querySelector('[data-focus-key="' + CSS.escape(prevFocusKey) + '"]');
        if (el && !el.disabled) el.focus();
        else document.getElementById("drawer-close").focus();
      } else if (!drawer.contains(document.activeElement)) {
        document.getElementById("drawer-close").focus();
      }

      document.getElementById("drawer-close").addEventListener("click", closeDrawer);
      drawer.querySelectorAll("[data-dismiss]").forEach((btn) => btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-dismiss");
        setFeedback(feature.id, key, null);
      }));
      drawer.querySelectorAll("[data-jump]").forEach((btn) => btn.addEventListener("click", () => openDrawer(btn.getAttribute("data-jump"))));

      const diagBtn = document.getElementById("drawer-show-diagnostics");
      if (diagBtn) diagBtn.addEventListener("click", () => {
        state.diagnosticsOpen = !state.diagnosticsOpen;
        renderDrawer({ focusKey: "diag" });
        const list = document.getElementById("drawer-diagnostics");
        if (list) list.focus();
      });
      const recheck = document.getElementById("drawer-recheck");
      if (recheck) recheck.addEventListener("click", async () => {
        recheck.disabled = true;
        const ok = await fetchRoadmap();
        if (ok && isEditable()) {
          setFeedback(feature.id, "status", { kind: "ok", message: "The roadmap is valid again — editing is back on." });
          const first = document.querySelector('[data-status-pill="' + feature.status + '"]');
          if (first) first.focus();
        } else {
          setFeedback(feature.id, "recheck", { kind: "err", message: ok ? "Still " + PP_PRESENT.plural(blockingIssues().length, "error") + " to fix." : "Couldn" + "'" + "t reach the server." });
        }
      });

      if (editable) {
        drawer.querySelectorAll("[data-status-pill]").forEach((btn) => btn.addEventListener("click", () => {
          const s = btn.getAttribute("data-status-pill");
          if (s === feature.status) return;
          if (s === "shipped" && openCriteria.length > 0) {
            state.pendingShip = feature.id;
            renderDrawer({ focusKey: "ship-also" });
            return;
          }
          state.pendingShip = null;
          sendPulse(feature.id, { status: s }, "status", "Saved — " + label(s));
        }));
        const also = document.getElementById("ship-also");
        if (also) {
          also.addEventListener("click", () => {
            state.pendingShip = null;
            sendPulse(feature.id, { status: "shipped", check_criteria: openCriteria.map((c) => c.id) }, "status", "Saved — shipped with every criterion done");
          });
          document.getElementById("ship-anyway").addEventListener("click", () => {
            state.pendingShip = null;
            sendPulse(feature.id, { status: "shipped" }, "status", "Saved — shipped with open criteria");
          });
          document.getElementById("ship-cancel").addEventListener("click", () => {
            state.pendingShip = null;
            renderDrawer({ focusKey: "status-shipped" });
          });
        }
        drawer.querySelectorAll("input[data-criterion-id]").forEach((cb) => cb.addEventListener("change", () => {
          const cid = cb.getAttribute("data-criterion-id");
          sendPulse(feature.id, { toggleCriterionId: cid, done: cb.checked }, "crit:" + cid, cb.checked ? "Saved — done" : "Saved — reopened");
        }));
        const form = document.getElementById("drawer-note-form");
        if (form && noteInput) form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const note = noteInput.value.trim();
          if (!note) return;
          const submitted = noteInput.value;
          await sendPulse(feature.id, { note }, "note", "Logged", () => {
            if (state.noteDrafts[feature.id] !== undefined && state.noteDrafts[feature.id] !== submitted) return;
            delete state.noteDrafts[feature.id];
            // Clear the live input only when it still shows this feature's submitted text.
            const current = document.getElementById("drawer-note-input");
            if (current && state.drawerFeatureId === feature.id && current.value === submitted) current.value = "";
          });
        });
      }
    }

    // ---------------------------------------------------------------- wiring

    document.querySelectorAll(".view-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const next = tab.getAttribute("data-view");
        if (!next || next === state.view) return;
        state.view = next;
        renderAll();
        if (next === "activity") loadActivity();
      });
    });
    document.getElementById("health-badge").addEventListener("click", () => {
      state.healthPanelOpen = !state.healthPanelOpen;
      renderHealthPanel();
    });
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const next = getEffectiveTheme() === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("pp-theme", next); } catch {}
      syncThemeButton();
    });
    document.getElementById("filter-milestone").addEventListener("change", (e) => { state.milestoneFilter = e.target.value; renderAll(); });
    document.getElementById("filter-status").addEventListener("change", (e) => { state.statusFilter = e.target.value; renderAll(); });
    document.getElementById("filter-area").addEventListener("change", (e) => { state.areaFilter = e.target.value; renderAll(); });
    document.getElementById("filter-search").addEventListener("input", (e) => { state.search = e.target.value; renderAll(); });
    document.getElementById("toggle-deps").addEventListener("change", (e) => { state.showDeps = e.target.checked; renderAll(); });
    document.getElementById("filter-reset").addEventListener("click", resetFilters);

    const backdropEl = document.getElementById("drawer-backdrop");
    let pressOnBackdrop = false;
    backdropEl.addEventListener("pointerdown", (e) => { pressOnBackdrop = e.target === backdropEl; });
    backdropEl.addEventListener("click", (e) => {
      const genuine = pressOnBackdrop && e.target === backdropEl;
      pressOnBackdrop = false;
      if (genuine) closeDrawer();
    });

    document.addEventListener("keydown", (e) => {
      if (state.selectedFeatureId) {
        trapFocus(e);
        if (e.key === "Escape") {
          if (state.pendingShip) {
            state.pendingShip = null;
            renderDrawer({ focusKey: "status-shipped" });
          } else {
            closeDrawer();
          }
        }
        return;
      }
      if (e.key === "Escape") {
        if (activeGraphApi && activeGraphApi.release()) return;
        if (state.healthPanelOpen) {
          state.healthPanelOpen = false;
          renderHealthPanel();
          document.getElementById("health-badge").focus();
        }
        return;
      }
      if (state.view === "graph" && activeGraphApi) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (e.key === "+" || e.key === "=") { e.preventDefault(); activeGraphApi.zoomIn(); }
        else if (e.key === "-") { e.preventDefault(); activeGraphApi.zoomOut(); }
        else if (e.key === "0") { e.preventDefault(); activeGraphApi.reset(); }
        else if (e.key === "f" || e.key === "F") { e.preventDefault(); activeGraphApi.fit(); }
      }
    });
    window.addEventListener("resize", () => {
      if (activeGraphApi) activeGraphApi.onResize();
      if (state.view === "roadmap" && state.data && state.ledgerColumnsKey !== undefined) {
        const withIssues = state.data.features.some((f) => f.refs.some((r) => r.startsWith("bd:")));
        if (ledgerColumns(withIssues).join(",") !== state.ledgerColumnsKey) renderView();
      }
    });

    syncThemeButton();
    loadProjectSwitcher();
    initLastVisit();

    if (!isStatic) {
      const liveBadge = document.getElementById("live-badge");
      const setLive = (cls, html) => { liveBadge.className = "pill pill-btn " + cls; liveBadge.innerHTML = html; };
      liveBadge.addEventListener("click", async () => {
        const ok = await fetchRoadmap();
        setLive(ok ? "pill-live" : "pill-err", ok ? '<span class="dot"></span> Refreshed' : "Refresh failed");
        setTimeout(() => setLive("pill-live", '<span class="dot"></span> Live'), 3000);
      });
      const events = new EventSource(apiUrl("/api/events"));
      events.addEventListener("reload", () => { fetchRoadmap().catch(console.error); });
      events.addEventListener("error", () => setLive("pill-warn", "Reconnecting…"));
      events.addEventListener("open", () => {
        setLive("pill-live", '<span class="dot"></span> Live');
        fetchRoadmap().catch(console.error);
      });
    }

    renderFilters();
    fetchRoadmap().catch((err) => {
      state.loadError = (err && err.message) || "Failed to load the roadmap";
      renderAll();
    });
`;
