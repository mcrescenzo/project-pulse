# Project Pulse Architecture

Project Pulse keeps a project's high-level roadmap in the repository as small Markdown files. Every interface (CLI, MCP, browser dashboard, terminal UI) reads and writes that one store, and every write regenerates `ROADMAP.md`.

```text
                 ┌──────────── .project-pulse/ (source of truth) ────────────┐
                 │  config.yaml   milestones/<id>.md   features/<id>.md       │
                 └───────────────────────────▲───────────────────────────────┘
                                             │ validate → atomic write → render
                          RoadmapService (src/store.ts) ──► ROADMAP.md (generated)
        ┌───────────────┬───────────────┬────┴──────────┬────────────────┬───────────────┐
   pp CLI (cli.ts)  pp mcp (mcp.ts)  pp view hub/     pp view --tui     pp export /
                                    standalone       (src/tui/*)       digest / changelog
                                    (hub.ts, view.ts)
                          optional, read-only: bd (Beads) via beads.ts
```

## On-disk layout

```text
<repo-root>/
├── .project-pulse/
│   ├── config.yaml
│   ├── milestones/<milestone-id>.md
│   └── features/<feature-id>.md
└── ROADMAP.md      # generated on every write; never edit by hand
```

## Store schema

### Config: `.project-pulse/config.yaml`

```yaml
version: 1
project:
  name: Project Pulse
  summary: Repo-native high-level product roadmap for developers and AI agents.
defaults:
  milestone: backlog          # Fallback bucket when a feature has no explicit milestone
integrations:
  beads:
    enabled: true             # Optional read-only 'bd' resolution for bd:<id> refs
```

### Milestone File: `.project-pulse/milestones/<id>.md`

YAML frontmatter + concise Markdown summary of the release goal:

```markdown
---
id: v0.1
title: "v0.1 — Core Foundation"
order: 10
status: active                # planned | active | shipped | archived
target: "2026-Q4"             # Optional freeform target label or date
---
Initial release covering the repo-native schema, CLI, auto-rendered `ROADMAP.md`, and local browser view.
```

### Feature File: `.project-pulse/features/<id>.md`

Strict 2-level hierarchy (`Milestone` -> `Feature`). Features contain 2–5 outcome-level `ship_criteria` (no nested subtasks, assignees, or story points) and an append-only `updates` pulse log:

```markdown
---
id: core-schema
title: Atomic Roadmap Store & Validator
milestone: v0.1
order: 10
status: in-progress           # planned | in-progress | shipped | paused | cut
area: Core                    # Optional category/pillar tag
depends_on: []                # Optional array of feature IDs (e.g., [auth-core])
refs:                         # Optional tracker-agnostic external pointers
  - bd:pp-12
  - gh:#4
ship_criteria:
  - id: parse-validate
    text: Reads and validates .project-pulse/ config, milestones, and features with helpful errors
    done: true
  - id: atomic-write
    text: Mutates feature/milestone files atomically and auto-regenerates root ROADMAP.md
    done: false
updates:
  - at: "2026-11-19T23:15:00Z"
    note: Initial schema contract finalized
---
Provides the conflict-free `.project-pulse/` storage layer and deterministic `ROADMAP.md` compiler.
```

### Altitude Guardrails (validator rules)

- **2-level ceiling:** Only Milestones and Features exist. No sub-features or nested task trees.
- **Ship criteria bounds:** Validator warns if a feature exceeds 6 `ship_criteria` items (nudging tactical breakdown into Beads).
- **Graph integrity:** Every feature's `milestone` must reference an existing milestone ID (or `backlog`), and every ID in `depends_on` must reference an existing feature ID with no cycles.

## Modules

