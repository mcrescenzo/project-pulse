---
id: tui-interactive-drawer
title: TUI Interactive Detail Drawer & Live Watch
milestone: v0.4
order: 40
status: planned
area: UI
depends_on:
  - tui-views-and-filters
  - tui-waterfall-graph
refs:
  - bd:pp-02n.4
ship_criteria:
  - id: responsive-split-pane-120
    text: "Responsive split-pane (>= 120 cols) and full-height modal (< 120 cols) Feature Detail Drawer with status pills, criteria toggles, Depends On jumps, and draft-preserving pulse notes"
    done: false
  - id: instant-first-paint-from
    text: "Instant first paint from disk with non-blocking async Beads refresh, debounced fs.watch live reload, m mouse toggle, y OSC 52 copy, and ? help overlay"
    done: false
  - id: end-to-end-virtual
    text: End-to-end virtual-buffer interaction tests and real headless PTY smoke test verifying alt-screen entry and clean exit restoration
    done: false
updates:
  []
---
Responsive split/modal Feature Detail Drawer with criteria/status/note persistence, debounced fs.watch reload, async Beads refresh, and PTY smoke test.
