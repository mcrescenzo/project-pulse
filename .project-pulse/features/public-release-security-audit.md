---
id: public-release-security-audit
title: Public Release Security & Privacy Audit
milestone: v0.5
order: 10
status: shipped
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
    done: true
  - id: verifies-xss-csrf-path
    text: "Verifies XSS, CSRF, path-traversal, and subprocess argument safety across CLI, MCP, and local hub server"
    done: true
  - id: documents-audit-checklist-result
    text: Documents audit checklist results and resolves all high/medium findings
    done: true
  - id: rewrites-git-history-to
    text: Rewrites git history to the GitHub noreply identity and pins the repo-local author email
    done: true
  - id: hardens-view-and-hub
    text: "Hardens view and hub servers with Host validation on all routes, a local access secret, and anti-framing headers"
    done: true
updates:
  - at: 2026-11-20T21:12:38.831Z
    note: "History rewritten with git-filter-repo mailmap: all 44 commits now authored as the GitHub noreply identity; repo-local user.email pinned; pre-rewrite mirror kept locally outside the repo (pp-4cq.1)."
  - at: 2026-11-20T21:21:27.884Z
    note: "Audit complete (docs/security-audit.md): gitleaks clean on tree + 47-commit history; fixed H1 DNS rebinding, M1 access-token auth, M2 anti-framing headers, M3 opener/joined URL, M4 symlink/mode-preserving writes, M5 init overwrite guard, and L1-L6/L8/L10; L7/L9/L11 accepted and documented. 60 tests pass (pp-4cq.3)."
---
Audits source code, dependencies, tests, docs, and git history to confirm the repository is safe for public open-source release.
