import { loadFeaturesAtCommit, runGit } from "./git-history";
import { sortFeatures, sortMilestones } from "./renderer";
import { RoadmapService } from "./store";
import type { Feature, FeatureStatus, Milestone } from "./types";

export interface SinceSpec {
  raw: string;
  kind: "date" | "ref";
  sinceIso?: string;
  dateMs?: number;
  ref?: string;
}

export interface GitBaselineInfo {
  available: boolean;
  isGitRepo: boolean;
  commit?: string;
  commitDate?: string;
  reason?: string;
}

export interface DigestStatusChange {
  id: string;
  title: string;
  milestone: string;
  from: FeatureStatus;
  to: FeatureStatus;
}

export interface DigestCompletedCriterion {
  featureId: string;
  featureTitle: string;
  criterionId: string;
  text: string;
}

export interface DigestPulseNote {
  featureId: string;
  featureTitle: string;
  at: string;
  note: string;
}

export interface DigestFeatureBrief {
  id: string;
  title: string;
  milestone: string;
  status: FeatureStatus;
  area?: string;
}

export interface DigestResult {
  project: { name: string; summary: string };
  since: SinceSpec;
  milestoneFilter?: string;
  gitBaseline: GitBaselineInfo;
  summary: {
    shippedCount: number;
    statusChangesCount: number;
    addedCount: number;
    removedCount: number;
    completedCriteriaCount: number;
    pulseNotesCount: number;
  };
  shippedFeatures: DigestFeatureBrief[];
  statusChanges: DigestStatusChange[];
  addedFeatures: DigestFeatureBrief[];
  removedFeatures: DigestFeatureBrief[];
  completedCriteria: DigestCompletedCriterion[];
  pulseNotes: DigestPulseNote[];
  markdown: string;
}

export interface ChangelogFeatureItem {
  id: string;
  title: string;
  status: FeatureStatus;
  area?: string;
  description: string;
  refs: string[];
  completedCriteria: string[];
  latestNote?: string;
}

export interface ChangelogMilestoneEntry {
  milestone: Milestone;
  shipped: ChangelogFeatureItem[];
  remaining: ChangelogFeatureItem[];
}

export interface ChangelogResult {
  project: { name: string; summary: string };
  milestones: ChangelogMilestoneEntry[];
  markdown: string;
}

const RELATIVE_SINCE_RE = /^(\d+)([hdw])$/i;
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parses `--since` input (`7d`, `24h`, `2w`, `YYYY-MM-DD`, ISO-8601, or a git ref).
 */
