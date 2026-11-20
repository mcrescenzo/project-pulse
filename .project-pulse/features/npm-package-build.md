---
id: npm-package-build
title: NPM Package Build & Clean-Install Verification
milestone: v1.0
order: 20
status: planned
area: Release
depends_on: 
  - node-runtime-portability
refs: 
  []
ship_criteria: 
  - id: builds-dist-cli-js
    text: "Builds dist/cli.js with #!/usr/bin/env node and clean package.json bin, files, and engines fields"
    done: false
  - id: verifies-npm-pack-tarball
    text: Verifies npm pack tarball contents exclude repo-only scratch/test artifacts
    done: false
  - id: passes-clean-environment-smoke
    text: "Passes clean-environment smoke tests for npx, npm i -g, and bunx installs"
    done: false
updates: 
  []
---
Produces a clean bundled dist/cli.js package with Node shebang and verifies local npm pack installs across Node.js and Bun.
