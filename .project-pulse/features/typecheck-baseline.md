---
id: typecheck-baseline
title: TypeScript Typecheck Baseline & Test Hygiene
milestone: v0.5
order: 5
status: planned
area: Core
depends_on:
  - cli-core-hardening
refs:
  - bd:pp-4cq.2
ship_criteria:
  - id: adds-typescript-and-types
    text: Adds typescript and @types/bun dev dependencies matching Bun 1.3 plus a typecheck script
    done: false
  - id: tsc-noemit-passes-with
    text: tsc --noEmit passes with zero errors across src and tests
    done: false
  - id: replaces-fixed-sleep-and
    text: Replaces fixed-sleep and silent-skip tests with deterministic polling or visible skips
    done: false
updates:
  []
---
Installs TypeScript tooling, fixes all type errors, and deflakes timing-sensitive tests so CI can enforce typechecks.
