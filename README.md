# Project Pulse (`project-pulse` / `pp`)

A repo-native, high-level product roadmap for developers and AI coding agents.

Project Pulse keeps strategic milestones and core capabilities in atomic Markdown files under `.project-pulse/`, compiles a deterministic root `ROADMAP.md` on every change, exposes a CLI (`project-pulse` / `pp`) and stdio MCP server (`pp mcp`), provides optional read-only Beads (`bd`) drift detection, and serves a live-reloading local browser dashboard (`pp view`).

## Quick Start

Requires [Bun](https://bun.sh/) (`1.3+`).

```bash
# Link the 'project-pulse' and 'pp' binaries locally (optional)
bun link

# Or run directly via Bun
bun run src/cli.ts --help
```

Initialize a repository roadmap:

```bash
pp init --name "My Project" --summary "High-level roadmap."
pp milestone add v0.1 --title "v0.1 — Core Foundation" --status active --target "2026-Q4"
pp feature add offline-sync --title "Offline-First Sync" --milestone v0.1 --area Core \
  --criterion "Queue local changes offline" \
  --criterion "Reconcile cleanly on reconnect"
```

## Core Commands

| Command | Description |
| :--- | :--- |
| `pp init [--name <name>] [--agents-snippet]` | Scaffold `.project-pulse/`, generate `ROADMAP.md`, and optionally print `AGENTS.md` guidance. |
| `pp summary [--milestone <id>] [--status <s>] [--json]` | Token-lean overview of milestones, features, criteria progress, and latest pulse notes. |
| `pp show <feature-id> [--beads] [--json]` | Inspect one feature's description, criteria, dependencies, update log, and linked `bd:*` issues. |
| `pp milestone add\|update <id> ...` | Create or update a release milestone and regenerate `ROADMAP.md`. |
| `pp feature add\|update <id> ...` | Create or update a feature and regenerate `ROADMAP.md`. |
| `pp feature check <feature-id> <criterion> [--done\|--undone]` | Toggle or set a ship criterion checkbox and regenerate `ROADMAP.md`. |
| `pp feature note <feature-id> "<message>"` | Append a timestamped pulse update and regenerate `ROADMAP.md`. |
| `pp check [--beads] [--json]` | Validate schema integrity, dependency DAG, `ROADMAP.md` sync, and optional Beads drift. |
| `pp render` | Deterministically recompile `.project-pulse/` into `ROADMAP.md`. |
| `pp view [--port <n>] [--no-open]` | Launch the live-reloading local browser roadmap dashboard. |
| `pp mcp` | Start the stdio Model Context Protocol (MCP) server. |

## MCP Server Configuration

Configure `pp mcp` in your agent's MCP client config:

```json
{
  "mcpServers": {
    "project-pulse": {
      "command": "pp",
      "args": ["mcp"]
    }
  }
}
```

Exposed MCP tools: `roadmap_summary`, `roadmap_show_feature`, `roadmap_upsert_milestone`, `roadmap_upsert_feature`, `roadmap_log_pulse`, and `roadmap_check`.

## Validation

```bash
bun test
```
