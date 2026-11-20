# Project Pulse (`project-pulse` / `pp`)

A repo-native, high-level product roadmap for developers and AI coding agents.

Project Pulse keeps strategic milestones and core capabilities in atomic Markdown files under `.project-pulse/`, compiles a deterministic root `ROADMAP.md` on every change, exposes a CLI (`project-pulse` / `pp`) and stdio MCP server (`pp mcp`), provides optional read-only Beads (`bd`) drift detection, and serves both a live-reloading browser dashboard (`pp view`) and an interactive terminal dashboard (`pp view --tui`).

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
| `pp` | Run `summary` if initialized, otherwise show help. |
| `pp init [--name <name>] [--agents-snippet]` | Scaffold `.project-pulse/`, generate `ROADMAP.md`, and optionally print `AGENTS.md` guidance. |
| `pp setup [--mcp <path>] [--with-skill] [--dry-run]` | Idempotently wire `AGENTS.md` instructions, MCP server config, and optional `SKILL.md` template. |
| `pp summary [--milestone <id>] [--status <s>] [--json]` | Token-lean overview of milestones, features, criteria progress, and latest pulse notes. |
| `pp show <feature-id> [--beads \| --no-beads] [--json]` | Inspect one feature's description, criteria, dependencies, update log, and linked `bd:*` issues. |
| `pp milestone add\|update\|remove <id> ...` | Create, update, or remove (with `--reassign`) a release milestone and regenerate `ROADMAP.md`. |
| `pp feature add\|update\|remove <id> ...` | Create, update (`--add-criterion` / `--remove-criterion`), or remove (`--force`) a feature and regenerate `ROADMAP.md`. |
| `pp feature check <feature-id> <criterion> [--done\|--undone]` | Toggle or set a ship criterion checkbox and regenerate `ROADMAP.md`. |
| `pp feature note <feature-id> "<message>"` | Append a timestamped pulse update and regenerate `ROADMAP.md`. |
| `pp digest [--since <date\|7d\|git-ref>] [--milestone <id>]` | Compile recent progress across shipped features, status movement, criteria, and notes. |
| `pp changelog [<milestone-id>] [--all] [--json]` | Generate Markdown release notes for a milestone or the entire roadmap. |
| `pp export --html [--out <path\|->] [--beads]` | Write a deterministic, zero-network standalone HTML roadmap snapshot. |
| `pp check [--beads] [--json]` | Validate schema integrity, dependency DAG, `ROADMAP.md` sync, and optional Beads drift. |
| `pp render` | Deterministically recompile `.project-pulse/` into `ROADMAP.md`. |
| `pp view [--port <n>] [--standalone] [--no-open]` | Start or join the auto-joining multi-project local hub (`/`, `/p/<slug>`), or run an isolated standalone server. |
| `pp view --tui [--no-beads]` | Launch the mouse-and-keyboard interactive terminal dashboard over SSH or local TTY. |
| `pp mcp` | Start the stdio Model Context Protocol (MCP) server. |

## Terminal Dashboard (`pp view --tui`)

Run the terminal UI inside any initialized repository (ideal over SSH or `tmux`):

```bash
pp view --tui [--no-beads]
```

- **Views & Filters:** Click tabs or press `1` (**Milestone Cards**), `2` (**Dependency Graph**), or `3` (**Status Board**); click filter pills (`M:`, `S:`, `A:`), press `/` for live search, or click `Reset`.
- **Waterfall Graph:** Top-to-bottom dependency DAG with **3 zoom densities** (`Full`, `Compact`, `Overview/Fit` via wheel, `+`/`-`, `0`, `F`, or toolbar buttons) and **click-and-drag** panning. Hover is OFF by default over SSH (click once to trace amber upstream / green downstream, click again or `Enter` to open the drawer; toggle live hover with `h`).
- **Interactive Drawer:** Opens as a right split-pane on wide terminals (`>= 120` cols) or centered modal on narrow panes (`< 120` cols). Update feature status, toggle ship criteria (`Space` or click), and log pulse notes (`n` + `Enter`) with automatic `.project-pulse/` + `ROADMAP.md` persistence and live `fs.watch` reload.
- **SSH Ergonomics:** Press `m` to toggle SGR mouse capture off/on for native terminal drag-selection, `y` to copy the active feature ID via OSC 52, `?` for shortcuts, and `q` to restore your terminal cleanly.

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
