---
id: static-html-export
title: Self-Contained Static HTML Export
milestone: v0.3
order: 50
status: planned
area: UI
depends_on: 
  - dashboard-polish-security
refs: 
  []
ship_criteria: 
  - id: pp-export-html-writes
    text: pp export --html writes a single standalone HTML file with zero external network dependencies
    done: false
  - id: preserves-milestone-grouping-fil
    text: "Preserves milestone grouping, filters, search, theme toggle, and read-only detail drawer offline"
    done: false
  - id: supports-out-path-and
    text: Supports --out <path> and deterministic output verified by tests
    done: false
updates: 
  []
---
Generates a single self-contained offline HTML roadmap snapshot from .project-pulse/ for sharing without a local server.
