---
id: authoring-cli
title: Milestone & Feature Authoring CLI
milestone: v0.1
order: 20
status: shipped
area: CLI
depends_on: 
  - atomic-roadmap-store
refs: 
  - bd:pp-33l.2
ship_criteria: 
  - id: milestone-and-feature-crud
    text: Milestone and feature CRUD commands auto-regenerate ROADMAP.md
    done: true
  - id: ship-criteria-checkboxes-and
    text: Ship criteria checkboxes and timestamped pulse notes work via CLI
    done: true
updates: 
  - at: 2026-11-20T04:52:42.184Z
    note: Authoring subcommands with pre-write validation and auto-sync shipped on main.
---
CLI authoring commands for milestones, features, ship criteria, and pulse logs.
