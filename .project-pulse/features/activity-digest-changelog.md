---
id: activity-digest-changelog
title: Roadmap Activity Digest & Release Changelog
milestone: v0.3
order: 30
status: planned
area: CLI
depends_on:
  - cli-core-hardening
refs:
  - bd:pp-rrp.4
ship_criteria:
  - id: pp-digest-summarizes-shipped
    text: "pp digest summarizes shipped features, status movement, completed criteria, and notes since a date or git ref"
    done: false
  - id: pp-changelog-generates-clean
    text: pp changelog generates clean Markdown release notes for a milestone with --json support
    done: false
  - id: works-gracefully-in-repos
    text: Works gracefully in repos with minimal or unannotated git history
    done: false
updates:
  []
---
Compiles concise progress digests and release notes from roadmap updates, shipped features, and git history since a date, tag, or milestone.
