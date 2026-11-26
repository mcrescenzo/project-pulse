/**
 * Reproducible fixtures for the read-first dashboard work (pp-t80), built through the store API.
 * Mirrors docs/design/2026-11-dashboard-review/make-fixture.sh.
 *
 * - buildAurora: the 12-feature stress DAG (four milestones plus backlog, long and non-ASCII
 *   titles, Beads refs, notes, every status). `withErrors` adds a dangling dependency.
 * - buildDeepDag: a chain deeper than any TUI density can fit in 24 rows.
 * - buildActivityRepo: a git repository whose commits on separate days change a status, complete a
 *   criterion, add a feature, ship one, and flip a status and back on the same day.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RoadmapService } from "../../src/store";
import type { FeatureStatus } from "../../src/types";

export const AURORA_FEATURE_IDS = [
  "crdt-core",
  "websocket-gateway",
  "audit-log",
  "legacy-exporter",
  "auth-sso",
  "realtime-collab",
  "billing",
  "broken-dep",
  "offline-mode",
  "mobile-app",
  "notification-center",
  "search-index",
] as const;

/** Deterministic note timestamps so exports and screenshots are stable. */
const T = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour, 0, 0)).toISOString();

export function buildAurora(dir: string, options: { withErrors?: boolean } = {}): RoadmapService {
  const svc = new RoadmapService(dir);
  svc.init({
    name: "Aurora",
    summary: "Collaborative writing workspace with offline support, real-time co-editing, and a plugin platform for teams.",
  });
  svc.upsertMilestone({ id: "v1.0", title: "v1.0 — Foundations", order: 10, status: "shipped", target: "2026-Q1", description: "Core editing engine, accounts, and the sync layer everything else stands on." });
  svc.upsertMilestone({ id: "v1.1", title: "v1.1 — Collaboration", order: 20, status: "active", target: "2026-Q2", description: "Real-time presence, comments, and shared workspaces. Shipping is gated on SSO finishing." });
  svc.upsertMilestone({
    id: "v1.2",
    title: "v1.2 — A Deliberately Long Milestone Title That Exercises How Wrapping Behaves When Someone Writes The Whole Release Narrative Into The Name Field",
    order: 30,
    status: "planned",
    target: "2026-Q3",
    description: "A similarly long description, so we can see how a milestone with a lot of release framing reads when it is truncated to a single line in the terminal and wraps to two or three lines in the browser.",
  });
  svc.upsertMilestone({ id: "v2.0", title: "v2.0 — Platform", order: 40, status: "planned", target: "2027" });

  const add = (
    id: string,
    title: string,
    milestone: string,
    status: FeatureStatus,
    order: number,
    extra: { area?: string; refs?: string[]; depends_on?: string[]; ship_criteria?: string[]; description?: string } = {}
  ) => svc.addFeature({ id, title, milestone, status, order, ...extra });

  add("crdt-core", "CRDT Core", "v1.0", "shipped", 10, {
    area: "Core",
    refs: ["bd:aur-010"],
    ship_criteria: ["Conflict-free merges for concurrent text edits", "Deterministic replay from an operation log", "Fuzz-tested against 1M interleavings"],
    description: "The conflict-free replicated data type that every editor session runs on.",
  });
  svc.logFeaturePulse({ id: "crdt-core", note: "Landed the LWW-register set and the text RGA; fuzz harness wired into CI.", at: T(10) });
  svc.logFeaturePulse({ id: "crdt-core", note: "Fixed a tombstone GC bug that surfaced only above 500k ops.", at: T(11) });
  for (const c of ["1", "2", "3"]) svc.checkFeatureCriterion("crdt-core", c, true);

  add("websocket-gateway", "WebSocket Gateway", "v1.0", "shipped", 20, {
    area: "Core",
    ship_criteria: ["Reconnect within 2s of a dropped socket", "Backpressure under 10k concurrent sessions"],
  });
  for (const c of ["1", "2"]) svc.checkFeatureCriterion("websocket-gateway", c, true);
  add("audit-log", "Audit Log", "v1.0", "shipped", 30, {
    area: "Platform & Infrastructure",
    refs: ["bd:aur-030"],
    depends_on: ["crdt-core"],
    ship_criteria: ["Every mutation writes an immutable audit row", "Export as CSV for compliance reviews"],
  });
  svc.checkFeatureCriterion("audit-log", "1", true);
  add("legacy-exporter", "Legacy CSV Exporter", "v1.0", "cut", 40, {
    area: "Core",
    ship_criteria: ["Port the v0 exporter unchanged", "Deprecation notice in the release notes"],
  });

  add("auth-sso", "Single Sign-On", "v1.1", "paused", 10, {
    area: "Core",
    refs: ["bd:aur-020"],
    depends_on: ["crdt-core"],
    ship_criteria: ["SAML 2.0 and OIDC login flows", "SCIM provisioning for enterprise tenants", "Session revocation within 60 seconds"],
    description: "Paused while legal reviews the data-processing terms for the identity providers.",
  });
  svc.checkFeatureCriterion("auth-sso", "1", true);
  svc.logFeaturePulse({ id: "auth-sso", note: "Paused pending legal review of the IdP data-processing addendum.", at: T(14) });

  add(
    "realtime-collab",
    "Real-time collaborative editing with live presence, inline comment threads, and conflict-free merging across many simultaneous editors",
    "v1.1",
    "in-progress",
    20,
    {
      area: "Editor",
      depends_on: ["crdt-core", "websocket-gateway", "auth-sso"],
      refs: ["bd:aur-101", "bd:aur-102", "bd:aur-103"],
      ship_criteria: [
        "Two editors see each other's cursors and selections within 150ms",
        "Comment threads anchor to a text range and survive edits",
        "Offline edits merge without manual conflict dialogs",
        "Presence list shows who is viewing which page",
        "Follow mode: one editor drives, others follow their viewport",
        "Load-tested with 50 concurrent writers on a 200-page document",
      ],
      description:
        "The headline feature of the release. This description is intentionally long so we can watch the two-line clamp on cards, the full text in the drawer, and the single truncated line in the terminal card footer. It should still read well when it is cut off.",
    }
  );
  svc.checkFeatureCriterion("realtime-collab", "1", true);
  svc.checkFeatureCriterion("realtime-collab", "2", true);
  const notes = [
    "Presence and cursor sharing are live on staging; p95 latency is 110ms over WebSocket.",
    "Comment threads now re-anchor after edits. Found a race when two people resolve the same thread at once.",
    "Follow mode is prototyped but the viewport sync is jittery when the leader scrolls quickly. We suspect the throttle window is too short on high-refresh displays and will try a scroll-end debounce next.",
    "Merged follow-mode debounce.",
    "Started load test harness.",
    "Triaged a flaky merge test; the fixture generator was producing duplicate op ids.",
    "Load run 1: 50 writers held, p95 grew to 240ms after 10 minutes.",
  ];
  notes.forEach((note, i) => svc.logFeaturePulse({ id: "realtime-collab", note, at: T(16 + i) }));

  add("billing", "Usage-based Billing", "v1.1", "in-progress", 30, {
    area: "Billing",
    depends_on: ["auth-sso"],
    refs: ["bd:aur-040"],
    ship_criteria: ["Metered seats reported hourly", "Proration on plan changes mid-cycle"],
  });
  svc.checkFeatureCriterion("billing", "1", true);
  add("broken-dep", "Team Templates", "v1.1", "planned", 40, {
    area: "Editor",
    ship_criteria: ["Ship five starter templates", "Templates can be shared across workspaces"],
  });

  add("offline-mode", "Offline Mode", "v1.2", "planned", 10, {
    area: "Editor",
    depends_on: ["realtime-collab"],
    ship_criteria: [
      "Open, edit, and create pages with no network",
      "Sync resolves cleanly on reconnect",
      "Storage quota warnings before the cache fills",
      "Conflict dialog only when both sides changed the same sentence",
    ],
  });
  add("mobile-app", "Mobile App", "v1.2", "planned", 20);
  add("notification-center", "通知センター (Notification Center) 📣", "v1.2", "planned", 30, {
    area: "UX",
    ship_criteria: ["Digest email once per day", "In-app inbox with read state"],
  });
  add("search-index", "Full-text Search Index", "backlog", "planned", 10, {
    area: "Platform & Infrastructure",
    refs: ["bd:aur-999"],
    ship_criteria: ["Sub-100ms query latency on 1M pages", "Typo tolerance in the query parser"],
  });

  if (options.withErrors) addDanglingDependency(dir, "broken-dep", "does-not-exist");
  return svc;
}

