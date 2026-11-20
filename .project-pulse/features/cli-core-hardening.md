---
id: cli-core-hardening
title: CLI Ergonomics & Core Store Hardening
milestone: v0.2
order: 10
status: planned
area: CLI
depends_on: 
  - authoring-cli
refs: 
  []
ship_criteria: 
  - id: discovers-project-pulse-upward
    text: Discovers .project-pulse/ upward from any nested subdirectory
    done: false
  - id: rejects-unknown-cli-flags
    text: Rejects unknown CLI flags with clear errors instead of swallowing them
    done: false
  - id: supports-add-criterion-remove
    text: "Supports --add-criterion, --remove-criterion, feature/milestone remove, bare pp summary, and --no-beads"
    done: false
  - id: emits-whitespace-clean-yaml
    text: "Emits whitespace-clean YAML, handles malformed config.yaml in pp check, and deduplicates self-dependency cycle errors"
    done: false
updates: 
  []
---
Upward .project-pulse/ discovery, strict flag parsing, non-destructive criteria edits, default summary, remove commands, clean YAML, and resilient checks.
