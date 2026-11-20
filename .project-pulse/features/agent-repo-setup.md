---
id: agent-repo-setup
title: One-Command Agent Onboarding & Repo Setup
milestone: v0.3
order: 40
status: planned
area: Agent
depends_on: 
  - mcp-server
  - cli-core-hardening
refs: 
  []
ship_criteria: 
  - id: pp-setup-initializes-or
    text: pp setup initializes or updates AGENTS.md roadmap instructions without clobbering user content
    done: false
  - id: installs-or-prints-ready
    text: Installs or prints ready-to-use MCP client config and optional agent skill templates
    done: false
  - id: supports-dry-run-and
    text: Supports --dry-run and idempotent re-runs verified by automated tests
    done: false
updates: 
  []
---
Provides pp setup to wire AGENTS.md guidance, agent skill files, and MCP server config into any repository idempotently.
