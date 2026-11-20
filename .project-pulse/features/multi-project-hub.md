---
id: multi-project-hub
title: Auto-Joining Multi-Project Local Hub
milestone: v0.3
order: 10
status: in-progress
area: UI
depends_on:
  - dashboard-polish-security
refs:
  - bd:pp-rrp.2
ship_criteria:
  - id: running-pp-view-in
    text: Running pp view in multiple repos auto-registers each repo on one hub port under /p/<slug> with isolated file watchers and SSE streams
    done: true
  - id: includes-a-header-project
    text: "Includes a header project switcher, a / portfolio overview page, and stale-path cleanup"
    done: true
  - id: supports-standalone-fallback-to
    text: Supports --standalone fallback to run an isolated single-repo server
    done: true
updates:
  - at: 2026-11-20T14:25:19.103Z
    note: "Implemented src/hub.ts with auto-joining localhost hub, /p/<slug> isolated watchers & SSE, / portfolio overview, project switcher, stale-path pruning, 0600 token auth, and --standalone fallback."
---
Lets pp view start or join a shared local hub on 127.0.0.1:4310 so parallel repositories each get their own /p/<slug> URL, watcher, and project switcher.
