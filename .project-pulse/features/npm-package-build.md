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
  - at: 2026-11-23T19:41:02.766Z
    note: "FINAL artifact supersession (commits 157e080 + 3305651, runtime tip
      fb98f6e): the glyph-width memoization changed the bundle, superseding the
      SRI in the previous note. Final RC 1.0.0-rc.1: tarball 151,374 bytes, SRI
      sha512-H5Dhou7QOdsDFqEwm2HvssQdqTbSLEjZLQzQBtjyoOUxXXC/KVMaBoKs3XJ0XvtSsE\
      uU5EcGeYVIecxjl8Ohtg==, sha512 file digest
      1f90e1a2eed039db0316a1309b61efb2c41da936d22c48d92d0cd006d8f2a0e5315d70bf2\
      9531a0682acdd72745efb52b04b94e4470679854879cc6397c3a1b6. Same 5-file
      manifest; consumer proofs re-run green on Node 24.0.0 floor, Node 24.22.2
      LTS (no bun on PATH) and Bun 1.3.9 (node absent). This is the tested RC;
      the stable v1.0.0 artifact will be rebuilt by CI on the tagged commit and
      its digest verified there."
---
Produces a clean bundled dist/cli.js package with Node shebang and verifies local npm pack installs across Node.js and Bun.