/** Adds a dependency on a missing feature by editing the file (the store refuses to write one). */
export function addDanglingDependency(dir: string, featureId: string, missingId: string): void {
  const path = join(dir, ".project-pulse", "features", `${featureId}.md`);
  const text = readFileSync(path, "utf8");
  const next = text.includes("depends_on: []")
    ? text.replace("depends_on: []", `depends_on:\n  - ${missingId}`)
    : text.replace(/depends_on:\n/, `depends_on:\n  - ${missingId}\n`);
  if (next === text) throw new Error(`could not add a dangling dependency to ${featureId}`);
  writeFileSync(path, next);
}

/** A single chain `deep-01 → … → deep-<depth>` in one milestone. */
export function buildDeepDag(dir: string, depth = 14): RoadmapService {
  const svc = new RoadmapService(dir);
  svc.init({ name: "Deep DAG", summary: "A dependency chain deeper than a terminal." });
  svc.upsertMilestone({ id: "m1", title: "Chain", status: "active", order: 10 });
  for (let i = 1; i <= depth; i++) {
    const id = `deep-${String(i).padStart(2, "0")}`;
    svc.addFeature({
      id,
      title: `Step ${i} of the chain`,
      milestone: "m1",
      status: i <= 2 ? "shipped" : i === 3 ? "in-progress" : "planned",
      order: i * 10,
      depends_on: i > 1 ? [`deep-${String(i - 1).padStart(2, "0")}`] : [],
      ship_criteria: ["Works"],
    });
  }
  return svc;
}

