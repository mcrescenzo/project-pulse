---
id: tui-core-engine
title: TUI Core Engine & CLI Entrypoint
milestone: v0.4
order: 10
status: shipped
area: UI
depends_on:
  - dashboard-polish-security
  - cli-core-hardening
refs:
  - bd:pp-02n.1
ship_criteria:
  - id: zero-dependency-2d-cell
    text: "Zero-dependency 2D cell-buffer renderer with ANSI diffing, synchronized output, color/NO_COLOR auto-detection, and escape sanitization"
    done: true
  - id: stateful-keyboard-and-sgr
    text: "Stateful keyboard and SGR mouse input decoder with z-indexed hit-test regions, OSC 52 copy, and guaranteed raw-mode/alt-screen teardown"
    done: true
  - id: explicit-pp-view-tui
    text: "Explicit pp view --tui [--no-beads] CLI wiring rejecting non-TTY sessions and incompatible HTTP flags"
    done: true
updates:
  - at: 2026-11-20T16:32:01.642Z
    note: "Implemented src/tui/screen.ts, src/tui/input.ts, src/tui/app.ts stub, pp view --tui [--no-beads] CLI validation, and tests/v04-tui-core.test.ts (merged on main at 5c0bc66)."
---
Zero-dependency 2D cell-buffer renderer, SGR mouse/key parser, escape sanitizer, OSC 52 copy, and pp view --tui CLI wiring.
