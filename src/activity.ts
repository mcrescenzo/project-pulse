/**
 * Activity feed: dated roadmap events for the dashboards' "what changed" view.
 *
 * Status, criteria and feature add/remove/ship events come from comparing successive committed
 * roadmap states along the first-parent history of HEAD, starting with the state immediately
 * before the window, so each change is dated by the commit that made it. Notes are dated by their
 * own timestamps. Edits not yet committed form an "uncommitted" group (working tree vs HEAD).
 * Without git, only notes are available and `noGit` is set.
 */
import { createHash } from "node:crypto";
import { featuresRelDir, listFeatureBlobs, parseHistoricalFeature, readBlobs, runGit } from "./git-history";
import { parseSinceSpec } from "./digest";
import type { RoadmapService } from "./store";
import type { Feature, FeatureStatus } from "./types";

export type ActivityKind =
  | "note"
  | "status-change"
  | "criterion-done"
  | "criterion-reopened"
  | "feature-added"
  | "feature-removed"
  | "shipped";

export interface ActivityEvent {
  /** ISO time: the commit's committer date, or the note's own timestamp. Null for uncommitted edits. */
  at: string | null;
  kind: ActivityKind;
  featureId: string;
  title: string;
  milestone: string;
  area?: string;
  /** Human detail: the note text, "planned → in progress", or the criterion text. */
  detail: string;
  from?: FeatureStatus;
  to?: FeatureStatus;
  /** True for edits in the working tree that are not committed yet. */
  uncommitted: boolean;
  /** Short commit id for committed events. */
  commit?: string;
}

export interface ActivityResult {
  since: { raw: string; sinceIso: string };
  /** Branch whose history was read ("HEAD@abc1234" when detached); null without git. */
  branch: string | null;
  noGit: boolean;
  /** Newest first; uncommitted events come before everything else. */
  events: ActivityEvent[];
  uncommittedCount: number;
}

export interface BuildActivityOptions {
  /** Window spec accepted by parseSinceSpec: "7d" (default), "30d", "24h", a date, or a git ref. */
  since?: string;
  now?: Date;
  /** Skip the working-tree comparison (static exports describe committed history only). */
  includeUncommitted?: boolean;
}

type FeatureMap = Map<string, Feature>;

/** Successive roadmap states compared pairwise → events dated `at`. */
function diffStates(
  before: FeatureMap,
  after: FeatureMap,
  stamp: { at: string | null; uncommitted: boolean; commit?: string }
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const base = (f: Feature) => ({
    featureId: f.id,
    title: f.title,
    milestone: f.milestone,
    area: f.area,
    at: stamp.at,
    uncommitted: stamp.uncommitted,
    ...(stamp.commit ? { commit: stamp.commit } : {}),
  });
  for (const f of after.values()) {
    const prev = before.get(f.id);
    if (!prev) {
      events.push({ ...base(f), kind: "feature-added", detail: f.milestone ? `added to ${f.milestone}` : "added", to: f.status });
      if (f.status === "shipped") events.push({ ...base(f), kind: "shipped", detail: "shipped", to: "shipped" });
      continue;
    }
    if (prev.status !== f.status) {
      events.push({
        ...base(f),
        kind: f.status === "shipped" ? "shipped" : "status-change",
        detail: `${prev.status} → ${f.status}`,
        from: prev.status,
        to: f.status,
      });
    }
    const prevDone = new Map(prev.ship_criteria.map((c) => [c.id, c.done]));
    for (const c of f.ship_criteria) {
      const was = prevDone.get(c.id) ?? false;
      if (c.done && !was) events.push({ ...base(f), kind: "criterion-done", detail: c.text });
      else if (!c.done && was) events.push({ ...base(f), kind: "criterion-reopened", detail: c.text });
    }
  }
  for (const f of before.values()) {
    if (!after.has(f.id)) events.push({ ...base(f), kind: "feature-removed", detail: "removed" });
  }
  return events;
}

