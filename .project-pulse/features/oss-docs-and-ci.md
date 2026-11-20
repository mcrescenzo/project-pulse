---
id: oss-docs-and-ci
title: "Open-Source Documentation, Licensing & CI"
milestone: v0.5
order: 20
status: planned
area: Docs
depends_on:
  - public-release-security-audit
  - typecheck-baseline
refs:
  - bd:pp-4cq.4
ship_criteria:
  - id: adds-mit-license-contributing
    text: "Adds MIT LICENSE, CONTRIBUTING.md, and SECURITY.md tailored to Project Pulse"
    done: false
  - id: polishes-readme-md-with
    text: "Polishes README.md with quickstart, CLI/MCP usage, and up-to-date dashboard screenshots"
    done: false
  - id: adds-github-actions-ci
    text: "Adds GitHub Actions CI workflow running tests, typechecks, and pp check on PRs and main"
    done: false
  - id: completes-package-json-public
    text: "Completes package.json public metadata (license, repository, homepage, bugs, engines, keywords)"
    done: false
  - id: replaces-stale-spec-md
    text: Replaces stale SPEC.md with docs/architecture.md and generalizes AGENTS.md for contributors
    done: false
  - id: generates-changelog-md-via
    text: Generates CHANGELOG.md via pp changelog --all
    done: false
updates:
  []
---
Adds open-source license, contribution and security policies, polished README with screenshots, and automated GitHub Actions CI.
