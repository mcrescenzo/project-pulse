import {
  FEATURE_STATUSES,
  MILESTONE_STATUSES,
  type Feature,
  type Milestone,
  type PulseConfig,
  type ValidationIssue,
} from "./types";

const MAX_RECOMMENDED_SHIP_CRITERIA = 6;
const VALID_MILESTONE_STATUS_SET = new Set<string>(MILESTONE_STATUSES);
const VALID_FEATURE_STATUS_SET = new Set<string>(FEATURE_STATUSES);

export interface ValidateStoreInput {
  config: PulseConfig;
  milestones: Milestone[];
  features: Feature[];
  currentRoadmapMd: string | null;
  expectedRoadmapMd: string;
  checkRoadmapSync?: boolean;
}

function detectDependencyCycles(features: Feature[]): string[][] {
  const byId = new Map<string, Feature>(features.map((f) => [f.id, f]));
  const state = new Map<string, "unvisited" | "visiting" | "visited">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  function dfs(id: string): void {
    state.set(id, "visiting");
    stack.push(id);

    const feature = byId.get(id);
    if (feature) {
      for (const depId of feature.depends_on) {
        if (depId === id || !byId.has(depId)) continue;
        const depState = state.get(depId) ?? "unvisited";
        if (depState === "visiting") {
          const idx = stack.indexOf(depId);
          const cycle = [...stack.slice(idx), depId];
          const key = cycle.join("->");
          if (!seenCycleKeys.has(key)) {
            seenCycleKeys.add(key);
            cycles.push(cycle);
          }
        } else if (depState === "unvisited") {
          dfs(depId);
        }
      }
    }

    stack.pop();
    state.set(id, "visited");
  }

  for (const feature of features) {
    if ((state.get(feature.id) ?? "unvisited") === "unvisited") {
      dfs(feature.id);
    }
  }

  return cycles;
}

/**
 * Validates `.project-pulse/` entities, dependency DAG, altitude guardrails, and `ROADMAP.md` freshness.
 */
