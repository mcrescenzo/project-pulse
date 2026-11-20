---
id: oss-docs-and-ci
title: "Open-Source Documentation, Licensing & CI"
milestone: v0.5
order: 20
status: shipped
area: Docs
depends_on:
  - public-release-security-audit
  - typecheck-baseline
refs:
  - bd:pp-4cq.4
ship_criteria:
  - id: adds-mit-license-contributing
    text: "Adds MIT LICENSE, CONTRIBUTING.md, and SECURITY.md tailored to Project Pulse"
    done: true
  - id: polishes-readme-md-with
    text: "Polishes README.md with quickstart, CLI/MCP usage, and up-to-date dashboard screenshots"
    done: true
  - id: adds-github-actions-ci
    text: "Adds GitHub Actions CI workflow running tests, typechecks, and pp check on PRs and main"
    done: true
  - id: completes-package-json-public
    text: "Completes package.json public metadata (license, repository, homepage, bugs, engines, keywords)"
    done: true
  - id: replaces-stale-spec-md
    text: Replaces stale SPEC.md with docs/architecture.md and generalizes AGENTS.md for contributors
    done: true
  - id: generates-changelog-md-via
    text: Generates CHANGELOG.md via pp changelog --all
    done: true
updates:
  - at: 2026-11-20T21:26:28.500Z
    note: "CI green on first push (run 44820193755): typecheck, 60/60 tests with UI tests required (PP_REQUIRE_UI_TESTS=1, none skipped), pp check (pp-4cq.4)."
---
Adds open-source license, contribution and security policies, polished README with screenshots, and automated GitHub Actions CI.
