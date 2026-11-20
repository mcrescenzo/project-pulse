---
id: agent-repo-setup
title: One-Command Agent Onboarding & Repo Setup
milestone: v0.3
order: 40
status: shipped
area: Agent
depends_on:
  - mcp-server
  - cli-core-hardening
refs:
  - bd:pp-rrp.5
ship_criteria:
  - id: pp-setup-initializes-or
    text: pp setup initializes or updates AGENTS.md roadmap instructions without clobbering user content
    done: true
  - id: installs-or-prints-ready
    text: Installs or prints ready-to-use MCP client config and optional agent skill templates
    done: true
  - id: supports-dry-run-and
    text: Supports --dry-run and idempotent re-runs verified by automated tests
    done: true
updates:
  - at: 2026-11-20T14:29:31.568Z
    note: "Implemented src/setup.ts and pp setup managing marker-delimited AGENTS.md instructions, MCP config merge, SKILL.md installation, --dry-run, and idempotent re-runs."
---
Provides pp setup to wire AGENTS.md guidance, agent skill files, and MCP server config into any repository idempotently.
