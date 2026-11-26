/**
 * Client-side script for the project dashboard. Runs in the browser after PP_RUNTIME is declared.
 */
export const DASHBOARD_CLIENT_SCRIPT = `
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
      noteDrafts: Object.create(null),
      feedback: Object.create(null),
      saving: false,
      drawerFeatureId: null,
      drawerReturnFocusEl: null,
      readSeq: 0,
      loadError: null,
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
      if (!state.selectedFeatureId) {
        // New drawer session: remember the trigger so Close/Escape can restore focus,
        // including when the drawer was opened from the health panel's Inspect chip.
        // Jumps between features inside an open drawer keep the original trigger.
        state.drawerReturnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      state.lastFocusedCardId = state.lastFocusedCardId || featureId;
      state.selectedFeatureId = featureId;
      renderDrawer({ focusClose: focusDrawer });
    }

    function closeDrawer() {
      const returnId = state.lastFocusedCardId || state.selectedFeatureId;
      const returnEl = state.drawerReturnFocusEl;
      state.selectedFeatureId = null;
      state.drawerReturnFocusEl = null;
      renderDrawer();
      if (returnEl && returnEl.isConnected && typeof returnEl.focus === "function") {
        returnEl.focus();
      } else if (returnId) {
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
      if (seq !== state.readSeq) return;
      if (failure) {
        state.loadError = (failure && failure.message) || "Failed to load roadmap";
        renderLoadStatus();
        console.error(failure);
        return;
      }
      state.data = payload;
      state.loadError = null;
      renderAll();
      renderLoadStatus();
    }

    async function sendPulse(featureId, body, onSuccess) {
      if (PP_RUNTIME.mode === "static") return false;
      state.saving = true;
      state.feedback[featureId] = { kind: "saving", message: "Saving..." };
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
          state.feedback[featureId] = { kind: "err", message: err.error || "Update failed" };
          renderFeedback();
          return false;
        }
        if (typeof onSuccess === "function") onSuccess();
        state.saving = false;
        state.feedback[featureId] = { kind: "ok", message: "Saved" };
        await fetchRoadmap();
        return true;
      } catch (err) {
        state.saving = false;
        state.feedback[featureId] = { kind: "err", message: (err && err.message) || "Network error while saving" };
        renderFeedback();
        return false;
      }
    }

    function renderLoadStatus() {
      const el = document.getElementById("load-status");
      if (!el) return;
      if (state.loadError) {
        el.textContent = "Roadmap refresh failed: " + state.loadError;
        el.hidden = false;
      } else {
        el.textContent = "";
        el.hidden = true;
      }
    }

    function renderFeedback() {
      const el = document.getElementById("drawer-feedback");
      if (!el) return;
      const feedback = state.drawerFeatureId ? state.feedback[state.drawerFeatureId] : null;
      if (!feedback) {
        el.className = "drawer-feedback";
        el.textContent = "";
        return;
      }
      const cls = feedback.kind === "err" ? "is-err" : feedback.kind === "saving" ? "is-saving" : "is-ok";
      el.className = "drawer-feedback is-visible " + cls;
      el.textContent = feedback.message;
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
        const msg = state.statusFilter || state.areaFilter || q
          ? "No features match the active filter."
          : "No milestones match the active filter.";
        container.innerHTML = '<p class="empty-msg">' + msg + "</p>";
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
                const rawBeads = data.beads ? data.beads[f.id] : null;
                const beads = Array.isArray(rawBeads) ? rawBeads : [];
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
        // Fit uses the exact computed scale with no arbitrary floor, so every node stays
        // visible no matter how wide the layer grows. Guards only against degenerate
        // stage dimensions; the result is always positive because vw/vh exceed the margin.
        const safeW = stageW > 0 ? stageW : 1;
        const safeH = stageH > 0 ? stageH : 1;
        cam.scale = Math.min(1, (vw - 56) / safeW, (vh - 56) / safeH);
        const scaledW = stageW * cam.scale;
        const scaledH = stageH * cam.scale;
        cam.tx = Math.round((vw - scaledW) / 2);
        cam.ty = Math.round((vh - scaledH) / 2);
        clampCamera();
        applyCamera();
      }

      function zoomAt(nextScale, cx, cy) {
        // Below the interactive floor (right after a deep fit) the floor follows the
        // camera, so zooming out can never bounce the view back in with a jump.
        const clamped = clamp(nextScale, Math.min(MIN_ZOOM, cam.scale), MAX_ZOOM);
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
      const hasFeatureFilter = Boolean(state.statusFilter || state.areaFilter || q);
      const hasActiveFilters = Boolean(state.milestoneFilter || hasFeatureFilter);
      const resetBtn = document.getElementById("filter-reset");
      if (resetBtn) resetBtn.hidden = !hasActiveFilters;

      const filteredFeatures = data.features.filter((f) => {
        if (state.milestoneFilter && f.milestone !== state.milestoneFilter) return false;
        if (state.statusFilter && f.status !== state.statusFilter) return false;
        if (state.areaFilter && f.area !== state.areaFilter) return false;
        if (q && !(f.title.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q))) return false;
        return true;
      });

      const matchedMilestoneIds = new Set(filteredFeatures.map((f) => f.milestone));
      const visibleMilestones = data.milestones.filter((m) => {
        if (state.milestoneFilter && m.id !== state.milestoneFilter) return false;
        if (hasFeatureFilter && !matchedMilestoneIds.has(m.id)) return false;
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
      const clearDrawer = () => {
        backdrop.classList.remove("open");
        backdrop.setAttribute("aria-hidden", "true");
        drawer.innerHTML = "";
        state.drawerFeatureId = null;
        // A selected feature that vanished from the data must leave no stale selection:
        // hiding the drawer without clearing it blocked graph shortcuts and Escape.
        state.selectedFeatureId = null;
        state.lastFocusedCardId = null;
        state.drawerReturnFocusEl = null;
      };
      if (!state.selectedFeatureId || !state.data) {
        clearDrawer();
        return;
      }
      const feature = state.data.features.find((f) => f.id === state.selectedFeatureId);
      if (!feature) {
        clearDrawer();
        return;
      }

      const isStatic = PP_RUNTIME.mode === "static";
      const prevInput = document.getElementById("drawer-note-input");
      let restoreInputFocus = false;
      let selStart = null;
      let selEnd = null;
      if (prevInput && state.drawerFeatureId) {
        state.noteDrafts[state.drawerFeatureId] = prevInput.value;
        if (document.activeElement === prevInput) {
          restoreInputFocus = true;
          selStart = prevInput.selectionStart;
          selEnd = prevInput.selectionEnd;
        }
      }
      const prevScrollTop = drawer.scrollTop;

      backdrop.classList.add("open");
      backdrop.setAttribute("aria-hidden", "false");

      const rawBeads = state.data.beads ? state.data.beads[feature.id] : null;
      const beads = Array.isArray(rawBeads) ? rawBeads : [];
      const statuses = ["planned", "in-progress", "shipped", "paused", "cut"];
      state.drawerFeatureId = feature.id;
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
          const submittedDraft = noteInput.value;
          const submitBtn = document.getElementById("drawer-note-submit");
          if (submitBtn) submitBtn.disabled = true;
          await sendPulse(feature.id, { note }, () => {
            if (state.noteDrafts[feature.id] !== submittedDraft) return;
            delete state.noteDrafts[feature.id];
            if (noteInput.isConnected && state.drawerFeatureId === feature.id && noteInput.value === submittedDraft) {
              noteInput.value = "";
            }
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
    const drawerBackdrop = document.getElementById("drawer-backdrop");
    let backdropPressBegan = false;
    drawerBackdrop.addEventListener("pointerdown", (e) => {
      // Chromium targets the click at the common ancestor of the press and release points:
      // a drag starting inside the drawer and ending on the backdrop must not close it.
      backdropPressBegan = e.target === drawerBackdrop;
    });
    drawerBackdrop.addEventListener("click", (e) => {
      const genuineBackdropPress = backdropPressBegan && e.target === drawerBackdrop;
      backdropPressBegan = false;
      if (genuineBackdropPress) {
        closeDrawer();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        // Dismiss the foremost surface first: the drawer overlays the health panel.
        if (state.selectedFeatureId) {
          closeDrawer();
        } else if (state.healthPanelOpen) {
          state.healthPanelOpen = false;
          renderHealthPanel();
          document.getElementById("health-badge").focus();
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
        fetchRoadmap().catch(console.error);
      });
    }

    fetchRoadmap().catch((err) => {
      state.loadError = (err && err.message) || "Failed to load roadmap";
      renderLoadStatus();
    });
`;
