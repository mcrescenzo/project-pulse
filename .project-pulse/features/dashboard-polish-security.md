---
id: dashboard-polish-security
title: "Dashboard Security, Accessibility & Visual Polish"
milestone: v0.2
order: 30
status: planned
area: UI
depends_on: 
  - local-browser-view
refs: 
  []
ship_criteria: 
  - id: enforces-localhost-origin-host
    text: Enforces localhost Origin/Host and application/json checks on POST /api/features/:id/pulse
    done: false
  - id: provides-keyboard-accessible-car
    text: "Provides keyboard-accessible cards, ARIA dialog drawer with Escape-to-close, labeled filters, and inline saving feedback"
    done: false
  - id: preserves-unsaved-drawer-drafts
    text: Preserves unsaved drawer drafts across SSE reloads and adds clickable health/drift popover and light/dark theme toggle
    done: false
  - id: shows-1-line-card
    text: "Shows 1-line card descriptions with reduced tag noise, serves inline favicon, fixes mobile KPI grid, and adds Playwright UI regression tests"
    done: false
updates: 
  []
---
Hardens localhost mutations against CSRF, makes cards and drawer fully keyboard/ARIA accessible, preserves drafts across SSE reloads, and polishes visual hierarchy.
