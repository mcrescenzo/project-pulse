---
id: dashboard-view-modes
title: Interactive Dependency Graph & Status Board Views
milestone: v0.3
order: 20
status: in-progress
area: UI
depends_on:
  - dashboard-polish-security
refs:
  - bd:pp-rrp.1
ship_criteria:
  - id: switches-cleanly-between-milesto
    text: "Switches cleanly between Milestone Cards, interactive Feature DAG Graph, and Status Board views"
    done: true
  - id: highlights-upstream-downstream-d
    text: Highlights upstream/downstream dependencies on hover or focus in Graph view
    done: true
  - id: shares-active-filters-search
    text: "Shares active filters, search, and the feature detail drawer across all views"
    done: true
updates:
  - at: 2026-11-20T14:23:14.046Z
    note: "Extracted src/dashboard-html.ts and createProjectSlot(), adding Milestone Cards, layered Dependency Graph with upstream/downstream highlight, and Status Board views."
---
Adds switchable Feature DAG dependency graph and Status Board views alongside the default Milestone Cards view in pp view.
