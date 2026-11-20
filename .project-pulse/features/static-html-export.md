---
id: static-html-export
title: Self-Contained Static HTML Export
milestone: v0.3
order: 50
status: shipped
area: UI
depends_on:
  - dashboard-polish-security
refs:
  - bd:pp-rrp.3
ship_criteria:
  - id: pp-export-html-writes
    text: pp export --html writes a single standalone HTML file with zero external network dependencies
    done: true
  - id: preserves-milestone-grouping-fil
    text: "Preserves milestone grouping, filters, search, theme toggle, and read-only detail drawer offline"
    done: true
  - id: supports-out-path-and
    text: Supports --out <path> and deterministic output verified by tests
    done: true
updates:
  - at: 2026-11-20T14:26:35.095Z
    note: "Implemented src/export.ts and pp export --html with deterministic zero-network standalone HTML output, XSS-safe script escaping, --out support, and offline Chromium verification."
---
Generates a single self-contained offline HTML roadmap snapshot from .project-pulse/ for sharing without a local server.
