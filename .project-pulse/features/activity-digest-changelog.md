---
id: activity-digest-changelog
title: Roadmap Activity Digest & Release Changelog
milestone: v0.3
order: 30
status: in-progress
area: CLI
depends_on:
  - cli-core-hardening
refs:
  - bd:pp-rrp.4
ship_criteria:
  - id: pp-digest-summarizes-shipped
    text: "pp digest summarizes shipped features, status movement, completed criteria, and notes since a date or git ref"
    done: true
  - id: pp-changelog-generates-clean
    text: pp changelog generates clean Markdown release notes for a milestone with --json support
    done: true
  - id: works-gracefully-in-repos
    text: Works gracefully in repos with minimal or unannotated git history
    done: true
updates:
  - at: 2026-11-20T14:28:09.982Z
    note: "Implemented src/digest.ts powering pp digest and pp changelog with git baseline diffing, ref/date parsing, and graceful fallback for minimal/non-git repos."
---
Compiles concise progress digests and release notes from roadmap updates, shipped features, and git history since a date, tag, or milestone.