function noteEvents(features: Iterable<Feature>, sinceMs: number): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const f of features) {
    for (const u of f.updates) {
      const ms = Date.parse(u.at);
      if (!Number.isFinite(ms) || ms < sinceMs) continue;
      out.push({
        at: new Date(ms).toISOString(),
        kind: "note",
        featureId: f.id,
        title: f.title,
        milestone: f.milestone,
        area: f.area,
        detail: u.note,
        uncommitted: false,
      });
    }
  }
  return out;
}

function stateAt(commit: string | null, rootDir: string, cache: Map<string, string>): FeatureMap {
  const out: FeatureMap = new Map();
  if (!commit) return out;
  const blobs = listFeatureBlobs(commit, rootDir);
  const missing = [...blobs.values()].filter((sha) => !cache.has(sha));
  for (const [sha, content] of readBlobs(missing, rootDir)) cache.set(sha, content);
  for (const [path, sha] of blobs) {
    const content = cache.get(sha);
    if (content === undefined) continue;
    const f = parseHistoricalFeature(content, path);
    if (f) out.set(f.id, f);
  }
  return out;
}

/** Minimal comparable copy: only the fields Activity diffs. */
function comparable(features: Iterable<Feature>): FeatureMap {
  const out: FeatureMap = new Map();
  for (const f of features) out.set(f.id, f);
  return out;
}

export function gitBranch(rootDir: string): string | null {
  const name = runGit(["rev-parse", "--abbrev-ref", "HEAD"], rootDir);
  if (!name.ok) return null;
  if (name.stdout !== "HEAD") return name.stdout;
  const short = runGit(["rev-parse", "--short", "HEAD"], rootDir);
  return short.ok ? `HEAD@${short.stdout}` : "HEAD";
}

/**
 * Builds the Activity feed for `service`'s project. Throws on an unreadable store (parse errors are
 * tolerated: the current features that did load are used).
 */
export function buildActivity(service: RoadmapService, options: BuildActivityOptions = {}): ActivityResult {
  const rootDir = service.rootDir;
  const now = options.now ?? new Date();
  const spec = parseSinceSpec(options.since, now);
  const loaded = service.load();
  const current = comparable(loaded.features);

  const inside = runGit(["rev-parse", "--is-inside-work-tree"], rootDir);
  const isGit = inside.ok && inside.stdout.trim() === "true";

  let sinceMs: number;
  let sinceIso: string;
  if (spec.kind === "date") {
    sinceMs = spec.dateMs!;
    sinceIso = spec.sinceIso!;
  } else {
    // A git ref: the window starts at that commit's committer date.
    const date = isGit ? runGit(["log", "-1", "--format=%cI", spec.ref!, "--"], rootDir) : null;
    if (!date?.ok || !date.stdout) {
      throw new Error(`Unknown --since value '${spec.raw}': use 7d, 30d, a date (YYYY-MM-DD) or a git ref`);
    }
    sinceMs = Date.parse(date.stdout);
    sinceIso = new Date(sinceMs).toISOString();
  }

  const notes = noteEvents(current.values(), sinceMs);
  if (!isGit) {
    return {
      since: { raw: spec.raw, sinceIso },
      branch: null,
      noGit: true,
      events: sortEvents(notes),
      uncommittedCount: 0,
    };
  }

  const head = runGit(["rev-parse", "--verify", "-q", "HEAD"], rootDir);
  const headSha = head.ok ? head.stdout : null;
  const branch = gitBranch(rootDir);
  const blobCache = new Map<string, string>();
  const events: ActivityEvent[] = [...notes];

  if (headSha) {
    // State immediately before the window: the newest first-parent commit older than it.
    const baseline = runGit(
      // The window is inclusive: a commit made exactly at its start belongs to it, not the baseline.
      ["rev-list", "-1", "--first-parent", `--before=${new Date(sinceMs - 1000).toISOString()}`, "HEAD"],
      rootDir
    );
    let previous = stateAt(baseline.ok && baseline.stdout ? baseline.stdout : null, rootDir, blobCache);

    // Commits inside the window that touched feature files, oldest first, on the first-parent line.
    const log = runGit(
      [
        "log",
        "--first-parent",
        "--reverse",
        "--format=%H%x09%cI",
        `--since=${sinceIso}`,
        "HEAD",
        "--",
        featuresRelDir(),
      ],
      rootDir
    );
    const commits = log.ok && log.stdout ? log.stdout.split("\n").map((l) => l.split("\t") as [string, string]) : [];
    for (const [sha, date] of commits) {
      const state = stateAt(sha, rootDir, blobCache);
      events.push(
        ...diffStates(previous, state, { at: new Date(Date.parse(date)).toISOString(), uncommitted: false, commit: sha.slice(0, 7) })
      );
      previous = state;
    }
    // Working tree vs HEAD.
    if (options.includeUncommitted !== false) {
      const headState = commits.length > 0 && commits[commits.length - 1]![0] === headSha ? previous : stateAt(headSha, rootDir, blobCache);
      events.push(...diffStates(headState, current, { at: null, uncommitted: true }));
    }
  } else if (options.includeUncommitted !== false) {
    // A repository without commits: everything in the working tree is uncommitted.
    events.push(...diffStates(new Map(), current, { at: null, uncommitted: true }));
  }

  const sorted = sortEvents(events);
  return {
    since: { raw: spec.raw, sinceIso },
    branch,
    noGit: false,
    events: sorted,
    uncommittedCount: sorted.filter((e) => e.uncommitted).length,
  };
}

