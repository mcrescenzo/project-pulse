---
id: mcp-server
title: Stdio MCP Server & Onboarding
milestone: v0.1
order: 40
status: shipped
area: Agent
depends_on: 
  - orientation-and-beads
refs: 
  - bd:pp-33l.4
ship_criteria: 
  - id: stdio-json-rpc-2
    text: Stdio JSON-RPC 2.0 server exposes all 6 roadmap tools
    done: true
  - id: pp-init-agents-snippet
    text: pp init --agents-snippet prints agent onboarding rules
    done: true
updates: 
  - at: 2026-11-20T04:52:42.373Z
    note: Stdio MCP server and AGENTS.md snippet shipped on main.
---
Thin stdio MCP interface over the core RoadmapService.
