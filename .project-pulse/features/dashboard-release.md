---
id: dashboard-release
title: Verify and release v2.1.0
milestone: v2.1
order: 40
status: in-progress
area: Release
depends_on:
  - dashboard-web
  - dashboard-tui
refs:
  - bd:pp-t80.22
ship_criteria:
  - id: epic-acceptance-a1-a16
    text: Epic acceptance A1–A16 proved end to end on main
    done: true
  - id: readme-screenshots-changelog-and
    text: README screenshots, CHANGELOG and DESIGN.md match the shipped UI
    done: true
  - id: version-2-1-0
    text: Version 2.1.0 prepared; publishing left to the maintainer
    done: true
updates:
  - at: 2026-11-26T05:47:52.851Z
    note: "2.1.0 prepared: A1–A16 verified end to end on main a2badd0 (pp-t80.22
      notes); README screenshots, CHANGELOG and DESIGN.md updated. Tagging,
      publishing and registry verification remain with the maintainer, so this
      feature and milestone v2.1 stay unshipped."
---