/** Uncommitted first, then newest first; ties keep their generation order reversed (later commit first). */
function sortEvents(events: ActivityEvent[]): ActivityEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.uncommitted !== b.e.uncommitted) return a.e.uncommitted ? -1 : 1;
      const ta = a.e.at ? Date.parse(a.e.at) : 0;
      const tb = b.e.at ? Date.parse(b.e.at) : 0;
      if (ta !== tb) return tb - ta;
      return b.i - a.i;
    })
    .map(({ e }) => e);
}

/**
 * Cache key for an Activity request: project, HEAD revision, working-tree content, payload and
 * window (relative windows are bucketed to the minute).
 */
export function activityCacheKey(service: RoadmapService, since: string | undefined, now: Date = new Date()): string {
  const spec = parseSinceSpec(since, now);
  const head = runGit(["rev-parse", "--verify", "-q", "HEAD"], service.rootDir);
  const loaded = service.load();
  const tree = createHash("sha256").update(JSON.stringify(loaded.features)).digest("hex").slice(0, 16);
  const window = spec.kind === "date" ? Math.floor(spec.dateMs! / 60000) : spec.raw;
  return [service.rootDir, head.ok ? head.stdout : "nogit", tree, spec.raw, window].join("|");
}

/**
 * Activity for an offline export: anchored at the newest committed or noted change rather than the
 * export clock, so exporting unchanged inputs at different times yields identical bytes.
 */
export function buildExportActivity(service: RoadmapService, windowDays = 30): ActivityResult {
  const rootDir = service.rootDir;
  const headDate = runGit(["log", "-1", "--format=%cI", "HEAD"], rootDir);
  const loaded = service.load();
  const noteTimes = loaded.features.flatMap((f) => f.updates.map((u) => Date.parse(u.at))).filter(Number.isFinite);
  const anchors = [...noteTimes];
  if (headDate.ok && headDate.stdout) anchors.push(Date.parse(headDate.stdout));
  const anchor = anchors.length > 0 ? Math.max(...anchors) : 0;
  const now = new Date(anchor + 1000);
  const result = buildActivity(service, { since: `${windowDays}d`, now, includeUncommitted: false });
  return { ...result, since: { raw: `${windowDays}d`, sinceIso: result.since.sinceIso } };
}
