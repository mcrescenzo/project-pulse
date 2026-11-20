---
id: beads-resolution-perf
title: Batched & Cached Beads Resolution
milestone: v0.2
order: 20
status: planned
area: Integrations
depends_on: 
  - orientation-and-beads
refs: 
  []
ship_criteria: 
  - id: resolves-multiple-unique-beads
    text: Resolves multiple unique Beads refs via batched lookup with per-invocation cache
    done: false
  - id: speeds-up-pp-check
    text: "Speeds up pp check --beads, pp show, and /api/roadmap without stale cross-run cache state"
    done: false
  - id: covers-multi-ref-caching
    text: Covers multi-ref caching and partial missing-id behavior in unit tests
    done: false
updates: 
  []
---
Eliminates serial N+1 bd show subprocess calls via batched lookup and per-invocation caching across CLI and dashboard endpoints.
