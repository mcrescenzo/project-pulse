---
id: public-release-security-audit
title: Public Release Security & Privacy Audit
milestone: v0.5
order: 10
status: planned
area: Security
depends_on:
  - dashboard-polish-security
  - multi-project-hub
  - tui-interactive-drawer
refs:
  - bd:pp-4cq.1
  - bd:pp-4cq.3
ship_criteria:
  - id: audits-source-docs-and
    text: "Audits source, docs, and git history for leaked secrets, hardcoded local paths, or private environment assumptions"
    done: false
  - id: verifies-xss-csrf-path
    text: "Verifies XSS, CSRF, path-traversal, and subprocess argument safety across CLI, MCP, and local hub server"
    done: false
  - id: documents-audit-checklist-result
    text: Documents audit checklist results and resolves all high/medium findings
    done: false
  - id: rewrites-git-history-to
    text: Rewrites git history to the GitHub noreply identity and pins the repo-local author email
    done: false
  - id: hardens-view-and-hub
    text: "Hardens view and hub servers with Host validation on all routes, a local access secret, and anti-framing headers"
    done: false
updates:
  []
---
Audits source code, dependencies, tests, docs, and git history to confirm the repository is safe for public open-source release.
