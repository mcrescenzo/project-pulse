---
id: tui-interactive-drawer
title: TUI Interactive Detail Drawer & Live Watch
milestone: v0.4
order: 40
status: shipped
area: UI
depends_on:
  - tui-views-and-filters
  - tui-waterfall-graph
refs:
  - bd:pp-02n.4
ship_criteria:
  - id: responsive-split-pane-120
    text: "Responsive split-pane (>= 120 cols) and full-height modal (< 120 cols) Feature Detail Drawer with status pills, criteria toggles, Depends On jumps, and draft-preserving pulse notes"
    done: true
  - id: instant-first-paint-from
    text: "Instant first paint from disk with non-blocking async Beads refresh, debounced fs.watch live reload, m mouse toggle, y OSC 52 copy, and ? help overlay"
    done: true
  - id: end-to-end-virtual
    text: End-to-end virtual-buffer interaction tests and real headless PTY smoke test verifying alt-screen entry and clean exit restoration
    done: true
updates:
  - at: 2026-11-20T16:39:35.959Z
    note: "Implemented src/tui/drawer.ts, integrated split/modal drawer quick-actions, debounced fs.watch reload, async Beads refresh, m/y/? shortcuts, and virtual-buffer + real PTY smoke tests in tests/v04-tui-drawer-pty.test.ts (merged on main at ce0c8a8)."
  - at: 2026-11-20T21:12:27.364Z
    note: "Commit refs remapped after v0.5 history rewrite: ce0c8a8 → 3d830fb."
---
Responsive split/modal Feature Detail Drawer with criteria/status/note persistence, debounced fs.watch reload, async Beads refresh, and PTY smoke test.
