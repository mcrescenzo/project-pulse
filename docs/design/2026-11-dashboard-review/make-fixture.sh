#!/usr/bin/env bash
# Stress fixture used by the 2026-11 dashboard design review: 12 features across four
# milestones plus backlog, long and non-ASCII titles, Beads refs, notes and every status.
# Usage: make-fixture.sh <output-dir> [--with-errors]
#   --with-errors  afterwards gives broken-dep a dangling dependency (the store refuses
#                  to write one, so the feature file is edited directly) to exercise the
#                  edit freeze and diagnostics.
set -euo pipefail

F="${1:?usage: make-fixture.sh <output-dir> [--with-errors]}"
WITH_ERRORS="${2:-}"
if [ -e "$F" ]; then echo "refusing to overwrite existing $F" >&2; exit 1; fi
mkdir -p "$F"
CLI="$(cd "$(dirname "$0")/../../.." && pwd)/src/cli.ts"
pp() { bun run "$CLI" --root "$F" "$@" >/dev/null; }

pp init --name "Aurora" --summary "Collaborative writing workspace with offline support, real-time co-editing, and a plugin platform for teams." --non-interactive

pp milestone add v1.0 --title "v1.0 — Foundations" --order 10 --status shipped --target "2026-Q1" \
  --description "Core editing engine, accounts, and the sync layer everything else stands on."
pp milestone add v1.1 --title "v1.1 — Collaboration" --order 20 --status active --target "2026-Q2" \
  --description "Real-time presence, comments, and shared workspaces. Shipping is gated on SSO finishing."
pp milestone add v1.2 --title "v1.2 — A Deliberately Long Milestone Title That Exercises How Wrapping Behaves When Someone Writes The Whole Release Narrative Into The Name Field" \
  --order 30 --status planned --target "2026-Q3" \
  --description "A similarly long description, so we can see how a milestone with a lot of release framing reads when it is truncated to a single line in the terminal and wraps to two or three lines in the browser."
pp milestone add v2.0 --title "v2.0 — Platform" --order 40 --status planned --target "2027"

# v1.0 — shipped foundations
pp feature add crdt-core --title "CRDT Core" --milestone v1.0 --area Core --status shipped --order 10 \
  --ref bd:aur-010 \
  --criterion "Conflict-free merges for concurrent text edits" \
  --criterion "Deterministic replay from an operation log" \
  --criterion "Fuzz-tested against 1M interleavings" \
  --description "The conflict-free replicated data type that every editor session runs on."
pp feature note crdt-core "Landed the LWW-register set and the text RGA; fuzz harness wired into CI."
pp feature note crdt-core "Fixed a tombstone GC bug that surfaced only above 500k ops."

pp feature add websocket-gateway --title "WebSocket Gateway" --milestone v1.0 --area Core --status shipped --order 20 \
  --criterion "Reconnect within 2s of a dropped socket" \
  --criterion "Backpressure under 10k concurrent sessions"

pp feature add audit-log --title "Audit Log" --milestone v1.0 --area "Platform & Infrastructure" --status shipped --order 30 \
  --ref bd:aur-030 --depends-on crdt-core \
  --criterion "Every mutation writes an immutable audit row" \
  --criterion "Export as CSV for compliance reviews"

pp feature add legacy-exporter --title "Legacy CSV Exporter" --milestone v1.0 --area Core --status cut --order 40 \
  --criterion "Port the v0 exporter unchanged" \
  --criterion "Deprecation notice in the release notes"

# v1.1 — active
pp feature add auth-sso --title "Single Sign-On" --milestone v1.1 --area Core --status paused --order 10 \
  --ref bd:aur-020 --depends-on crdt-core \
  --criterion "SAML 2.0 and OIDC login flows" \
  --criterion "SCIM provisioning for enterprise tenants" \
  --criterion "Session revocation within 60 seconds" \
  --description "Paused while legal reviews the data-processing terms for the identity providers."