function git(dir: string, args: string[], when?: string): void {
  const env = { ...process.env };
  if (when) {
    env.GIT_AUTHOR_DATE = when;
    env.GIT_COMMITTER_DATE = when;
  }
  const res = spawnSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd: dir, env, encoding: "utf8" }
  );
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

export interface ActivityRepo {
  svc: RoadmapService;
  /** A time after every fixture commit, for building windows relative to it. */
  now: Date;
}

/**
 * Commits (UTC):
 *   Nov 10 12:00  baseline — alpha planned (2 criteria), beta in progress, gamma planned
 *   Nov 18 12:00  alpha planned → in progress
 *   Nov 19 12:00  alpha criterion 1 done
 *   Nov 20 12:00  delta added
 *   Nov 21 12:00  beta shipped
 *   Nov 22 09:00  gamma planned → paused
 *   Nov 22 15:00  gamma paused → planned (same-day reversal)
 * Notes: alpha Nov 19 08:00 (committed with the criterion), beta Nov 21 07:00.
 */
export function buildActivityRepo(dir: string): ActivityRepo {
  git(dir, ["init", "-q", "-b", "main"]);
  const svc = new RoadmapService(dir);
  svc.init({ name: "Activity", summary: "Dated history." });
  svc.upsertMilestone({ id: "m1", title: "M1", status: "active", order: 10 });
  svc.addFeature({ id: "alpha", title: "Alpha", milestone: "m1", status: "planned", area: "Core", ship_criteria: ["First", "Second"] });
  svc.addFeature({ id: "beta", title: "Beta", milestone: "m1", status: "in-progress", area: "UI" });
  svc.addFeature({ id: "gamma", title: "Gamma", milestone: "m1", status: "planned", area: "Core" });
  const commit = (message: string, when: string) => {
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", message], when);
  };
  commit("baseline", "2026-11-10T12:00:00Z");
  svc.updateFeature("alpha", { status: "in-progress" });
  commit("alpha in progress", "2026-11-18T12:00:00Z");
  svc.checkFeatureCriterion("alpha", "1", true);
  svc.logFeaturePulse({ id: "alpha", note: "First criterion landed.", at: "2026-11-19T08:00:00.000Z" });
  commit("alpha criterion", "2026-11-19T12:00:00Z");
  svc.addFeature({ id: "delta", title: "Delta", milestone: "m1", status: "planned", area: "UI" });
  commit("add delta", "2026-11-20T12:00:00Z");
  svc.logFeaturePulse({ id: "beta", note: "Ready to ship.", at: "2026-11-21T07:00:00.000Z" });
  svc.updateFeature("beta", { status: "shipped" });
  commit("ship beta", "2026-11-21T12:00:00Z");
  svc.updateFeature("gamma", { status: "paused" });
  commit("pause gamma", "2026-11-22T09:00:00Z");
  svc.updateFeature("gamma", { status: "planned" });
  commit("unpause gamma", "2026-11-22T15:00:00Z");
  return { svc, now: new Date("2026-11-23T12:00:00Z") };
}
