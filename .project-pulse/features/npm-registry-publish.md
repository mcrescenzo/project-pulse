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
  - at: 2026-11-24T15:06:03.478Z
    note: "RC PUBLISHED AND VERIFIED (2026-11-24, harness: omp, machine: ws,
      profile: default; publish machine authenticated interactively as
      mcrescenzo via npm browser 2FA handshake — no tokens/OTPs in chat).
      project-pulse@1.0.0-rc.1 published with --tag next --ignore-scripts from
      the digest-verified rebuild of main 47abfa9 (file sha512
      1f90e1a2eed039db0316a1309b61efb2c41da936d22c48d92d0cd006d8f2a0e5315d70bf2\
      9531a0682acdd72745efb52b04b94e4470679854879cc6397c3a1b6). Registry
      readback: dist-tags {latest: 1.0.0-rc.1, next: 1.0.0-rc.1} — npm
      auto-assigns latest on a package FIRST publish regardless of --tag next;
      the stable tag-driven release repoints latest. repository.url =
      git+https://github.com/mcrescenzo/project-pulse.git. dist.integrity =
      sha512-H5Dhou7QOdsDFqEwm2HvssQdqTbSLEjZLQzQBtjyoOUxXXC/KVMaBoKs3XJ0XvtSsE\
      uU5EcGeYVIecxjl8Ohtg== — exact match with the consumer-proofed RC. No
      dist.attestations: correct, manual RCs carry no provenance. Registry
      consumer proofs at project-pulse@next, all 0 failures: Node 24.0.0 floor
      and 24.22.2 LTS without bun on PATH (npx --yes project-pulse@next, npm i
      -g, both aliases, fixture flow, MCP initialize) and Bun 1.3.9 with node
      absent (bun add @next + bunx --bun --no-install both aliases, fixture
      flow, MCP). Operational observations: npm new-package pipeline briefly
      serves a 0.0.0-stage placeholder packument (~5 min) before the real
      version appears; the tarball CDN entry cleared ~4 min after the packument
      (fresh installs 404 during that window). Criteria publishes-v1-0-release
      and verifies-single-command-npx remain OPEN until the stable v1.0.0
      tag-driven release with provenance is published and verified."
---
Publishes project-pulse to npmjs.com with automated tag-driven releases, provenance attestation, and verified single-command installation.
