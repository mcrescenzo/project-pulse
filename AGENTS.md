# Repository Agent Instructions

## Validation & Launch
- **Tests:** `bun test`
- **CLI entrypoint:** `bun run src/cli.ts <command>` (exposes `project-pulse` and `pp` in `package.json` `bin`)
- **Dashboard:** `bun run src/cli.ts view --no-open`
- **MCP server:** `bun run src/cli.ts mcp`

## Git Workflow
- Trunk branch: `main`
- Author changes on short-lived task branches in linked worktrees (`../project-pulse.worktrees/<branch-leaf>`) and integrate cleanly onto `main`.

## Project Roadmap (`project-pulse` / `pp`)

High-level milestones and features live in `.project-pulse/` and compile into `ROADMAP.md`.
- **Golden rule:** Never edit `ROADMAP.md` or `.project-pulse/*.md` by hand — use `pp` CLI commands or `pp mcp`.
- **Orient:** Run `pp summary` (or `pp show <feature-id> --beads`) at session start for strategic context.
- **Update progress:** Use `pp feature check <id> <criterion>`, `pp feature note <id> "<note>"`, and `pp feature update <id> --status <status>`.
- **Validate:** Run `pp check --beads` before wrapping up to confirm schema integrity and Beads alignment.
