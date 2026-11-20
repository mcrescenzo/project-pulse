---
id: tui-waterfall-graph
title: TUI Waterfall Dependency Graph
milestone: v0.4
order: 30
status: planned
area: UI
depends_on:
  - tui-core-engine
  - dashboard-view-modes
refs:
  - bd:pp-02n.3
ship_criteria:
  - id: top-to-bottom-orthogonal
    text: "Top-to-bottom orthogonal waterfall DAG with parent-barycenter ordering and 3 discrete density zoom levels (Full, Compact, Overview/Fit)"
    done: false
  - id: click-and-drag-panning
    text: "Click-and-drag panning with drag threshold, wheel/+/-/0/F zoom controls, and expanded viewport height in Graph mode"
    done: false
  - id: hover-off-by-default
    text: "Hover OFF by default over SSH (click once to trace amber upstream / green downstream, click again or Enter to open drawer) plus optional Hover toggle"
    done: false
updates:
  []
---
Top-to-bottom orthogonal waterfall DAG with 3 discrete density zoom levels, click-and-drag panning, and dependency chain highlighting.
