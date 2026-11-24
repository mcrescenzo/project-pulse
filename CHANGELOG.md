# Project Pulse — Release Notes

## v2.0.0 — Unified onboarding

- `pp init` replaces `pp setup`. It previews roadmap initialization and lets you opt into `AGENTS.md`, a repo-local skill, and `.mcp.json` independently. Scripts can use `--non-interactive` or `--json` with the `--with-*` flags.
- Agent guidance includes the Beads workflow only in repos with a supported local Beads marker and an enabled integration.

**Migration:** Replace `pp setup --mcp .mcp.json --with-skill` with `pp init --non-interactive --with-agents --with-mcp --with-skill`. Omit any `--with-*` flags you don't need. The old `setup` command and its custom output path flags are no longer supported.

## v0.1 — Core Foundation (2026-Q4)

Initial release providing the .project-pulse/ store, CLI, ROADMAP.md compiler, Beads drift resolver, MCP server, and local browser dashboard.

### Shipped
- **Atomic Roadmap Store & Validator** (`atomic-roadmap-store`) — *Core · bd:pp-33l.1*
  - Conflict-free Markdown + YAML storage layer and deterministic ROADMAP.md compilation.
  - [x] Canonical frontmatter parser/serializer in .project-pulse/
  - [x] DAG cycle & altitude validation with deterministic ROADMAP.md compiler
- **Milestone & Feature Authoring CLI** (`authoring-cli`) — *CLI · bd:pp-33l.2*
  - CLI authoring commands for milestones, features, ship criteria, and pulse logs.
  - [x] Milestone and feature CRUD commands auto-regenerate ROADMAP.md
  - [x] Ship criteria checkboxes and timestamped pulse notes work via CLI
- **Orientation Views & Beads Drift Resolver** (`orientation-and-beads`) — *Integrations · bd:pp-33l.3*
  - Fast orientation summaries and optional read-only Beads drift checks.
  - [x] Token-lean pp summary (<500 words) and detailed pp show
  - [x] Read-only bd show resolution with drift detection and graceful fallback
- **Stdio MCP Server & Onboarding** (`mcp-server`) — *Agent · bd:pp-33l.4*
  - Thin stdio MCP interface over the core RoadmapService.
  - [x] Stdio JSON-RPC 2.0 server exposes all 6 roadmap tools
  - [x] pp init --agents-snippet prints agent onboarding rules
- **Live-Reloading Local Browser Dashboard** (`local-browser-view`) — *UI · bd:pp-33l.5*
  - Localhost web viewer powered by Bun.serve with file-watch live reload.
  - [x] Interactive dashboard groups features by milestone with filters and detail drawer
  - [x] SSE live-reload and quick-actions persist to .project-pulse/ and ROADMAP.md

## v0.2 — Hardening & UX Polish (2027-Q1)

Codebase and UI review fixes: CLI ergonomics, batched Beads resolution, localhost CSRF protection, dashboard accessibility, and Playwright regression tests.

### Shipped
- **CLI Ergonomics & Core Store Hardening** (`cli-core-hardening`) — *CLI · bd:pp-01q.1*
  - Upward .project-pulse/ discovery, strict flag parsing, non-destructive criteria edits, default summary, remove commands, clean YAML, and resilient checks.
  - [x] Discovers .project-pulse/ upward from any nested subdirectory
  - [x] Rejects unknown CLI flags with clear errors instead of swallowing them
  - [x] Supports --add-criterion, --remove-criterion, feature/milestone remove, bare pp summary, and --no-beads
  - [x] Emits whitespace-clean YAML, handles malformed config.yaml in pp check, and deduplicates self-dependency cycle errors
- **Batched & Cached Beads Resolution** (`beads-resolution-perf`) — *Integrations · bd:pp-01q.2*
  - Eliminates serial N+1 bd show subprocess calls via batched lookup and per-invocation caching across CLI and dashboard endpoints.
  - [x] Resolves multiple unique Beads refs via batched lookup with per-invocation cache
  - [x] Speeds up pp check --beads, pp show, and /api/roadmap without stale cross-run cache state
  - [x] Covers multi-ref caching and partial missing-id behavior in unit tests
- **Dashboard Security, Accessibility & Visual Polish** (`dashboard-polish-security`) — *UI · bd:pp-01q.3*
  - Hardens localhost mutations against CSRF, makes cards and drawer fully keyboard/ARIA accessible, preserves drafts across SSE reloads, and polishes visual hierarchy.
  - [x] Enforces localhost Origin/Host and application/json checks on POST /api/features/:id/pulse
  - [x] Provides keyboard-accessible cards, ARIA dialog drawer with Escape-to-close, labeled filters, and inline saving feedback
  - [x] Preserves unsaved drawer drafts across SSE reloads and adds clickable health/drift popover and light/dark theme toggle
  - [x] Shows 1-line card descriptions with reduced tag noise, serves inline favicon, fixes mobile KPI grid, and adds Playwright UI regression tests

## v0.3 — Multi-Project Hub & Workflow Views

Auto-joining local hub for parallel projects, alternate dashboard views, activity digests, one-command agent repo setup, and static HTML export.

