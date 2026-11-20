# Project Pulse (`project-pulse` / `pp`) — Specification

## Intent

Developers and AI coding agents working on large projects lose strategic orientation when planning lives only in granular execution trackers (like Beads) or in hand-maintained `ROADMAP.md` files that quickly rot or bloat into task lists. **Project Pulse** (`project-pulse` / `pp`) provides a repo-native, high-level product roadmap stored as atomic Markdown files in `.project-pulse/`, keeping an auto-generated root `ROADMAP.md`, a CLI (`project-pulse` / `pp`), an MCP server (`pp mcp`), optional read-only Beads (`bd`) progress/drift resolution, and a live-reloading local browser dashboard (`pp view`) in sync so humans and agents can see where the project stands at a glance.

---

## 1. On-Disk Architecture & File Schemas

All source-of-truth roadmap files live inside `.project-pulse/` in the repository root. Every mutation through the CLI, MCP server, or browser quick-actions validates schemas and automatically regenerates `/ROADMAP.md`.

```text
<repo-root>/
├── .project-pulse/
│   ├── config.yaml
│   ├── milestones/
│   │   ├── v0.1.md
│   │   └── v0.2.md
│   └── features/
│       ├── core-schema.md
│       └── local-web-view.md
└── ROADMAP.md                # Auto-generated on every write; never edited manually
```

### 1.1 `.project-pulse/config.yaml`

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

### 1.2 Milestone File: `.project-pulse/milestones/<id>.md`

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

### 1.3 Feature File: `.project-pulse/features/<id>.md`

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

### 1.4 Altitude Guardrails (Validator Rules)

- **2-level ceiling:** Only Milestones and Features exist. No sub-features or nested task trees.
- **Ship criteria bounds:** Validator warns if a feature exceeds 6 `ship_criteria` items (nudging tactical breakdown into Beads).
- **Graph integrity:** Every feature's `milestone` must reference an existing milestone ID (or `backlog`), and every ID in `depends_on` must reference an existing feature ID with no cycles.

---

## 2. CLI Contract (`project-pulse` & `pp`)

Built in TypeScript on **Bun**. Every read/write command supports `--json` for structured agent consumption. Every write command validates the store and regenerates `ROADMAP.md` before exiting.

| Command | Purpose |
| :--- | :--- |
| `pp init [--name <name>]` | Scaffolds `.project-pulse/`, generates initial `ROADMAP.md`, and optionally prints/writes an agent instruction snippet (`AGENTS.md` / skill hint). |
| `pp summary [--milestone <id>] [--json]` | **Primary agent & human orientation command.** Compact (<500 token default) overview of milestones, feature statuses, criteria completion counts, and latest pulse notes. |
| `pp show <feature-id> [--beads] [--json]` | Detailed view of a single feature: description, ship criteria, dependencies, update log, and (if `--beads` or configured) live read-only Beads status for `bd:*` refs. |
| `pp milestone add <id> --title <t> [--order <n>] [--status <s>] [--target <str>]` | Creates or updates a milestone and regenerates `ROADMAP.md`. |
| `pp milestone update <id> [--title <t>] [--order <n>] [--status <s>] [--target <str>]` | Updates milestone metadata and regenerates `ROADMAP.md`. |
| `pp feature add <id> --title <t> --milestone <m> [--area <a>] [--status <s>] [--order <n>] [--depends-on <ids>] [--criterion <text>...]` | Creates a new atomic feature file and regenerates `ROADMAP.md`. |
| `pp feature update <id> [--status <s>] [--milestone <m>] [--area <a>] [--order <n>] [--depends-on <ids>] [--add-ref <ref>] [--remove-ref <ref>]` | Updates feature fields and regenerates `ROADMAP.md`. |
| `pp feature check <feature-id> <criterion-id-or-index> [--done | --undone]` | Toggles a ship criterion checkbox on a feature and regenerates `ROADMAP.md`. |
| `pp feature note <feature-id> "<message>"` | Appends a timestamped update pulse to the feature and regenerates `ROADMAP.md`. |
| `pp render` | Explicitly compiles `.project-pulse/` into root `ROADMAP.md` (useful after git merges). |
| `pp check [--beads] [--json]` | Validates schema integrity, dependency DAG, `ROADMAP.md` freshness, and (when Beads resolution is enabled/available) flags drift between feature status and linked `bd:*` issues. |
| `pp view [--port <n>] [--no-open]` | Starts the local live-reloading browser dashboard and opens it for the developer. |
| `pp mcp` | Starts the stdio Model Context Protocol (MCP) server exposing the core operations. |

---

## 3. MCP Server Contract (`pp mcp`)

A thin stdio MCP wrapper over the same core domain service, keeping tool schemas small and token-efficient:

