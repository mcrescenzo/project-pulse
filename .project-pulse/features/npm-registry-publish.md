---
id: npm-registry-publish
title: Public NPM Registry Publish & Release Automation
milestone: v1.0
order: 30
status: shipped
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
    done: true
  - id: verifies-single-command-npx
    text: Verifies single-command npx project-pulse and npm i -g project-pulse on
      fresh Node.js and Bun environments
    done: true
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
  - at: 2026-11-24T15:58:34.301Z
    note: "Stable publication attempt (2026-11-24): unchanged tag v1.0.0 →
      d24b75a64ffddb485af13e846e4f14d09c77d983. GitHub run 45428240758 (attempt
      2) passed the release gates and received maintainer approval, but npm
      interpreted the relative tarball path as a GitHub Git spec and failed
      before upload. Registry readback: 1.0.0 absent; latest and next both
      1.0.0-rc.1. PR #16 (f7865b1) fixed the absolute tarball path; the offline
      publish dry run passed in CI run 45430900209. GitHub release protections
      remain configured. Revalidate the npm trusted-publisher binding before the
      next release; npm expires new bindings after two days without a successful
      publish. Maintainer chose workflow repair only: no new version or tag, and
      stable publish, provenance, and clean registry install proofs remain
      open."
  - at: 2026-11-24T16:42:52.509Z
    note: "Stable npm release verified (2026-11-24): project-pulse@1.0.1 published
      via GitHub Actions run 45438992543 from v1.0.1 at
      0e34e7a20efe8d92076b47e27a61f9508568a07b. Public registry latest=1.0.1,
      next=1.0.0-rc.1. Downloaded tarball matched CI and local artifact byte for
      byte; SRI
      sha512-yPaiDsBHP0v6cucU0Y8GAOMpuZX+gxJQyWafMjnXSUS8LjhR9AGXWNqcMzcnh/OBwB\
      Juv0K3VgocaCtAN7NsqQ==. npm audit signatures verified npm signatures and
      SLSA provenance; the subject digest matched the tarball and the source
      matched that tag and commit (Sigstore log index 4082487925). Both pinned
      and unversioned registry installs passed on Node 24.0.0 and 24.22.2
      without Bun, and Bun 1.3.0 without Node. Both CLI aliases, persisted note
      readback, roadmap check, and MCP initialize passed. The stable release is
      1.0.1; v1.0.0 was not moved."
---
Publishes project-pulse to npmjs.com with automated tag-driven releases, provenance attestation, and verified single-command installation.