### Shipped
- **Auto-Joining Multi-Project Local Hub** (`multi-project-hub`) — *UI · bd:pp-rrp.2*
  - Lets pp view start or join a shared local hub on 127.0.0.1:4310 so parallel repositories each get their own /p/<slug> URL, watcher, and project switcher.
  - [x] Running pp view in multiple repos auto-registers each repo on one hub port under /p/<slug> with isolated file watchers and SSE streams
  - [x] Includes a header project switcher, a / portfolio overview page, and stale-path cleanup
  - [x] Supports --standalone fallback to run an isolated single-repo server
- **Interactive Dependency Graph & Status Board Views** (`dashboard-view-modes`) — *UI · bd:pp-rrp.1*
  - Adds switchable Feature DAG dependency graph and Status Board views alongside the default Milestone Cards view in pp view.
  - [x] Switches cleanly between Milestone Cards, interactive Feature DAG Graph, and Status Board views
  - [x] Highlights upstream/downstream dependencies on hover or focus in Graph view
  - [x] Shares active filters, search, and the feature detail drawer across all views
- **Roadmap Activity Digest & Release Changelog** (`activity-digest-changelog`) — *CLI · bd:pp-rrp.4*
  - Compiles concise progress digests and release notes from roadmap updates, shipped features, and git history since a date, tag, or milestone.
  - [x] pp digest summarizes shipped features, status movement, completed criteria, and notes since a date or git ref
  - [x] pp changelog generates clean Markdown release notes for a milestone with --json support
  - [x] Works gracefully in repos with minimal or unannotated git history
- **One-Command Agent Onboarding & Repo Setup** (`agent-repo-setup`) — *Agent · bd:pp-rrp.5*
  - Provides pp setup to wire AGENTS.md guidance, agent skill files, and MCP server config into any repository idempotently.
  - [x] pp setup initializes or updates AGENTS.md roadmap instructions without clobbering user content
  - [x] Installs or prints ready-to-use MCP client config and optional agent skill templates
  - [x] Supports --dry-run and idempotent re-runs verified by automated tests
- **Self-Contained Static HTML Export** (`static-html-export`) — *UI · bd:pp-rrp.3*
  - Generates a single self-contained offline HTML roadmap snapshot from .project-pulse/ for sharing without a local server.
  - [x] pp export --html writes a single standalone HTML file with zero external network dependencies
  - [x] Preserves milestone grouping, filters, search, theme toggle, and read-only detail drawer offline
  - [x] Supports --out <path> and deterministic output verified by tests

## v0.4 — Interactive Terminal Dashboard (TUI)

Zero-dependency mouse-and-keyboard terminal dashboard (pp view --tui) with Milestone Cards, Waterfall Dependency Graph, Status Board, and interactive Detail Drawer.

### Shipped
- **TUI Core Engine & CLI Entrypoint** (`tui-core-engine`) — *UI · bd:pp-02n.1*
  - Zero-dependency 2D cell-buffer renderer, SGR mouse/key parser, escape sanitizer, OSC 52 copy, and pp view --tui CLI wiring.
  - [x] Zero-dependency 2D cell-buffer renderer with ANSI diffing, synchronized output, color/NO_COLOR auto-detection, and escape sanitization
  - [x] Stateful keyboard and SGR mouse input decoder with z-indexed hit-test regions, OSC 52 copy, and guaranteed raw-mode/alt-screen teardown
  - [x] Explicit pp view --tui [--no-beads] CLI wiring rejecting non-TTY sessions and incompatible HTTP flags
- **TUI Views, Filters & Health Diagnostics** (`tui-views-and-filters`) — *UI · bd:pp-02n.2*
  - Header, KPI strip, Health & Drift overlay, clickable filter pickers, / search, responsive Milestone Cards, and Status Board columns.
  - [x] Header, KPI strip, clickable Health & Drift overlay with jump-to-feature, and shared view/filter bar with floating pickers and / search
  - [x] Responsive 1-3 column Milestone Cards view hiding empty milestones when filtering and Status Board columns with keyboard and wheel scrolling
  - [x] Virtual screen-buffer test suite covering filters, view switching, scrolling, and health diagnostics
- **TUI Waterfall Dependency Graph** (`tui-waterfall-graph`) — *UI · bd:pp-02n.3*
  - Top-to-bottom orthogonal waterfall DAG with 3 discrete density zoom levels, click-and-drag panning, and dependency chain highlighting.
  - [x] Top-to-bottom orthogonal waterfall DAG with parent-barycenter ordering and 3 discrete density zoom levels (Full, Compact, Overview/Fit)
  - [x] Click-and-drag panning with drag threshold, wheel/+/-/0/F zoom controls, and expanded viewport height in Graph mode
  - [x] Hover OFF by default over SSH (click once to trace amber upstream / green downstream, click again or Enter to open drawer) plus optional Hover toggle
