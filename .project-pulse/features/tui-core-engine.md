---
id: tui-core-engine
title: TUI Core Engine & CLI Entrypoint
milestone: v0.4
order: 10
status: planned
area: UI
depends_on:
  - dashboard-polish-security
  - cli-core-hardening
refs:
  - bd:pp-02n.1
ship_criteria:
  - id: zero-dependency-2d-cell
    text: "Zero-dependency 2D cell-buffer renderer with ANSI diffing, synchronized output, color/NO_COLOR auto-detection, and escape sanitization"
    done: false
  - id: stateful-keyboard-and-sgr
    text: "Stateful keyboard and SGR mouse input decoder with z-indexed hit-test regions, OSC 52 copy, and guaranteed raw-mode/alt-screen teardown"
    done: false
  - id: explicit-pp-view-tui
    text: "Explicit pp view --tui [--no-beads] CLI wiring rejecting non-TTY sessions and incompatible HTTP flags"
    done: false
updates:
  []
---
Zero-dependency 2D cell-buffer renderer, SGR mouse/key parser, escape sanitizer, OSC 52 copy, and pp view --tui CLI wiring.
