import { PRESENT_CLIENT_JS } from "../present";
import { EARLY_THEME_SCRIPT, FAVICON_DATA_URL, SHARED_THEME_CSS } from "./theme";

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
    h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
    .subtitle { margin: 6px 0 0; color: var(--muted); }
    .header-actions { display: flex; gap: 10px; align-items: center; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: var(--radius-sm);
      font-size: var(--fs-xs);
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .pill-live { background: var(--live-soft); color: var(--live); }
    .pill-live .dot { width: 8px; height: 8px; border-radius: var(--radius-sm); background: var(--live); }
    .pill-ok { background: var(--ok-soft); color: var(--ok); }
    .pill-err { background: var(--danger-soft); color: var(--danger); }
    .icon-btn {
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      cursor: pointer;
      font-size: var(--fs-xs);
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
    .project-title { font-size: var(--fs-lg); font-weight: 700; margin: 0; }
    .project-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--fs-xs);
      color: var(--muted);
      word-break: break-all;
      margin-top: 2px;
    }
    .project-summary { margin: 0; color: var(--muted); font-size: var(--fs-base); }
    .progress-track { width: 100%; height: 7px; background: var(--surface-2); border-radius: var(--radius-sm); overflow: hidden; }
    .progress-fill { height: 100%; background: var(--st-shipped); }
    .project-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: var(--fs-xs); color: var(--muted); }
    .project-actions { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 4px; }
    .btn-open {
      display: inline-block;
      padding: 7px 14px;
      border-radius: var(--radius);
      background: var(--accent);
      color: var(--on-accent);
      text-decoration: none;
      font-size: var(--fs-sm);
      font-weight: 600;
    }
    .btn-remove {
      padding: 6px 10px;
      border-radius: var(--radius);
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
      cursor: pointer;
      font-size: var(--fs-xs);
      font-family: inherit;
    }
    .btn-remove:hover { color: var(--danger); border-color: var(--danger); }
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

  <script>${PRESENT_CLIENT_JS}
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
          ? '<span class="pill pill-ok">' + PP_PRESENT.healthText(0, 0) + '</span>'
          : '<span class="pill pill-err">' + PP_PRESENT.healthText((p.check && p.check.errorCount) || 1, 0) + "</span>";
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
