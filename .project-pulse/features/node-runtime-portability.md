---
id: node-runtime-portability
title: Node.js 20+ & Bun Dual-Runtime Portability
milestone: v1.0
order: 10
status: planned
area: Core
depends_on: 
  - cli-core-hardening
  - multi-project-hub
refs: 
  []
ship_criteria: 
  - id: replaces-bun-yaml-bun
    text: "Replaces Bun.YAML, Bun.serve, and Bun.spawn/Bun.stdin with portable Node.js 20+ APIs and a lightweight YAML parser"
    done: false
  - id: passes-full-cli-mcp
    text: "Passes full CLI, MCP, hub server, and Beads test suites under both Node.js 20+ and Bun"
    done: false
  - id: preserves-fast-startup-and
    text: Preserves fast startup and clean zero-bloat dependency footprint
    done: false
updates: 
  []
---
Replaces Bun-only runtime calls (Bun.YAML, Bun.serve, Bun.spawn/stdin) with portable Node.js 20+ APIs and a lightweight YAML library while retaining full Bun support.
