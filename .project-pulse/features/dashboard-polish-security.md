---
id: dashboard-polish-security
title: "Dashboard Security, Accessibility & Visual Polish"
milestone: v0.2
order: 30
status: in-progress
area: UI
depends_on:
  - local-browser-view
refs:
  - bd:pp-01q.3
ship_criteria:
  - id: enforces-localhost-origin-host
    text: Enforces localhost Origin/Host and application/json checks on POST /api/features/:id/pulse
    done: true
  - id: provides-keyboard-accessible-car
    text: "Provides keyboard-accessible cards, ARIA dialog drawer with Escape-to-close, labeled filters, and inline saving feedback"
    done: true
  - id: preserves-unsaved-drawer-drafts
    text: Preserves unsaved drawer drafts across SSE reloads and adds clickable health/drift popover and light/dark theme toggle
    done: true
  - id: shows-1-line-card
    text: "Shows 1-line card descriptions with reduced tag noise, serves inline favicon, fixes mobile KPI grid, and adds Playwright UI regression tests"
    done: true
updates:
  - at: 2026-11-20T14:09:32.823Z
    note: "Added localhost CSRF validation, keyboard/ARIA accessibility, SSE draft preservation, clickable health panel, theme toggle, responsive 6-card KPI grid, favicon, and Playwright UI regression suite."
---
Hardens localhost mutations against CSRF, makes cards and drawer fully keyboard/ARIA accessible, preserves drafts across SSE reloads, and polishes visual hierarchy.