1. `roadmap_summary` — Returns the token-budgeted project pulse across milestones (optional `milestone` and `status` filters).
2. `roadmap_show_feature` — Returns full details for one feature ID, including optional live Beads resolution.
3. `roadmap_upsert_milestone` — Creates or updates a milestone and regenerates `ROADMAP.md`.
4. `roadmap_upsert_feature` — Creates or updates a feature (metadata, status, milestone, refs, dependencies, ship criteria) and regenerates `ROADMAP.md`.
5. `roadmap_log_pulse` — Toggles ship criteria, transitions status, and/or appends a timestamped update note to a feature, then regenerates `ROADMAP.md`.
6. `roadmap_check` — Runs schema validation and drift detection (including read-only Beads drift checks).

---

## 4. Beads & External Tracker Integration

- **Tracker-agnostic references:** `refs` accepts any `<namespace>:<id>` or URL string (`bd:pp-42`, `gh:#19`, `linear:ENG-102`).
- **Optional read-only Beads resolver:** For refs prefixed with `bd:`, when `bd` is installed in `PATH` and enabled in config (or `--beads` is passed):
  - Executes `bd show <id> --json` (read-only, safe argv invocation with a short timeout; degrades gracefully if `bd` is unavailable).
  - Surfaces linked status/progress in `pp show`, `pp check`, and `pp view`.
  - **Drift checks (`pp check --beads`):**
    - Linked Bead is closed/done while roadmap feature is still `planned` or `in-progress`.
    - Roadmap feature is `in-progress` while all linked Beads remain untouched/open or missing.
    - Roadmap feature is `shipped` while a linked Bead is still open.

---

## 5. Local Browser Dashboard Contract (`pp view`)

A localhost HTTP + Server-Sent Events (or WebSocket) server powered by Bun that gives local developers a "project website roadmap" experience:

- **Layout:** Release milestones organized sequentially (with progress rollups and status badges), displaying feature cards grouped under each milestone (plus a `Backlog` / unassigned section if present).
- **Filtering & Views:** Filter by Milestone, Status (`planned`, `in-progress`, `shipped`, `paused`, `cut`), or Area tag; toggle dependency indicators (`depends_on`).
- **Feature Detail Drawer:** Clicking a feature opens its full description, checkable `ship_criteria`, dependency links, external tracker refs (with live Beads status badge when resolved), and chronological `updates` pulse log.
- **Lightweight Quick-Actions:**
  - Change feature `status` via dropdown.
  - Toggle individual `ship_criteria` checkboxes.
  - Add a timestamped pulse `note`.
  - All quick-actions call the local server API, which mutates `.project-pulse/features/<id>.md` atomically, regenerates `ROADMAP.md`, and pushes live updates to open browser tabs.
- **Live File Watcher:** Watching `.project-pulse/` automatically refreshes the browser UI whenever an agent or CLI command updates the roadmap in the terminal.

---

## 6. Acceptance Criteria

1. **Initialization & Atomic Storage:** Running `pp init` in a repository creates `.project-pulse/config.yaml`, `.project-pulse/milestones/`, `.project-pulse/features/`, and generates a valid root `ROADMAP.md`.
2. **Milestone & Feature CRUD + Auto-Sync:** Creating/updating milestones and features via `pp milestone ...` and `pp feature ...` writes valid frontmatter Markdown files under `.project-pulse/` and immediately updates `ROADMAP.md` to reflect the changes without manual `pp render`.
3. **Altitude & Graph Validation:** `pp check` fails with a non-zero exit code and actionable error message when a feature references a non-existent milestone, contains a circular or missing `depends_on` target, or when `ROADMAP.md` is out of sync with `.project-pulse/`; it emits a warning when a feature has more than 6 `ship_criteria`.
4. **Orientation Token Efficiency:** `pp summary` and `pp summary --json` output all milestones and features in a scannable format, and on a fixture of 15 features across 3 milestones, the default text summary remains under 500 words.
5. **Ship Criteria & Pulse Log:** `pp feature check <id> <criterion>` toggles the criterion's `done` state and `pp feature note <id> "<note>"` prepends/appends an ISO-8601 timestamped entry to `updates`, both regenerating `ROADMAP.md`.
6. **Beads Read-Only Drift Resolution:** Given a feature with `refs: ["bd:test-1"]`, `pp check --beads` (tested against a mock/stubbed `bd` binary or fixture) reports progress and flags drift when the linked bead state contradicts the feature status, and degrades cleanly without crashing when `bd` is absent.
7. **MCP Server Parity:** `pp mcp` responds to standard MCP JSON-RPC `tools/list` and `tools/call` requests over stdio for `roadmap_summary`, `roadmap_show_feature`, `roadmap_upsert_milestone`, `roadmap_upsert_feature`, `roadmap_log_pulse`, and `roadmap_check`, mutating `.project-pulse/` and regenerating `ROADMAP.md`.
8. **Live Browser Dashboard (`pp view`):** Starting `pp view` serves the roadmap UI over localhost, displays milestones and features matching `.project-pulse/`, live-reloads when a file in `.project-pulse/` changes, and persists quick-actions (status change, criterion checkbox toggle, adding a pulse note) back to `.project-pulse/features/<id>.md` and `ROADMAP.md`.

