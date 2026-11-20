---
id: multi-project-hub
title: Auto-Joining Multi-Project Local Hub
milestone: v0.3
order: 10
status: planned
area: UI
depends_on:
  - dashboard-polish-security
refs:
  - bd:pp-rrp.2
ship_criteria:
  - id: running-pp-view-in
    text: Running pp view in multiple repos auto-registers each repo on one hub port under /p/<slug> with isolated file watchers and SSE streams
    done: false
  - id: includes-a-header-project
    text: "Includes a header project switcher, a / portfolio overview page, and stale-path cleanup"
    done: false
  - id: supports-standalone-fallback-to
    text: Supports --standalone fallback to run an isolated single-repo server
    done: false
updates:
  []
---
Lets pp view start or join a shared local hub on 127.0.0.1:4310 so parallel repositories each get their own /p/<slug> URL, watcher, and project switcher.
