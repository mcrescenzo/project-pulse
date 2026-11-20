---
id: public-repo-launch
title: Public GitHub Repository Launch
milestone: v0.5
order: 30
status: planned
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
    done: false
  - id: switches-github-repository-visib
    text: Switches GitHub repository visibility to public with green CI on main
    done: false
  - id: bumps-to-0-5
    text: "Bumps to 0.5.0, tags v0.5.0, and publishes a GitHub Release from pp changelog v0.5"
    done: false
updates:
  []
---
Publishes the audited repository to GitHub with clean metadata, branch protection, issue templates, and public visibility.