export function parseSinceSpec(raw?: string, now: Date = new Date()): SinceSpec {
  const input = raw?.trim() || "7d";
  const relMatch = input.match(RELATIVE_SINCE_RE);
  if (relMatch) {
    const qty = Number.parseInt(relMatch[1]!, 10);
    const unit = relMatch[2]!.toLowerCase();
    const mult = unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 7 * 86_400_000;
    const ms = now.getTime() - qty * mult;
    return {
      raw: input,
      kind: "date",
      sinceIso: new Date(ms).toISOString(),
      dateMs: ms,
    };
  }

  if (ISO_DATE_RE.test(input)) {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T00:00:00.000Z` : input;
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms)) {
      return {
        raw: input,
        kind: "date",
        sinceIso: new Date(ms).toISOString(),
        dateMs: ms,
      };
    }
  }

  return {
    raw: input,
    kind: "ref",
    ref: input,
  };
}

function toBrief(f: Feature): DigestFeatureBrief {
  return {
    id: f.id,
    title: f.title,
    milestone: f.milestone,
    status: f.status,
    area: f.area,
  };
}

export function formatDigestMarkdown(digest: DigestResult): string {
  const lines: string[] = [
    `# ${digest.project.name} — Activity Digest`,
    "",
    `**Since:** \`${digest.since.raw}\`${
      digest.since.sinceIso ? ` (${digest.since.sinceIso})` : ""
    }${digest.milestoneFilter ? ` | **Milestone:** \`${digest.milestoneFilter}\`` : ""}`,
  ];

  if (digest.gitBaseline.available && digest.gitBaseline.commit) {
    lines.push(
      `**Git baseline:** \`${digest.gitBaseline.commit.slice(0, 8)}\`${
        digest.gitBaseline.commitDate ? ` (${digest.gitBaseline.commitDate})` : ""
      }`
    );
  } else if (digest.gitBaseline.reason) {
    lines.push(`**History mode:** ${digest.gitBaseline.reason} (using current store & timestamps)`);
  }

  lines.push("");

  if (digest.shippedFeatures.length > 0) {
    lines.push(`## Shipped Features (${digest.shippedFeatures.length})`);
    for (const f of digest.shippedFeatures) {
      lines.push(`- **${f.title}** (\`${f.id}\`, ${f.milestone}${f.area ? ` · ${f.area}` : ""})`);
    }
    lines.push("");
  }

  if (digest.statusChanges.length > 0) {
    lines.push(`## Status Movement (${digest.statusChanges.length})`);
    for (const s of digest.statusChanges) {
      lines.push(`- **${s.title}** (\`${s.id}\`): \`${s.from}\` -> \`${s.to}\``);
    }
    lines.push("");
  }

  if (digest.addedFeatures.length > 0) {
    lines.push(`## Added Features (${digest.addedFeatures.length})`);
    for (const f of digest.addedFeatures) {
      lines.push(`- **${f.title}** (\`${f.id}\`, \`${f.milestone}\`, [${f.status}])`);
    }
    lines.push("");
  }

  if (digest.removedFeatures.length > 0) {
    lines.push(`## Removed Features (${digest.removedFeatures.length})`);
    for (const f of digest.removedFeatures) {
      lines.push(`- **${f.title}** (\`${f.id}\`)`);
    }
    lines.push("");
  }

  if (digest.completedCriteria.length > 0) {
    lines.push(`## Completed Criteria (${digest.completedCriteria.length})`);
    for (const c of digest.completedCriteria) {
      lines.push(`- [x] ${c.text} *(${c.featureId})*`);
    }
    lines.push("");
  }

  if (digest.pulseNotes.length > 0) {
    lines.push(`## Pulse Notes (${digest.pulseNotes.length})`);
    for (const p of digest.pulseNotes) {
      lines.push(`- \`${p.at}\` **${p.featureId}**: ${p.note}`);
    }
    lines.push("");
  }

  const totalActivity =
    digest.summary.shippedCount +
    digest.summary.statusChangesCount +
    digest.summary.addedCount +
    digest.summary.removedCount +
    digest.summary.completedCriteriaCount +
    digest.summary.pulseNotesCount;

  if (totalActivity === 0) {
    lines.push("_No roadmap activity recorded in this window._");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Compiles a concise activity digest from `.project-pulse/` and optional git baseline history.
 */
export function buildDigest(
  rootDir: string,
  options: { since?: string; milestone?: string; now?: Date } = {}
): DigestResult {
  const service = new RoadmapService(rootDir);
  const loaded = service.load();
  if (loaded.parseIssues.length > 0) {
    throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
  }

  const since = parseSinceSpec(options.since, options.now ?? new Date());
  const inGitRes = runGit(["rev-parse", "--is-inside-work-tree"], service.rootDir);
  const isGitRepo = inGitRes.ok && inGitRes.stdout.trim() === "true";

  let gitBaseline: GitBaselineInfo;
  let baselineMap: Map<string, Feature> | null = null;

  if (since.kind === "ref") {
    if (!isGitRepo) {
      throw new Error(`Cannot resolve git ref '${since.ref}': ${service.rootDir} is not a git repository`);
    }
    const rev = runGit(
      ["rev-parse", "--verify", "--end-of-options", `${since.ref}^{commit}`],
      service.rootDir
    );
    if (!rev.ok || !rev.stdout.trim()) {
      throw new Error(`Could not resolve git ref '${since.ref}'`);
    }
    const sha = rev.stdout.trim();
    const dateRes = runGit(["show", "-s", "--format=%cI", sha], service.rootDir);
    const commitDate = dateRes.ok ? dateRes.stdout.trim() : undefined;
    gitBaseline = { available: true, isGitRepo: true, commit: sha, commitDate };
    baselineMap = loadFeaturesAtCommit(sha, service.rootDir);
  } else if (!isGitRepo) {
    gitBaseline = {
      available: false,
      isGitRepo: false,
      reason: "Directory is not a git repository",
    };
  } else {
    const headCheck = runGit(["rev-parse", "--verify", "HEAD"], service.rootDir);
    if (!headCheck.ok) {
      gitBaseline = {
        available: false,
        isGitRepo: true,
        reason: "Repository has no commits yet",
      };
    } else {
      const beforeRes = runGit(
        ["rev-list", "-n", "1", `--before=${since.sinceIso}`, "HEAD"],
        service.rootDir
      );
      const sha = beforeRes.stdout.trim();
      if (!beforeRes.ok || !sha) {
        gitBaseline = {
          available: false,
          isGitRepo: true,
          reason: `No git commit precedes ${since.raw}`,
        };
      } else {
        const dateRes = runGit(["show", "-s", "--format=%cI", sha], service.rootDir);
        gitBaseline = {
          available: true,
          isGitRepo: true,
          commit: sha,
          commitDate: dateRes.ok ? dateRes.stdout.trim() : undefined,
        };
        baselineMap = loadFeaturesAtCommit(sha, service.rootDir);
      }
    }
  }

  const filterM = options.milestone;
  const matchesMilestone = (f: Feature) => !filterM || f.milestone === filterM;

  const currentFeatures = loaded.features.filter(matchesMilestone);
  const currentById = new Map(currentFeatures.map((f) => [f.id, f]));

  const shippedFeatures: DigestFeatureBrief[] = [];
  const statusChanges: DigestStatusChange[] = [];
  const addedFeatures: DigestFeatureBrief[] = [];
  const removedFeatures: DigestFeatureBrief[] = [];
  const completedCriteria: DigestCompletedCriterion[] = [];
  const pulseNotes: DigestPulseNote[] = [];

  if (baselineMap) {
    for (const curr of currentFeatures) {
      const prev = baselineMap.get(curr.id);
      if (!prev) {
        addedFeatures.push(toBrief(curr));
        if (curr.status === "shipped") {
          shippedFeatures.push(toBrief(curr));
        }
        for (const c of curr.ship_criteria) {
          if (c.done) {
            completedCriteria.push({
              featureId: curr.id,
              featureTitle: curr.title,
              criterionId: c.id,
              text: c.text,
            });
          }
        }
        for (const u of curr.updates) {
          pulseNotes.push({ featureId: curr.id, featureTitle: curr.title, at: u.at, note: u.note });
        }
        continue;
      }

      if (prev.status !== curr.status) {
        statusChanges.push({
          id: curr.id,
          title: curr.title,
          milestone: curr.milestone,
          from: prev.status,
          to: curr.status,
        });
        if (curr.status === "shipped") {
          shippedFeatures.push(toBrief(curr));
        }
      }

      const prevDoneIds = new Set(prev.ship_criteria.filter((c) => c.done).map((c) => c.id));
      for (const c of curr.ship_criteria) {
        if (c.done && !prevDoneIds.has(c.id)) {
          completedCriteria.push({
            featureId: curr.id,
            featureTitle: curr.title,
            criterionId: c.id,
            text: c.text,
          });
        }
      }

      const prevNotes = new Set(prev.updates.map((u) => `${u.at}\0${u.note}`));
      for (const u of curr.updates) {
        if (!prevNotes.has(`${u.at}\0${u.note}`)) {
          pulseNotes.push({ featureId: curr.id, featureTitle: curr.title, at: u.at, note: u.note });
        }
      }
    }

    for (const prev of sortFeatures([...baselineMap.values()])) {
      if (matchesMilestone(prev) && !currentById.has(prev.id)) {
        removedFeatures.push(toBrief(prev));
      }
    }
  } else {
    const cutoffMs = since.dateMs ?? 0;
    for (const curr of currentFeatures) {
      if (curr.status === "shipped") {
        shippedFeatures.push(toBrief(curr));
        for (const c of curr.ship_criteria) {
          if (c.done) {
            completedCriteria.push({
              featureId: curr.id,
              featureTitle: curr.title,
              criterionId: c.id,
              text: c.text,
            });
          }
        }
      }
      for (const u of curr.updates) {
        const ts = Date.parse(u.at);
        if (!Number.isFinite(ts) || ts >= cutoffMs) {
          pulseNotes.push({ featureId: curr.id, featureTitle: curr.title, at: u.at, note: u.note });
        }
      }
    }
  }

  pulseNotes.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const partial: Omit<DigestResult, "markdown"> = {
    project: loaded.config.project,
    since,
    milestoneFilter: filterM,
    gitBaseline,
    summary: {
      shippedCount: shippedFeatures.length,
      statusChangesCount: statusChanges.length,
      addedCount: addedFeatures.length,
      removedCount: removedFeatures.length,
      completedCriteriaCount: completedCriteria.length,
      pulseNotesCount: pulseNotes.length,
    },
    shippedFeatures,
    statusChanges,
    addedFeatures,
    removedFeatures,
    completedCriteria,
    pulseNotes,
  };

  return {
    ...partial,
    markdown: formatDigestMarkdown({ ...partial, markdown: "" }),
  };
}

/**
 * Generates clean Markdown release notes for a milestone (or all milestones).
 */
export function buildChangelog(
  rootDir: string,
  options: { milestone?: string; all?: boolean } = {}
): ChangelogResult {
  if (options.milestone && options.all) {
    throw new Error("Cannot combine a specific milestone id with --all");
  }

  const service = new RoadmapService(rootDir);
  const loaded = service.load();
  if (loaded.parseIssues.length > 0) {
    throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
  }

  const orderedMilestones = sortMilestones(loaded.milestones);

  // Features may sit in the configured default bucket without an explicit milestone file
  // (`pp summary` renders that bucket as an implicit "Backlog" section). `--all` covers the whole
  // roadmap, so it must include the bucket — but never duplicate it when a real milestone already
  // uses the same id.
  const defaultBucketId = loaded.config.defaults.milestone;
  const implicitDefaultBucket: Milestone | null = orderedMilestones.some(
    (m) => m.id === defaultBucketId
  )
    ? null
    : {
        id: defaultBucketId,
        title: "Backlog",
        order: Number.MAX_SAFE_INTEGER,
        status: "planned",
        description: "",
      };

  let selected: Milestone[];
  if (options.all) {
    selected = [...orderedMilestones];
    if (
      implicitDefaultBucket &&
      (selected.length === 0 ||
        loaded.features.some((f) => f.milestone === implicitDefaultBucket.id))
    ) {
      selected.push(implicitDefaultBucket);
    }
  } else if (options.milestone) {
    const found = orderedMilestones.find((m) => m.id === options.milestone);
    if (!found) {
      throw new Error(`Milestone '${options.milestone}' not found`);
    }
    selected = [found];
  } else {
    if (orderedMilestones.length === 0) {
      throw new Error("No milestones found in .project-pulse/milestones/");
    }
    const shipped = orderedMilestones.filter((m) => m.status === "shipped");
    const active = orderedMilestones.find((m) => m.status === "active");
    const defaultMilestone =
      shipped.length > 0
        ? shipped[shipped.length - 1]!
        : active ?? orderedMilestones[orderedMilestones.length - 1]!;
    selected = [defaultMilestone];
  }

  const entries: ChangelogMilestoneEntry[] = selected.map((m) => {
    const mFeatures = sortFeatures(loaded.features.filter((f) => f.milestone === m.id));
    const toItem = (f: Feature): ChangelogFeatureItem => ({
      id: f.id,
      title: f.title,
      status: f.status,
      area: f.area,
      description: f.description,
      refs: [...f.refs],
      completedCriteria: f.ship_criteria.filter((c) => c.done).map((c) => c.text),
      latestNote: f.updates.length > 0 ? f.updates[f.updates.length - 1]!.note : undefined,
    });
    return {
      milestone: m,
      shipped: mFeatures.filter((f) => f.status === "shipped").map(toItem),
      remaining: mFeatures.filter((f) => f.status !== "shipped").map(toItem),
    };
  });

  const mdLines: string[] = [`# ${loaded.config.project.name} — Release Notes`, ""];
  for (const entry of entries) {
    const targetSuffix = entry.milestone.target ? ` (${entry.milestone.target})` : "";
    mdLines.push(`## ${entry.milestone.title}${targetSuffix}`);
    mdLines.push("");
    if (entry.milestone.description.trim()) {
      mdLines.push(entry.milestone.description.trim());
      mdLines.push("");
    }
    if (entry.shipped.length > 0) {
      mdLines.push("### Shipped");
      for (const f of entry.shipped) {
        const meta: string[] = [];
        if (f.area) meta.push(f.area);
        if (f.refs.length > 0) meta.push(f.refs.join(", "));
        const suffix = meta.length > 0 ? ` — *${meta.join(" · ")}*` : "";
        mdLines.push(`- **${f.title}** (\`${f.id}\`)${suffix}`);
        if (f.description.trim()) {
          mdLines.push(`  - ${f.description.trim()}`);
        }
        for (const crit of f.completedCriteria) {
          mdLines.push(`  - [x] ${crit}`);
        }
      }
      mdLines.push("");
    } else {
      mdLines.push("_No features marked shipped in this milestone yet._");
      mdLines.push("");
    }

    if (entry.remaining.length > 0) {
      mdLines.push("### In Progress / Planned");
      for (const f of entry.remaining) {
        mdLines.push(`- **${f.title}** (\`${f.id}\`) [${f.status}]`);
      }
      mdLines.push("");
    }
  }

  return {
    project: loaded.config.project,
    milestones: entries,
    markdown: `${mdLines.join("\n").trimEnd()}\n`,
  };
}
