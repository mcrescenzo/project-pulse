---
id: npm-package-build
title: NPM Package Build & Clean-Install Verification
milestone: v1.0
order: 20
status: shipped
area: Release
depends_on:
  - node-runtime-portability
refs: []
ship_criteria:
  - id: builds-dist-cli-js
    text: "Builds dist/cli.js with #!/usr/bin/env node and clean package.json bin,
      files, and engines fields"
    done: true
  - id: verifies-npm-pack-tarball
    text: Verifies npm pack tarball contents exclude repo-only scratch/test artifacts
    done: true
  - id: passes-clean-environment-smoke
    text: Passes clean-environment smoke tests for npx, npm i -g, and bunx installs
    done: true
updates:
  - at: 2026-11-23T19:35:11.527Z
    note: "Packaging evidence (harness: omp, machine: ws, profile: default; commits
      5e1f005da7 + RC): npm pack (npm 11.20.0, --ignore-scripts) ships exactly
      LICENSE, README.md, package.json, dist/cli.js,
      dist/THIRD-PARTY-NOTICES.txt (151,290 bytes; no
      sources/tests/roadmap/node_modules/sourcemaps). RC 1.0.0-rc.1 SRI
      sha512-Y/IdR9nG3QuK9L4P6iV3Z1/FepGUZ3o+kOgZ6S1bVutPkRxYx11JT6xGMFGxw5jYcs\
      eyD+2ZPb0j9KgCH/mAHg==. Consumer proofs from the packed bytes, fresh
      HOME/cache/prefix/PROJECT_PULSE_HOME: Node 24.0.0 floor and 24.22.2 LTS
      without bun on PATH (npx --package=TGZ, npm i -g, both bin aliases,
      init/note/readback/summary/check, single-line MCP initialize id:1); Bun
      1.3.9 with node absent from an isolated PATH (bun add + bunx --bun
      --no-install project-pulse and pp). Bun 1.3.0 floor execution covered by
      CI dist smoke."
---
Produces a clean bundled dist/cli.js package with Node shebang and verifies local npm pack installs across Node.js and Bun.