| Module | Responsibility |
|---|---|
| `src/store.ts` | `RoadmapService`: loads, validates, mutates, and renders the store. All writes go through `writeFileAtomic` (temp file + rename; keeps symlinks and file modes). |
| `src/validator.ts` | Schema checks, the milestone→feature hierarchy, dependency-cycle detection, the ship-criteria guardrail, and `ROADMAP.md` sync checks. |
| `src/renderer.ts` | Deterministic `ROADMAP.md` compiler. |
| `src/frontmatter.ts` | YAML frontmatter parsing and serialization (`Bun.YAML`). |
| `src/cli.ts`, `src/cli-main.ts` | `pp` / `project-pulse` entry point, argument parsing, command dispatch, and the terminal `init` walkthrough. |
| `src/mcp.ts` | Stdio JSON-RPC MCP server. Tools: `roadmap_summary`, `roadmap_show_feature`, `roadmap_upsert_milestone`, `roadmap_upsert_feature`, `roadmap_log_pulse`, `roadmap_check`. |
| `src/beads.ts` | Optional read-only Beads resolver. Batches `bd --readonly show --json -- <ids>` calls, caches results, and detects drift between feature status and issue state. |
| `src/view.ts` | Per-project "slot": file watcher, SSE live reload, JSON API, quick-action handler. Also the standalone dashboard server. |
| `src/hub.ts` | Multi-project local hub. The first `pp view` starts it, and later ones register their repo with it (`/`, `/p/<slug>`). |
| `src/http-security.ts` | Host validation, access token and cookie handling, security headers, and safe URL helpers shared by the view and hub servers. |
| `src/dashboard-html.ts`, `src/dashboard/*` | Self-contained dashboard and hub pages, generated as one HTML string from modules: design tokens (`theme.ts`, see `DESIGN.md`), stylesheet, client script (Roadmap ledger, Graph, Activity, detail drawer) and the hub portfolio page. |
| `src/present.ts` | Shared vocabulary for web and TUI: view names, status labels, `n/m criteria`, short local timestamps, health text. |
| `src/activity.ts`, `src/git-history.ts` | Activity feed: dated events from successive committed roadmap states plus note timestamps and uncommitted edits; batched `git cat-file` reads shared with `pp digest`. |
| `src/export.ts` | `pp export --html`: a zero-network static snapshot (inline data, CSP-locked). |
| `src/digest.ts` | `pp digest` (git- or time-based activity diff) and `pp changelog` (release notes per milestone). |
| `src/setup.ts` | Prepares selected `pp init` writes, validates repo-local paths, and rechecks the preview before applying roadmap and agent-file changes. Writes are atomic per file, not across files. |
| `src/tui/*` | Dependency-free terminal UI: cell-buffer diff renderer (`screen.ts`), key and SGR mouse decoder (`input.ts`), views, waterfall graph, and drawer. |

## Local dashboard and hub

- `pp view` checks `http://127.0.0.1:4310/api/hub/health`.
  - If a Project Pulse hub answers, and its pid and port match the port's hub lock (`<state>/hub.json` for the default port, `<state>/hub.<port>.json` otherwise), `pp view` registers the repo with the hub token from that file and exits.
  - Otherwise it starts a new hub.
  - `pp view --standalone` runs an isolated single-project server instead.
- State lives in `~/.config/project-pulse/` (override with `PROJECT_PULSE_HOME`). The directory is mode 0700:
  - `hub.json`: pid, port, per-launch hub token (0600). Discovery is port-scoped: hubs on non-default ports use `hub.<port>.json` instead, so two hubs sharing the state directory never overwrite each other's discovery record, and a hub started with dynamic port 0 persists under its actual bound port.
  - `projects.json`: registered repo paths (0600). Scoped the same way (`projects.<port>.json` for non-default ports), so each hub's membership stays durable and a save on one hub never erases another hub's registrations.
  - `access-token`: persistent dashboard access token (0600)
- Browser access: `pp view` opens `…?t=<access-token>`. The server swaps the token for an `HttpOnly; SameSite=Strict` cookie and redirects to the clean URL. API clients can send `X-PP-Access-Token` instead.
- Every route checks the `Host` header. Mutations also go through the CSRF checks in `validateMutationRequest`.
- Each project slot watches only `.project-pulse/` and sends SSE `reload` events to its own clients.
- See [`SECURITY.md`](../SECURITY.md) and [`security-audit.md`](security-audit.md).

## Design guardrails

- **Altitude:** the store has milestones and features only. Granular tasks belong in an execution tracker such as Beads, which features link to with `bd:<id>` refs.
- **Determinism:** `ROADMAP.md` rendering is stable, so diffs stay reviewable and `pp check` can detect hand edits.
- **Read-only integrations:** Project Pulse never writes to Beads or other external trackers.
- **No runtime dependencies:** the CLI, servers, and TUI use only Bun and Node built-ins. `playwright-core` is a dev-only test dependency.

## Out of scope

- Hosted or cloud services and multi-user accounts.
- Two-way sync with external trackers.
- Sub-tasks, assignees, estimates, and sprint mechanics.
- Structural editing in the browser beyond quick actions (status, criteria, notes). Structural authoring belongs in the CLI and MCP.