---

## 7. Out-of-Scope

- Hosted cloud service, multi-user authentication, or public website deployment tooling.
- Two-way writes into Beads (`bd create` / `bd close`) or GitHub Issues — external tracker adapters are strictly read-only.
- Granular task-management constructs: sub-tasks inside features, assignees, time tracking, story points, or sprint velocity charts.
- Full CRUD creation/deletion of milestones or drag-and-drop structural editing in the browser UI (structural authoring belongs in the CLI/MCP).

---

## 8. Constraints

- **Runtime & Stack:** TypeScript running on **Bun** (`bun test` for testing, `Bun.serve` for `pp view`, minimal dependencies).
- **Binary Names:** Package exposes both `project-pulse` and `pp` executables.
- **Storage Namespace:** Uses `.project-pulse/` (never `.pulse/`) to avoid collisions with PulseAudio and existing `.pulse` CLI tools.
- **Golden Rule for Agents:** All mutations go through CLI commands, MCP tools, or `pp view` API endpoints so frontmatter schemas and `ROADMAP.md` never corrupt or drift.
- **Deterministic Markdown Output:** `ROADMAP.md` generation must be deterministic (stable ordering by milestone `order` then ID, and feature `order` then ID) so git diffs remain minimal.

---

## 9. Test Seams, Risks & Unknowns

- **Primary Test Seam:** A pure TypeScript core domain module (`RoadmapStore` / `RoadmapService`) operating on an arbitrary root directory path (`rootDir`), allowing fast integration tests against temporary directories without mocking the filesystem.
- **Beads Subprocess Seam:** Inject a `BeadsClient` interface (defaulting to spawning `bd show <id> --json` with an argv array and timeout) so drift and progress resolution can be deterministically tested without requiring a live Dolt database in unit tests.
- **Risk — Concurrent edits / file watch loops:** In `pp view`, writing to `.project-pulse/` and `ROADMAP.md` triggers filesystem events. Mitigation: watch only `.project-pulse/` (not `ROADMAP.md`) and debounce watcher broadcasts.
- **Risk — Frontmatter formatting churn:** Round-tripping YAML frontmatter could reorder keys and cause noisy git diffs. Mitigation: serialize frontmatter keys in a fixed canonical schema order.

---

## 10. End-to-End Verification Step

Run an end-to-end verification flow in a temporary or dogfood directory:
1. Run `bun test` to execute unit and integration suites across store, renderer, CLI, Beads resolver, MCP stdio protocol, and HTTP server.
2. Dogfood `pp init` in the repository, add `v0.1` and the project's own features via `pp milestone add` and `pp feature add`, toggle a ship criterion via `pp feature check`, log a note via `pp feature note`, verify `pp check` passes and `ROADMAP.md` is cleanly rendered, exercise `pp mcp` via stdio JSON-RPC request/response, and start `pp view` to verify the HTTP endpoints and quick-action mutation round-trip.

---

## 11. Implementation Slices

Ordered as vertical tracer bullets, foundational-first:

1. **Slice 1 — Core Store, Schema Validator, Deterministic `ROADMAP.md` Renderer & CLI Foundation (`init`, `milestone`, `feature`, `render`, `check`):**
   - Implement canonical frontmatter parser/serializer, `.project-pulse/` store reader/writer, DAG + altitude validator, deterministic `ROADMAP.md` compiler, and core CLI commands with `--json` support.
   - *Verify:* Integration tests creating/mutating milestones & features in a temp dir and asserting exact file + `ROADMAP.md` output and `pp check` failure modes.
2. **Slice 2 — Orientation Commands (`summary`, `show`) & Read-Only Beads Resolver (`--beads` / drift detection):**
   - Implement token-lean `pp summary`, detailed `pp show <id>`, and the `bd:*` read-only resolver + drift checks in `pp check --beads`.
   - *Verify:* Integration tests for summary formatting, token budget, and Beads drift rules (with stubbed and real/absent `bd`).
3. **Slice 3 — MCP Server (`pp mcp`) & Agent Onboarding Snippet:**
   - Expose the core service over stdio MCP (`roadmap_summary`, `roadmap_show_feature`, `roadmap_upsert_milestone`, `roadmap_upsert_feature`, `roadmap_log_pulse`, `roadmap_check`) and include agent instructions in `pp init`.
   - *Verify:* Subprocess stdio JSON-RPC integration test calling each MCP tool and asserting `.project-pulse/` and `ROADMAP.md` updates.
4. **Slice 4 — Live-Reloading Local Browser Dashboard (`pp view`):**
   - Build the localhost `Bun.serve` viewer with SSE live-reload on `.project-pulse/` changes, milestone/feature cards, filters, detail drawer, and quick-action endpoints (status change, criterion checkbox toggle, pulse note).
   - *Verify:* HTTP API + SSE integration tests verifying rendering and quick-action persistence back to disk and `ROADMAP.md`, plus dogfooding `.project-pulse/` on this repository itself.
