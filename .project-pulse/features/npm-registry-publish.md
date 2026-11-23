---
id: npm-registry-publish
title: Public NPM Registry Publish & Release Automation
milestone: v1.0
order: 30
status: in-progress
area: Release
depends_on:
  - npm-package-build
  - public-repo-launch
refs: []
ship_criteria:
  - id: confirms-npm-package-name
    text: Confirms npm package name availability and configures tag-driven publish
      workflow with npm provenance
    done: true
  - id: publishes-v1-0-release
    text: Publishes v1.0 release to npmjs.com linked to the public GitHub repository
    done: false
  - id: verifies-single-command-npx
    text: Verifies single-command npx project-pulse and npm i -g project-pulse on
      fresh Node.js and Bun environments
    done: false
updates:
  - at: 2026-11-23T19:41:38.725Z
    note: "Publish-prep evidence (harness: omp, machine: ws, profile: default;
      commit 5cf375a3a4): public registry read of project-pulse returns E404
      (name unclaimed); tag-driven workflow landed at
      .github/workflows/publish.yml (stable vX.Y.Z only, tag/manifest binding +
      origin/main reachability enforced, single build+pack on the tagged commit
      with read-only perms, SHA-512 recorded and re-verified in the
      environment-gated npm-release job, publish with --provenance
      --ignore-scripts on pinned npm 11.21.3, id-token: write only in that job,
      no npm token secret). CI and release runs share
      .github/workflows/checks.yml so a tag run cannot bypass the gate.
      Maintainer-side externals parked: create the npm-release environment with
      required review, restrict tag creation to authorized maintainers, bind the
      npm trusted publisher (owner mcrescenzo, repo project-pulse, filename
      publish.yml, environment npm-release) shortly before first publish, then
      publish 1.0.0-rc.1 manually with --tag next (the deliberate manual
      exception)."
---
Publishes project-pulse to npmjs.com with automated tag-driven releases, provenance attestation, and verified single-command installation.
