---
id: public-repo-launch
title: Public GitHub Repository Launch
milestone: v0.5
order: 30
status: in-progress
area: Release
depends_on:
  - oss-docs-and-ci
refs:
  - bd:pp-4cq.5
  - bd:pp-4cq.6
ship_criteria:
  - id: configures-github-remote-repo
    text: "Configures GitHub remote, repo metadata/topics, issue templates, and main branch protection"
    done: false
  - id: verifies-clean-fresh-clone
    text: "Verifies clean fresh clone, test run, and pp view launch from the published repository"
    done: true
  - id: switches-github-repository-visib
    text: Switches GitHub repository visibility to public with green CI on main
    done: false
  - id: bumps-to-0-5
    text: "Bumps to 0.5.0, tags v0.5.0, and publishes a GitHub Release from pp changelog v0.5"
    done: false
updates:
  - at: 2026-11-20T21:26:29.312Z
    note: "Private repo mcrescenzo/project-pulse created with topics, wiki/projects off, squash/rebase merges, delete-branch-on-merge; fresh clone passes bun install, typecheck, 60/60 tests, and tokenized pp view (pp-4cq.5). Branch protection and private vulnerability reporting require the public flip."
---
Publishes the audited repository to GitHub with clean metadata, branch protection, issue templates, and public visibility.
