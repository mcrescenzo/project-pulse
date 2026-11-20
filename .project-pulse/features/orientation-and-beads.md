---
id: orientation-and-beads
title: Orientation Views & Beads Drift Resolver
milestone: v0.1
order: 30
status: shipped
area: Integrations
depends_on: 
  - authoring-cli
refs: 
  - bd:pp-33l.3
ship_criteria: 
  - id: token-lean-pp-summary
    text: Token-lean pp summary (<500 words) and detailed pp show
    done: true
  - id: read-only-bd-show
    text: Read-only bd show resolution with drift detection and graceful fallback
    done: true
updates: 
  - at: 2026-11-20T04:52:42.276Z
    note: "Summary, show, and read-only Beads drift resolver shipped on main."
---
Fast orientation summaries and optional read-only Beads drift checks.
