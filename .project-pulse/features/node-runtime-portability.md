---
id: node-runtime-portability
title: Node.js 24+ & Bun Dual-Runtime Portability
milestone: v1.0
order: 10
status: in-progress
area: Core
depends_on:
  - cli-core-hardening
  - multi-project-hub
refs: []
ship_criteria:
  - id: preserves-fast-startup-and
    text: Preserves fast startup and clean zero-bloat dependency footprint
    done: false
  - id: replaces-bun-yaml-bun
    text: Replaces Bun.YAML, Bun.serve, and Bun.spawn/Bun.stdin with portable
      Node.js 24+ APIs and a lightweight YAML parser
    done: true
  - id: passes-full-cli-mcp
    text: Passes full CLI, MCP, hub server, and Beads test suites under both Node.js
      24+ and Bun
    done: true
updates:
  - at: 2026-11-23T19:29:41.632Z
    note: "Runtime evidence (harness: omp, machine: ws, profile: default, branch
      work/node-runtime-portability):
      Bun.YAML/Bun.serve/Bun.spawn/stdin/stringWidth/bun:sqlite replaced with
      yaml@2.9.1, node:http adapter, node:child_process, string-width@8.1.0,
      dual-driver lazy bun:sqlite|node:sqlite lock. Identical 167-test suite
      green in-process on Bun 1.3.9 (bun test + PP_REQUIRE_UI_TESTS=1) and Node
      (vitest 5.1.1 + UI incl. Chromium, PTY, Beads, MCP, hub restart).
      Cold-start medians (30 runs, 5 warmups, Bun 1.3.9, same session): source
      50.3ms (--version) / 73.5ms (summary); bun dist/cli.js 30.3/55.2 (faster
      than source, no regression); node dist 66.3/86.6. Anchors consult current
      source."
---
Replaces Bun-only runtime calls (Bun.YAML, Bun.serve, Bun.spawn/stdin) with portable Node.js 24+ APIs and a lightweight YAML library while retaining full Bun support.
