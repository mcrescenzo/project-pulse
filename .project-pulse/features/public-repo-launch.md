---
id: public-repo-launch
title: Public GitHub Repository Launch
milestone: v0.4
order: 30
status: planned
area: Release
depends_on: 
  - oss-docs-and-ci
refs: 
  []
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
updates: 
  []
---
Publishes the audited repository to GitHub with clean metadata, branch protection, issue templates, and public visibility.
