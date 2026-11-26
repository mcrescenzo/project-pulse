---
id: dashboard-foundation
title: Dashboard redesign foundation
milestone: v2.1
order: 10
status: in-progress
area: Dashboard
depends_on: []
refs:
  - bd:pp-t80.19
ship_criteria:
  - id: dashboard-source-split-into
    text: Dashboard source split into modules that still produce one HTML string
    done: false
  - id: design-tokens-with-a
    text: Design tokens with a contrast test in both themes, and DESIGN.md
    done: false
  - id: shared-presentation-labels-and
    text: Shared presentation labels and formats used by web and TUI
    done: false
  - id: shipped-with-open-criteria
    text: SHIPPED_WITH_OPEN_CRITERIA warning and an explicit CLI edit-freeze message
    done: false
  - id: activity-event-provider-and
    text: Activity event provider and /api/activity with an Uncommitted group
    done: false
  - id: pp-view-prints-a
    text: pp view prints a token-free hub handoff and states hub ownership
    done: false
updates: []
---
Shared groundwork for the parallel web and TUI redesign PRs.
