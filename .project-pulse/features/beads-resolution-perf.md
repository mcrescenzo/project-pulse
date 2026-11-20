---
id: beads-resolution-perf
title: Batched & Cached Beads Resolution
milestone: v0.2
order: 20
status: in-progress
area: Integrations
depends_on:
  - orientation-and-beads
refs:
  - bd:pp-01q.2
ship_criteria:
  - id: resolves-multiple-unique-beads
    text: Resolves multiple unique Beads refs via batched lookup with per-invocation cache
    done: true
  - id: speeds-up-pp-check
    text: "Speeds up pp check --beads, pp show, and /api/roadmap without stale cross-run cache state"
    done: true
  - id: covers-multi-ref-caching
    text: Covers multi-ref caching and partial missing-id behavior in unit tests
    done: true
updates:
  - at: 2026-11-20T14:07:15.686Z
    note: Replaced serial bd show calls with batched chunked resolution and single-pass store loading across checkWithBeads and /api/roadmap.
---
Eliminates serial N+1 bd show subprocess calls via batched lookup and per-invocation caching across CLI and dashboard endpoints.
