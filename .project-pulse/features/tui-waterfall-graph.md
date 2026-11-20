---
id: tui-waterfall-graph
title: TUI Waterfall Dependency Graph
milestone: v0.4
order: 30
status: shipped
area: UI
depends_on:
  - tui-core-engine
  - dashboard-view-modes
refs:
  - bd:pp-02n.3
ship_criteria:
  - id: top-to-bottom-orthogonal
    text: "Top-to-bottom orthogonal waterfall DAG with parent-barycenter ordering and 3 discrete density zoom levels (Full, Compact, Overview/Fit)"
    done: true
  - id: click-and-drag-panning
    text: "Click-and-drag panning with drag threshold, wheel/+/-/0/F zoom controls, and expanded viewport height in Graph mode"
    done: true
  - id: hover-off-by-default
    text: "Hover OFF by default over SSH (click once to trace amber upstream / green downstream, click again or Enter to open drawer) plus optional Hover toggle"
    done: true
updates:
  - at: 2026-11-20T16:36:37.804Z
    note: "Implemented src/tui/graph.ts, integrated pan/zoom/hover-trace controls into src/tui/app.ts, and added tests/v04-tui-graph.test.ts (merged on main at 404c910)."
  - at: 2026-11-20T21:11:45.884Z
    note: "Hover now defaults to ON (commit 64445d2, 'default graph hover ON'); the original 'Hover OFF by default' criterion text is superseded."
  - at: 2026-11-20T21:12:27.331Z
    note: "Commit refs remapped after v0.5 history rewrite: 404c910 → 78d85ca, 64445d2 → abc4bf4."
---
Top-to-bottom orthogonal waterfall DAG with 3 discrete density zoom levels, click-and-drag panning, and dependency chain highlighting.
