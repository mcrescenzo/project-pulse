# Repository Agent Instructions

## Validation & Launch
- **Tests:** `bun test`
- **Typecheck:** `bun run typecheck`
- **CLI entrypoint:** `bun run src/cli.ts <command>` (exposes `project-pulse` and `pp` in `package.json` `bin`)
- **Dashboard:** `bun run src/cli.ts view --no-open`
- **MCP server:** `bun run src/cli.ts mcp`

## Git Workflow
- Trunk branch: `main`
- Make changes on short-lived task branches (linked git worktrees work well) and integrate onto `main` via pull requests with green CI.
- Run `bun run typecheck` and `bun test` before committing.

## Project Roadmap (`project-pulse` / `pp`)

High-level milestones and features live in `.project-pulse/` and compile into `ROADMAP.md`.
- **Golden rule:** Never edit `ROADMAP.md` or `.project-pulse/*.md` by hand — use `pp` CLI commands or `pp mcp`.
- **Orient:** Run `pp summary` (or `pp show <feature-id> --beads`) at session start for strategic context.
- **Update progress:** Use `pp feature check <id> <criterion>`, `pp feature note <id> "<note>"`, and `pp feature update <id> --status <status>`.
- **Validate:** Run `pp check` before wrapping up to confirm schema integrity (add `--beads` if you use Beads locally to check issue alignment).