pp feature check auth-sso 1 --done
pp feature note auth-sso "Paused pending legal review of the IdP data-processing addendum."

pp feature add realtime-collab --title "Real-time collaborative editing with live presence, inline comment threads, and conflict-free merging across many simultaneous editors" \
  --milestone v1.1 --area Editor --status in-progress --order 20 \
  --depends-on crdt-core,websocket-gateway,auth-sso \
  --ref bd:aur-101 --ref bd:aur-102 --ref bd:aur-103 \
  --criterion "Two editors see each other's cursors and selections within 150ms" \
  --criterion "Comment threads anchor to a text range and survive edits" \
  --criterion "Offline edits merge without manual conflict dialogs" \
  --criterion "Presence list shows who is viewing which page" \
  --criterion "Follow mode: one editor drives, others follow their viewport" \
  --criterion "Load-tested with 50 concurrent writers on a 200-page document" \
  --description "The headline feature of the release. This description is intentionally long so we can watch the two-line clamp on cards, the full text in the drawer, and the single truncated line in the terminal card footer. It should still read well when it is cut off."
pp feature check realtime-collab 1 --done
pp feature check realtime-collab 2 --done
pp feature note realtime-collab "Presence and cursor sharing are live on staging; p95 latency is 110ms over WebSocket."
pp feature note realtime-collab "Comment threads now re-anchor after edits. Found a race when two people resolve the same thread at once."
pp feature note realtime-collab "A much longer note to check how the update list handles a paragraph-sized entry: follow mode is prototyped but the viewport sync is jittery when the leader scrolls quickly. We suspect the throttle window is too short on high-refresh displays and will try a scroll-end debounce next. There is also an open question about whether followers should be able to break out of follow mode with any input, or only via an explicit control."
pp feature note realtime-collab "Merged follow-mode debounce."
pp feature note realtime-collab "Started load test harness."
pp feature note realtime-collab "Triaged a flaky merge test; the fixture generator was producing duplicate op ids."
pp feature note realtime-collab "Load run 1: 50 writers held, p95 grew to 240ms after 10 minutes."

pp feature add billing --title "Usage-based Billing" --milestone v1.1 --area Billing --status in-progress --order 30 \
  --depends-on auth-sso --ref bd:aur-040 \
  --criterion "Metered seats reported hourly" \
  --criterion "Proration on plan changes mid-cycle"
pp feature check billing 1 --done

pp feature add broken-dep --title "Team Templates" --milestone v1.1 --area Editor --status planned --order 40 \
  --criterion "Ship five starter templates" \
  --criterion "Templates can be shared across workspaces"

# v1.2 — planned
pp feature add offline-mode --title "Offline Mode" --milestone v1.2 --area Editor --status planned --order 10 \
  --depends-on realtime-collab \
  --criterion "Open, edit, and create pages with no network" \
  --criterion "Sync resolves cleanly on reconnect" \
  --criterion "Storage quota warnings before the cache fills" \
  --criterion "Conflict dialog only when both sides changed the same sentence"

pp feature add mobile-app --title "Mobile App" --milestone v1.2 --order 20 --status planned

pp feature add notification-center --title "通知センター (Notification Center) 📣" --milestone v1.2 --area UX --status planned --order 30 \
  --criterion "Digest email once per day" \
  --criterion "In-app inbox with read state"

# backlog (default milestone, never declared) — exercises the implicit Backlog section
pp feature add search-index --title "Full-text Search Index" --milestone backlog --area "Platform & Infrastructure" --status planned --order 10 \
  --ref bd:aur-999 \
  --criterion "Sub-100ms query latency on 1M pages" \
  --criterion "Typo tolerance in the query parser"

if [ "$WITH_ERRORS" = "--with-errors" ]; then
  sed -i.bak 's/^depends_on: \[\]$/depends_on:\n  - does-not-exist/' "$F/.project-pulse/features/broken-dep.md"
  rm -f "$F/.project-pulse/features/broken-dep.md.bak"
fi

echo "fixture ready: $F"
