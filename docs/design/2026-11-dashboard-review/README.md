# Dashboard design review (November 2026)

Evidence from the design review of `origin/main` 908563a (v2.0.0) on 2026-11-25. It drives the
read-first dashboard redesign tracked by Beads epic `pp-t80` and milestone v2.1.

These files are reference material, not product code. Nothing in `src/` or the test suite
imports them.

## Contents

- `mockups/`: static direction prototypes. Open `mockups/index.html` to switch between them.
  - `A.html`: a tightened version of the current card dashboard (rejected).
  - `B.html`: the **Ledger** direction (chosen). Rows grouped by milestone, typography-led, status
    is the only color, and ids and counts are in mono.
  - `C.html`: a timeline direction (rejected).
  - `*.webp`: screenshots of each mockup.
- `make-fixture.sh`: builds the "Aurora" stress fixture used throughout the review. It has 12
  features across four milestones plus backlog, long and non-ASCII titles, Beads refs, notes,
  and every status.

  ```sh
  docs/design/2026-11-dashboard-review/make-fixture.sh /tmp/aurora
  docs/design/2026-11-dashboard-review/make-fixture.sh /tmp/aurora-errors --with-errors
  ```

  `--with-errors` edits `broken-dep` by hand to add a dangling dependency, which the store
  refuses to write. The result has `MISSING_DEPENDENCY`, plus `ROADMAP_OUT_OF_SYNC` because
  ROADMAP.md isn't re-rendered.

The redesign will check its own test fixtures in under `tests/fixtures/`. This script is the
reference those fixtures are built from.

## Findings

The review found 17 web defects (W1–W17), 15 TUI defects (T1–T15) and 11 inconsistencies
between the two surfaces (X1–X11). Each issue under `pp-t80` restates the findings it fixes. The
original written spec wasn't kept, so the epic's Design section is now the source of truth.
