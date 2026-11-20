---
id: tui-views-and-filters
title: "TUI Views, Filters & Health Diagnostics"
milestone: v0.4
order: 20
status: shipped
area: UI
depends_on:
  - tui-core-engine
refs:
  - bd:pp-02n.2
ship_criteria:
  - id: header-kpi-strip-clickable
    text: "Header, KPI strip, clickable Health & Drift overlay with jump-to-feature, and shared view/filter bar with floating pickers and / search"
    done: true
  - id: responsive-1-3-column
    text: Responsive 1-3 column Milestone Cards view hiding empty milestones when filtering and Status Board columns with keyboard and wheel scrolling
    done: true
  - id: virtual-screen-buffer-test
    text: "Virtual screen-buffer test suite covering filters, view switching, scrolling, and health diagnostics"
    done: true
updates:
  - at: 2026-11-20T16:34:19.503Z
    note: "Implemented src/tui/views.ts, full TuiController in src/tui/app.ts, and tests/v04-tui-views.test.ts covering KPIs, floating pickers, live search, empty-milestone filter hiding, Status Board, and Health diagnostics (merged on main at a11791d)."
  - at: 2026-11-20T21:12:27.294Z
    note: "Commit refs remapped after v0.5 history rewrite: a11791d → 87df926."
---
Header, KPI strip, Health & Drift overlay, clickable filter pickers, / search, responsive Milestone Cards, and Status Board columns.