export function validateStore(input: ValidateStoreInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { config, milestones, features, currentRoadmapMd, expectedRoadmapMd } = input;
  const checkRoadmapSync = input.checkRoadmapSync ?? true;

  if (config.version !== 1) {
    issues.push({
      level: "error",
      code: "INVALID_CONFIG_VERSION",
      message: `Unsupported config version ${String(config.version)}; expected 1`,
    });
  }
  if (!config.project?.name?.trim()) {
    issues.push({
      level: "error",
      code: "MISSING_PROJECT_NAME",
      message: "config.yaml must define a non-empty project.name",
    });
  }
  if (!config.defaults?.milestone?.trim()) {
    issues.push({
      level: "error",
      code: "MISSING_DEFAULT_MILESTONE",
      message: "config.yaml must define a non-empty defaults.milestone",
    });
  }

  const milestoneIds = new Set<string>();
  for (const milestone of milestones) {
    if (!milestone.id?.trim()) {
      issues.push({
        level: "error",
        code: "INVALID_MILESTONE_ID",
        message: "Milestone is missing a non-empty 'id'",
      });
      continue;
    }
    if (milestoneIds.has(milestone.id)) {
      issues.push({
        level: "error",
        code: "DUPLICATE_MILESTONE_ID",
        entityId: milestone.id,
        message: `Duplicate milestone id '${milestone.id}'`,
      });
    }
    milestoneIds.add(milestone.id);

    if (!milestone.title?.trim()) {
      issues.push({
        level: "error",
        code: "MISSING_MILESTONE_TITLE",
        entityId: milestone.id,
        message: `Milestone '${milestone.id}' is missing a non-empty 'title'`,
      });
    }
    if (typeof milestone.order !== "number" || !Number.isFinite(milestone.order)) {
      issues.push({
        level: "error",
        code: "INVALID_MILESTONE_ORDER",
        entityId: milestone.id,
        message: `Milestone '${milestone.id}' has non-numeric 'order'`,
      });
    }
    if (!VALID_MILESTONE_STATUS_SET.has(milestone.status)) {
      issues.push({
        level: "error",
        code: "INVALID_MILESTONE_STATUS",
        entityId: milestone.id,
        message: `Milestone '${milestone.id}' has invalid status '${String(
          milestone.status
        )}' (expected one of: ${MILESTONE_STATUSES.join(", ")})`,
      });
    }
  }

  const featureIds = new Set<string>();
  for (const feature of features) {
    if (!feature.id?.trim()) {
      issues.push({
        level: "error",
        code: "INVALID_FEATURE_ID",
        message: "Feature is missing a non-empty 'id'",
      });
      continue;
    }
    if (featureIds.has(feature.id)) {
      issues.push({
        level: "error",
        code: "DUPLICATE_FEATURE_ID",
        entityId: feature.id,
        message: `Duplicate feature id '${feature.id}'`,
      });
    }
    featureIds.add(feature.id);
  }

  const defaultMilestone = config.defaults?.milestone;

  for (const feature of features) {
    if (!feature.title?.trim()) {
      issues.push({
        level: "error",
        code: "MISSING_FEATURE_TITLE",
        entityId: feature.id,
        message: `Feature '${feature.id}' is missing a non-empty 'title'`,
      });
    }
    if (typeof feature.order !== "number" || !Number.isFinite(feature.order)) {
      issues.push({
        level: "error",
        code: "INVALID_FEATURE_ORDER",
        entityId: feature.id,
        message: `Feature '${feature.id}' has non-numeric 'order'`,
      });
    }
    if (!VALID_FEATURE_STATUS_SET.has(feature.status)) {
      issues.push({
        level: "error",
        code: "INVALID_FEATURE_STATUS",
        entityId: feature.id,
        message: `Feature '${feature.id}' has invalid status '${String(
          feature.status
        )}' (expected one of: ${FEATURE_STATUSES.join(", ")})`,
      });
    }
    if (!feature.milestone?.trim()) {
      issues.push({
        level: "error",
        code: "MISSING_MILESTONE",
        entityId: feature.id,
        message: `Feature '${feature.id}' is missing a 'milestone' reference`,
      });
    } else if (!milestoneIds.has(feature.milestone) && feature.milestone !== defaultMilestone) {
      issues.push({
        level: "error",
        code: "MISSING_MILESTONE",
        entityId: feature.id,
        message: `Feature '${feature.id}' references unknown milestone '${feature.milestone}'`,
      });
    }

    for (const depId of feature.depends_on) {
      if (depId === feature.id) {
        issues.push({
          level: "error",
          code: "DEPENDENCY_CYCLE",
          entityId: feature.id,
          message: `Feature '${feature.id}' cannot depend on itself`,
        });
      } else if (!featureIds.has(depId)) {
        issues.push({
          level: "error",
          code: "MISSING_DEPENDENCY",
          entityId: feature.id,
          message: `Feature '${feature.id}' depends on unknown feature '${depId}'`,
        });
      }
    }

    if (feature.ship_criteria.length > MAX_RECOMMENDED_SHIP_CRITERIA) {
      issues.push({
        level: "warning",
        code: "TOO_MANY_SHIP_CRITERIA",
        entityId: feature.id,
        message: `Feature '${feature.id}' has ${feature.ship_criteria.length} ship_criteria (recommended <= ${MAX_RECOMMENDED_SHIP_CRITERIA}); consider moving granular tasks into Beads`,
      });
    }
  }

  for (const cycle of detectDependencyCycles(features)) {
    issues.push({
      level: "error",
      code: "DEPENDENCY_CYCLE",
      entityId: cycle[0],
      message: `Dependency cycle detected: ${cycle.join(" -> ")}`,
    });
  }

  if (checkRoadmapSync) {
    // Compare EOL-insensitively (pp-f7m.28): a Git checkout configured for CRLF converts the
    // generated LF file on disk, so only substantive content differences are out of sync.
    const currentNormalized =
      currentRoadmapMd === null ? null : currentRoadmapMd.replace(/\r\n/g, "\n");
    if (currentNormalized === null || currentNormalized !== expectedRoadmapMd) {
      issues.push({
        level: "error",
        code: "ROADMAP_OUT_OF_SYNC",
        message: "ROADMAP.md is missing or out of sync with .project-pulse/; run 'pp render'",
      });
    }
  }

  return issues;
}
