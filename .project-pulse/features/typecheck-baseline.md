---
id: typecheck-baseline
title: TypeScript Typecheck Baseline & Test Hygiene
milestone: v0.5
order: 5
status: shipped
area: Core
depends_on:
  - cli-core-hardening
refs:
  - bd:pp-4cq.2
ship_criteria:
  - id: adds-typescript-and-types
    text: Adds typescript and @types/bun dev dependencies matching Bun 1.3 plus a typecheck script
    done: true
  - id: tsc-noemit-passes-with
    text: tsc --noEmit passes with zero errors across src and tests
    done: true
  - id: replaces-fixed-sleep-and
    text: Replaces fixed-sleep and silent-skip tests with deterministic polling or visible skips
    done: true
updates:
  - at: 2026-11-20T21:14:19.549Z
    note: "Added typescript 5.9.3 + @types/bun 1.3.9 and bun run typecheck (0 errors); fixed TUI test fixtures that stored {mouse} instead of {enabled}; shared tests/helpers/{chromium,wait}.ts with PP_REQUIRE_UI_TESTS hard-fail; replaced fixed sleeps with polling (pp-4cq.2)."
---
Installs TypeScript tooling, fixes all type errors, and deflakes timing-sensitive tests so CI can enforce typechecks.
