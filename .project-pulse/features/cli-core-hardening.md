---
id: cli-core-hardening
title: CLI Ergonomics & Core Store Hardening
milestone: v0.2
order: 10
status: shipped
area: CLI
depends_on:
  - authoring-cli
refs:
  - bd:pp-01q.1
ship_criteria:
  - id: discovers-project-pulse-upward
    text: Discovers .project-pulse/ upward from any nested subdirectory
    done: true
  - id: rejects-unknown-cli-flags
    text: Rejects unknown CLI flags with clear errors instead of swallowing them
    done: true
  - id: supports-add-criterion-remove
    text: "Supports --add-criterion, --remove-criterion, feature/milestone remove, bare pp summary, and --no-beads"
    done: true
  - id: emits-whitespace-clean-yaml
    text: "Emits whitespace-clean YAML, handles malformed config.yaml in pp check, and deduplicates self-dependency cycle errors"
    done: true
updates:
  - at: 2026-11-20T14:05:52.853Z
    note: "Implemented upward discovery, strict CLI validation, non-destructive criteria edits, entity removal, clean YAML, and resilient checks."
---
Upward .project-pulse/ discovery, strict flag parsing, non-destructive criteria edits, default summary, remove commands, clean YAML, and resilient checks.
