---
id: local-browser-view
title: Live-Reloading Local Browser Dashboard
milestone: v0.1
order: 50
status: shipped
area: UI
depends_on: 
  - orientation-and-beads
refs: 
  - bd:pp-33l.5
ship_criteria: 
  - id: interactive-dashboard-groups-fea
    text: Interactive dashboard groups features by milestone with filters and detail drawer
    done: true
  - id: sse-live-reload-and
    text: SSE live-reload and quick-actions persist to .project-pulse/ and ROADMAP.md
    done: true
updates: 
  - at: 2026-11-20T04:52:42.468Z
    note: Bun.serve dashboard with SSE live-reload and drawer quick-actions shipped on main.
---
Localhost web viewer powered by Bun.serve with file-watch live reload.