- **TUI Interactive Detail Drawer & Live Watch** (`tui-interactive-drawer`) — *UI · bd:pp-02n.4*
  - Responsive split/modal Feature Detail Drawer with criteria/status/note persistence, debounced fs.watch reload, async Beads refresh, and PTY smoke test.
  - [x] Responsive split-pane (>= 120 cols) and full-height modal (< 120 cols) Feature Detail Drawer with status pills, criteria toggles, Depends On jumps, and draft-preserving pulse notes
  - [x] Instant first paint from disk with non-blocking async Beads refresh, debounced fs.watch live reload, m mouse toggle, y OSC 52 copy, and ? help overlay
  - [x] End-to-end virtual-buffer interaction tests and real headless PTY smoke test verifying alt-screen entry and clean exit restoration

## v0.5 — Open-Source Public Release

Security and privacy audit, open-source documentation and CI, and public GitHub repository launch.

### Shipped
- **TypeScript Typecheck Baseline & Test Hygiene** (`typecheck-baseline`) — *Core · bd:pp-4cq.2*
  - Installs TypeScript tooling, fixes all type errors, and deflakes timing-sensitive tests so CI can enforce typechecks.
  - [x] Adds typescript and @types/bun dev dependencies matching Bun 1.3 plus a typecheck script
  - [x] tsc --noEmit passes with zero errors across src and tests
  - [x] Replaces fixed-sleep and silent-skip tests with deterministic polling or visible skips
- **Public Release Security & Privacy Audit** (`public-release-security-audit`) — *Security · bd:pp-4cq.1, bd:pp-4cq.3*
  - Audits source code, dependencies, tests, docs, and git history to confirm the repository is safe for public open-source release.
  - [x] Audits source, docs, and git history for leaked secrets, hardcoded local paths, or private environment assumptions
  - [x] Verifies XSS, CSRF, path-traversal, and subprocess argument safety across CLI, MCP, and local hub server
  - [x] Documents audit checklist results and resolves all high/medium findings
  - [x] Rewrites git history to the GitHub noreply identity and pins the repo-local author email
  - [x] Hardens view and hub servers with Host validation on all routes, a local access secret, and anti-framing headers
- **Open-Source Documentation, Licensing & CI** (`oss-docs-and-ci`) — *Docs · bd:pp-4cq.4*
  - Adds open-source license, contribution and security policies, polished README with screenshots, and automated GitHub Actions CI.
  - [x] Adds MIT LICENSE, CONTRIBUTING.md, and SECURITY.md tailored to Project Pulse
  - [x] Polishes README.md with quickstart, CLI/MCP usage, and up-to-date dashboard screenshots
  - [x] Adds GitHub Actions CI workflow running tests, typechecks, and pp check on PRs and main
  - [x] Completes package.json public metadata (license, repository, homepage, bugs, engines, keywords)
  - [x] Replaces stale SPEC.md with docs/architecture.md and generalizes AGENTS.md for contributors
  - [x] Generates CHANGELOG.md via pp changelog --all
- **Public GitHub Repository Launch** (`public-repo-launch`) — *Release · bd:pp-4cq.5, bd:pp-4cq.6*
  - Publishes the audited repository to GitHub with clean metadata, branch protection, issue templates, and public visibility.
  - [x] Configures GitHub remote, repo metadata/topics, issue templates, and main branch protection
  - [x] Verifies clean fresh clone, test run, and pp view launch from the published repository
  - [x] Switches GitHub repository visibility to public with green CI on main
  - [x] Bumps to 0.5.0, tags v0.5.0, and publishes a GitHub Release from pp changelog v0.5

## v1.0 — NPM Package Distribution

Node.js 24+ and Bun runtime portability, bundled CLI packaging, and public npm release for single-command installation.

### Shipped
- **Node.js 24+ & Bun Dual-Runtime Portability** (`node-runtime-portability`) — *Core*
  - Replaces Bun-only runtime calls (Bun.YAML, Bun.serve, Bun.spawn/stdin) with portable Node.js 24+ APIs and a lightweight YAML library while retaining full Bun support.
  - [x] Preserves fast startup and clean zero-bloat dependency footprint
  - [x] Replaces Bun.YAML, Bun.serve, and Bun.spawn/Bun.stdin with portable Node.js 24+ APIs and a lightweight YAML parser
  - [x] Passes full CLI, MCP, hub server, and Beads test suites under both Node.js 24+ and Bun
- **NPM Package Build & Clean-Install Verification** (`npm-package-build`) — *Release*
  - Produces a clean bundled dist/cli.js package with Node shebang and verifies local npm pack installs across Node.js and Bun.
  - [x] Builds dist/cli.js with #!/usr/bin/env node and clean package.json bin, files, and engines fields
  - [x] Verifies npm pack tarball contents exclude repo-only scratch/test artifacts
  - [x] Passes clean-environment smoke tests for npx, npm i -g, and bunx installs
- **Public NPM Registry Publish & Release Automation** (`npm-registry-publish`) — *Release*
  - Publishes project-pulse to npmjs.com with automated tag-driven releases, provenance attestation, and verified single-command installation.
  - [x] Confirms npm package name availability and configures tag-driven publish workflow with npm provenance
  - [x] Publishes v1.0 release to npmjs.com linked to the public GitHub repository
  - [x] Verifies single-command npx project-pulse and npm i -g project-pulse on fresh Node.js and Bun environments
