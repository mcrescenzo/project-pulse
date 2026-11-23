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
    done: false
  - id: publishes-v1-0-release
    text: Publishes v1.0 release to npmjs.com linked to the public GitHub repository
    done: false
  - id: verifies-single-command-npx
    text: Verifies single-command npx project-pulse and npm i -g project-pulse on
      fresh Node.js and Bun environments
    done: false
updates: []
---
Publishes project-pulse to npmjs.com with automated tag-driven releases, provenance attestation, and verified single-command installation.
