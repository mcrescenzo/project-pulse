---
id: dashboard-foundation
title: Dashboard redesign foundation
milestone: v2.1
order: 10
status: shipped
area: Dashboard
depends_on: []
refs:
  - bd:pp-t80.19
ship_criteria:
  - id: dashboard-source-split-into
    text: Dashboard source split into modules that still produce one HTML string
    done: true
  - id: design-tokens-with-a
    text: Design tokens with a contrast test in both themes, and DESIGN.md
    done: true
  - id: shared-presentation-labels-and
    text: Shared presentation labels and formats used by web and TUI
    done: true
  - id: shipped-with-open-criteria
    text: SHIPPED_WITH_OPEN_CRITERIA warning and an explicit CLI edit-freeze message
    done: true
  - id: activity-event-provider-and
    text: Activity event provider and /api/activity with an Uncommitted group
    done: true
  - id: pp-view-prints-a
    text: pp view prints a token-free hub handoff and states hub ownership
    done: true
updates:
  - at: 2026-11-26T04:40:28.787Z
    note: "Foundation landed on work/dashboard-foundation: module split, tokens +
      DESIGN.md, src/present.ts, SHIPPED_WITH_OPEN_CRITERIA, RoadmapFrozenError
      + editable/stale flags, /api/activity, token-free hub handoff."
---
Shared groundwork for the parallel web and TUI redesign PRs.
