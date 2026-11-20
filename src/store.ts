import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CliBeadsClient, evaluateBeadsDrift, extractBeadRefs, type BeadsClient } from "./beads";
import {
  parseMarkdownFile,
  serializeConfig,
  serializeFeature,
  serializeMilestone,
  writeFileAtomic,
} from "./frontmatter";
import { renderRoadmapMarkdown, sortFeatures, sortMilestones } from "./renderer";
import type {
  BeadStatusInfo,
  CheckResult,
  Feature,
  FeatureStatus,
  FeatureUpdate,
  Milestone,
  MilestoneStatus,
  PulseConfig,
  ShipCriterion,
  ShowFeatureResult,
  SummaryFeatureItem,
  SummaryMilestoneItem,
  SummaryResult,
  ValidationIssue,
} from "./types";
import { validateStore } from "./validator";

export const PULSE_DIR_NAME = ".project-pulse";
export const CONFIG_FILE_NAME = "config.yaml";
export const MILESTONES_DIR_NAME = "milestones";
export const FEATURES_DIR_NAME = "features";
export const ROADMAP_FILE_NAME = "ROADMAP.md";

const VALID_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface LoadedStore {
  config: PulseConfig;
  milestones: Milestone[];
  features: Feature[];
  parseIssues: ValidationIssue[];
}

export interface InitOptions {
  name?: string;
  summary?: string;
}

export interface InitResult {
  pulseDir: string;
  configPath: string;
  roadmapPath: string;
  config: PulseConfig;
  created: boolean;
}

export interface UpsertMilestoneInput {
  id: string;
  title: string;
  order?: number;
  status?: MilestoneStatus;
  target?: string;
  description?: string;
}

export interface UpdateMilestonePatch {
  title?: string;
  order?: number;
  status?: MilestoneStatus;
  target?: string;
  description?: string;
}

export interface UpsertFeatureInput {
  id: string;
  title: string;
  milestone?: string;
  order?: number;
  status?: FeatureStatus;
  area?: string;
  depends_on?: string[];
  refs?: string[];
  ship_criteria?: Array<string | ShipCriterion>;
  description?: string;
}

export interface UpdateFeaturePatch {
  title?: string;
  milestone?: string;
  order?: number;
  status?: FeatureStatus;
  area?: string;
  depends_on?: string[];
  addRefs?: string[];
  removeRefs?: string[];
  ship_criteria?: Array<string | ShipCriterion>;
  description?: string;
}

export interface MutationResult<T> {
  entity: T;
  warnings: ValidationIssue[];
  roadmapPath: string;
}

function assertValidId(id: string, kind: string): void {
  if (!id || !VALID_ID_RE.test(id)) {
    throw new Error(
      `Invalid ${kind} id '${id}'. IDs must match /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`
    );
  }
}

function slugifyCriterionId(text: string, usedIds: Set<string>, index: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 4)
    .join("-")
    .slice(0, 32);
  let candidate = base || `c-${index + 1}`;
  if (!usedIds.has(candidate)) {
    usedIds.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (usedIds.has(`${candidate}-${suffix}`)) {
    suffix++;
  }
  const unique = `${candidate}-${suffix}`;
  usedIds.add(unique);
  return unique;
}

function normalizeCriteriaInput(
  items: Array<string | ShipCriterion> | undefined
): ShipCriterion[] {
  if (!items) return [];
  const usedIds = new Set<string>();
  const result: ShipCriterion[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (typeof item === "string") {
      const id = slugifyCriterionId(item, usedIds, i);
      result.push({ id, text: item.trim(), done: false });
    } else {
      const id = item.id?.trim() || slugifyCriterionId(item.text, usedIds, i);
      usedIds.add(id);
      result.push({ id, text: item.text.trim(), done: Boolean(item.done) });
    }
  }
  return result;
}

function nextOrder(items: Array<{ order: number }>): number {
  if (items.length === 0) return 10;
  return Math.max(...items.map((i) => i.order)) + 10;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function parseShipCriteria(
  value: unknown,
  featureId: string,
  parseIssues: ValidationIssue[]
): ShipCriterion[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    parseIssues.push({
      level: "error",
      code: "INVALID_SHIP_CRITERIA",
      entityId: featureId,
      message: `Feature '${featureId}' ship_criteria must be a list`,
    });
    return [];
  }
  const result: ShipCriterion[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      parseIssues.push({
        level: "error",
        code: "INVALID_SHIP_CRITERIA",
        entityId: featureId,
        message: `Feature '${featureId}' ship_criteria[${i}] must be an object`,
      });
      continue;
    }
    const obj = raw as Record<string, unknown>;
    result.push({
      id: typeof obj.id === "string" && obj.id.trim() ? obj.id : `c-${i + 1}`,
      text: typeof obj.text === "string" ? obj.text : "",
      done: Boolean(obj.done),
    });
  }
  return result;
}

function parseUpdates(
  value: unknown,
  featureId: string,
  parseIssues: ValidationIssue[]
): FeatureUpdate[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    parseIssues.push({
      level: "error",
      code: "INVALID_UPDATES",
      entityId: featureId,
      message: `Feature '${featureId}' updates must be a list`,
    });
    return [];
  }
  const result: FeatureUpdate[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      parseIssues.push({
        level: "error",
        code: "INVALID_UPDATES",
        entityId: featureId,
        message: `Feature '${featureId}' updates[${i}] must be an object`,
      });
      continue;
    }
    const obj = raw as Record<string, unknown>;
    result.push({
      at: typeof obj.at === "string" ? obj.at : "",
      note: typeof obj.note === "string" ? obj.note : "",
    });
  }
  return result;
}

/**
 * File-backed domain service operating on a repository root's `.project-pulse/` directory.
 */
export class RoadmapService {
  readonly rootDir: string;
  readonly pulseDir: string;
  readonly configPath: string;
  readonly milestonesDir: string;
  readonly featuresDir: string;
  readonly roadmapPath: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
    this.pulseDir = join(this.rootDir, PULSE_DIR_NAME);
    this.configPath = join(this.pulseDir, CONFIG_FILE_NAME);
    this.milestonesDir = join(this.pulseDir, MILESTONES_DIR_NAME);
    this.featuresDir = join(this.pulseDir, FEATURES_DIR_NAME);
    this.roadmapPath = join(this.rootDir, ROADMAP_FILE_NAME);
  }

  isInitialized(): boolean {
    return existsSync(this.configPath);
  }

  requireInitialized(): void {
    if (!this.isInitialized()) {
      throw new Error(
        `Project Pulse is not initialized in ${this.rootDir} (missing ${PULSE_DIR_NAME}/${CONFIG_FILE_NAME}). Run 'pp init' first.`
      );
    }
  }

  init(options?: InitOptions): InitResult {
    const alreadyExists = this.isInitialized();
    mkdirSync(this.milestonesDir, { recursive: true });
    mkdirSync(this.featuresDir, { recursive: true });

    let config: PulseConfig;
    if (alreadyExists) {
      config = this.loadConfig();
      if (options?.name) {
        config.project.name = options.name;
      }
      if (options?.summary) {
        config.project.summary = options.summary;
      }
      if (options?.name || options?.summary) {
        writeFileAtomic(this.configPath, serializeConfig(config));
      }
    } else {
      config = {
        version: 1,
        project: {
          name: options?.name?.trim() || basename(this.rootDir),
          summary:
            options?.summary?.trim() ||
            "High-level product roadmap managed with project-pulse.",
        },
        defaults: {
          milestone: "backlog",
        },
        integrations: {
          beads: {
            enabled: true,
          },
        },
      };
      writeFileAtomic(this.configPath, serializeConfig(config));
    }

    this.render();

    return {
      pulseDir: this.pulseDir,
      configPath: this.configPath,
      roadmapPath: this.roadmapPath,
      config,
      created: !alreadyExists,
    };
  }

  loadConfig(): PulseConfig {
    this.requireInitialized();
    const raw = readFileSync(this.configPath, "utf8");
    const parsed = Bun.YAML.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid YAML in ${this.configPath}`);
    }
    const obj = parsed as Record<string, unknown>;
    const project = (obj.project && typeof obj.project === "object" ? obj.project : {}) as Record<
      string,
      unknown
    >;
    const defaults = (obj.defaults && typeof obj.defaults === "object" ? obj.defaults : {}) as Record<
      string,
      unknown
    >;
    const integrations = (
      obj.integrations && typeof obj.integrations === "object" ? obj.integrations : {}
    ) as Record<string, unknown>;
    const beads = (
      integrations.beads && typeof integrations.beads === "object" ? integrations.beads : {}
    ) as Record<string, unknown>;

    return {
      version: typeof obj.version === "number" ? obj.version : Number(obj.version ?? 0),
      project: {
        name: typeof project.name === "string" ? project.name : "",
        summary: typeof project.summary === "string" ? project.summary : "",
      },
      defaults: {
        milestone: typeof defaults.milestone === "string" ? defaults.milestone : "backlog",
      },
      integrations: {
        beads: {
          enabled: beads.enabled === undefined ? true : Boolean(beads.enabled),
        },
      },
    };
  }

  load(): LoadedStore {
    const config = this.loadConfig();
    const parseIssues: ValidationIssue[] = [];
    const milestones: Milestone[] = [];
    const features: Feature[] = [];

    if (existsSync(this.milestonesDir)) {
      const files = readdirSync(this.milestonesDir)
        .filter((f) => f.endsWith(".md") && !f.startsWith(".tmp."))
        .sort();
      for (const file of files) {
        const fileId = file.slice(0, -3);
        const fullPath = join(this.milestonesDir, file);
        try {
          const parsed = parseMarkdownFile(readFileSync(fullPath, "utf8"));
          const fm = parsed.frontmatter;
          const id = typeof fm.id === "string" ? fm.id : fileId;
          if (id !== fileId) {
            parseIssues.push({
              level: "error",
              code: "FILENAME_ID_MISMATCH",
              entityId: id,
              message: `Milestone file '${file}' has frontmatter id '${id}' which does not match filename`,
            });
          }
          milestones.push({
            id,
            title: typeof fm.title === "string" ? fm.title : "",
            order: typeof fm.order === "number" ? fm.order : Number(fm.order ?? 100),
            status: (typeof fm.status === "string" ? fm.status : "") as MilestoneStatus,
            target: typeof fm.target === "string" && fm.target !== "" ? fm.target : undefined,
            description: parsed.body,
          });
        } catch (error) {
          parseIssues.push({
            level: "error",
            code: "PARSE_ERROR",
            entityId: fileId,
            message: `Failed to parse milestone '${file}': ${(error as Error).message}`,
          });
        }
      }
    }

    if (existsSync(this.featuresDir)) {
      const files = readdirSync(this.featuresDir)
        .filter((f) => f.endsWith(".md") && !f.startsWith(".tmp."))
        .sort();
      for (const file of files) {
        const fileId = file.slice(0, -3);
        const fullPath = join(this.featuresDir, file);
        try {
          const parsed = parseMarkdownFile(readFileSync(fullPath, "utf8"));
          const fm = parsed.frontmatter;
          const id = typeof fm.id === "string" ? fm.id : fileId;
          if (id !== fileId) {
            parseIssues.push({
              level: "error",
              code: "FILENAME_ID_MISMATCH",
              entityId: id,
              message: `Feature file '${file}' has frontmatter id '${id}' which does not match filename`,
            });
          }
          features.push({
            id,
            title: typeof fm.title === "string" ? fm.title : "",
            milestone: typeof fm.milestone === "string" ? fm.milestone : "",
            order: typeof fm.order === "number" ? fm.order : Number(fm.order ?? 100),
            status: (typeof fm.status === "string" ? fm.status : "") as FeatureStatus,
            area: typeof fm.area === "string" && fm.area !== "" ? fm.area : undefined,
            depends_on: asStringArray(fm.depends_on),
            refs: asStringArray(fm.refs),
            ship_criteria: parseShipCriteria(fm.ship_criteria, id, parseIssues),
            updates: parseUpdates(fm.updates, id, parseIssues),
            description: parsed.body,
          });
        } catch (error) {
          parseIssues.push({
            level: "error",
            code: "PARSE_ERROR",
            entityId: fileId,
            message: `Failed to parse feature '${file}': ${(error as Error).message}`,
          });
        }
      }
    }

    return {
      config,
      milestones: sortMilestones(milestones),
      features: sortFeatures(features),
      parseIssues,
    };
  }

  private validateCandidate(
    config: PulseConfig,
    milestones: Milestone[],
    features: Feature[]
  ): ValidationIssue[] {
    const issues = validateStore({
      config,
      milestones,
      features,
      currentRoadmapMd: null,
      expectedRoadmapMd: "",
      checkRoadmapSync: false,
    });
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join("; "));
    }
    return issues.filter((i) => i.level === "warning");
  }

  upsertMilestone(input: UpsertMilestoneInput): MutationResult<Milestone> {
    assertValidId(input.id, "milestone");
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }

    const existing = loaded.milestones.find((m) => m.id === input.id);
    const milestone: Milestone = {
      id: input.id,
      title: input.title,
      order: input.order ?? existing?.order ?? nextOrder(loaded.milestones),
      status: input.status ?? existing?.status ?? "planned",
      target: input.target !== undefined ? input.target || undefined : existing?.target,
      description: input.description !== undefined ? input.description : existing?.description ?? "",
    };

    const candidateMilestones = [
      ...loaded.milestones.filter((m) => m.id !== milestone.id),
      milestone,
    ];
    const warnings = this.validateCandidate(loaded.config, candidateMilestones, loaded.features);

    this.writeMilestoneFile(milestone);
    const { roadmapPath } = this.render();
    return { entity: milestone, warnings, roadmapPath };
  }

  updateMilestone(id: string, patch: UpdateMilestonePatch): MutationResult<Milestone> {
    assertValidId(id, "milestone");
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    const existing = loaded.milestones.find((m) => m.id === id);
    if (!existing) {
      throw new Error(`Milestone '${id}' not found`);
    }

    const updated: Milestone = {
      id: existing.id,
      title: patch.title ?? existing.title,
      order: patch.order ?? existing.order,
      status: patch.status ?? existing.status,
      target: patch.target !== undefined ? patch.target || undefined : existing.target,
      description: patch.description ?? existing.description,
    };

    const candidateMilestones = [
      ...loaded.milestones.filter((m) => m.id !== id),
      updated,
    ];
    const warnings = this.validateCandidate(loaded.config, candidateMilestones, loaded.features);

    this.writeMilestoneFile(updated);
    const { roadmapPath } = this.render();
    return { entity: updated, warnings, roadmapPath };
  }

  addFeature(input: UpsertFeatureInput): MutationResult<Feature> {
    assertValidId(input.id, "feature");
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    if (loaded.features.some((f) => f.id === input.id)) {
      throw new Error(`Feature '${input.id}' already exists; use 'pp feature update ${input.id}'`);
    }

    const targetMilestone = input.milestone ?? loaded.config.defaults.milestone;
    const sameMilestoneFeatures = loaded.features.filter((f) => f.milestone === targetMilestone);

    const feature: Feature = {
      id: input.id,
      title: input.title,
      milestone: targetMilestone,
      order: input.order ?? nextOrder(sameMilestoneFeatures),
      status: input.status ?? "planned",
      area: input.area?.trim() || undefined,
      depends_on: dedupeStrings(input.depends_on ?? []),
      refs: dedupeStrings(input.refs ?? []),
      ship_criteria: normalizeCriteriaInput(input.ship_criteria),
      updates: [],
      description: input.description ?? "",
    };

    const candidateFeatures = [...loaded.features, feature];
    const warnings = this.validateCandidate(loaded.config, loaded.milestones, candidateFeatures);

    this.writeFeatureFile(feature);
    const { roadmapPath } = this.render();
    return { entity: feature, warnings, roadmapPath };
  }

  upsertFeature(input: UpsertFeatureInput): MutationResult<Feature> {
    assertValidId(input.id, "feature");
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    const existing = loaded.features.find((f) => f.id === input.id);
    if (!existing) {
      return this.addFeature(input);
    }

    const updated: Feature = {
      id: existing.id,
      title: input.title ?? existing.title,
      milestone: input.milestone ?? existing.milestone,
      order: input.order ?? existing.order,
      status: input.status ?? existing.status,
      area: input.area !== undefined ? input.area.trim() || undefined : existing.area,
      depends_on:
        input.depends_on !== undefined ? dedupeStrings(input.depends_on) : existing.depends_on,
      refs: input.refs !== undefined ? dedupeStrings(input.refs) : existing.refs,
      ship_criteria:
        input.ship_criteria !== undefined
          ? normalizeCriteriaInput(input.ship_criteria)
          : existing.ship_criteria,
      updates: existing.updates,
      description: input.description !== undefined ? input.description : existing.description,
    };

    const candidateFeatures = [
      ...loaded.features.filter((f) => f.id !== existing.id),
      updated,
    ];
    const warnings = this.validateCandidate(loaded.config, loaded.milestones, candidateFeatures);

    this.writeFeatureFile(updated);
    const { roadmapPath } = this.render();
    return { entity: updated, warnings, roadmapPath };
  }

  updateFeature(id: string, patch: UpdateFeaturePatch): MutationResult<Feature> {
    assertValidId(id, "feature");
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    const existing = loaded.features.find((f) => f.id === id);
    if (!existing) {
      throw new Error(`Feature '${id}' not found`);
    }

    let nextRefs = [...existing.refs];
    if (patch.addRefs && patch.addRefs.length > 0) {
      nextRefs = dedupeStrings([...nextRefs, ...patch.addRefs]);
    }
    if (patch.removeRefs && patch.removeRefs.length > 0) {
      const toRemove = new Set(patch.removeRefs);
      nextRefs = nextRefs.filter((r) => !toRemove.has(r));
    }

    const updated: Feature = {
      id: existing.id,
      title: patch.title ?? existing.title,
      milestone: patch.milestone ?? existing.milestone,
      order: patch.order ?? existing.order,
      status: patch.status ?? existing.status,
      area: patch.area !== undefined ? patch.area.trim() || undefined : existing.area,
      depends_on:
        patch.depends_on !== undefined ? dedupeStrings(patch.depends_on) : existing.depends_on,
      refs: nextRefs,
      ship_criteria:
        patch.ship_criteria !== undefined
          ? normalizeCriteriaInput(patch.ship_criteria)
          : existing.ship_criteria,
      updates: existing.updates,
      description: patch.description ?? existing.description,
    };

    const candidateFeatures = [
      ...loaded.features.filter((f) => f.id !== id),
      updated,
    ];
    const warnings = this.validateCandidate(loaded.config, loaded.milestones, candidateFeatures);

    this.writeFeatureFile(updated);
    const { roadmapPath } = this.render();
    return { entity: updated, warnings, roadmapPath };
  }

  checkFeatureCriterion(
    featureId: string,
    criterionIdOrIndex: string,
    done?: boolean
  ): MutationResult<Feature> {
    assertValidId(featureId, "feature");
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    const existing = loaded.features.find((f) => f.id === featureId);
    if (!existing) {
      throw new Error(`Feature '${featureId}' not found`);
    }

    let targetIndex = existing.ship_criteria.findIndex((c) => c.id === criterionIdOrIndex);
    if (targetIndex === -1 && /^\d+$/.test(criterionIdOrIndex)) {
      const oneBased = Number.parseInt(criterionIdOrIndex, 10);
      if (oneBased >= 1 && oneBased <= existing.ship_criteria.length) {
        targetIndex = oneBased - 1;
      }
    }
    if (targetIndex === -1) {
      throw new Error(
        `Ship criterion '${criterionIdOrIndex}' not found on feature '${featureId}'`
      );
    }

    const updatedCriteria = existing.ship_criteria.map((c, idx) =>
      idx === targetIndex ? { ...c, done: done === undefined ? !c.done : done } : c
    );
    const updated: Feature = {
      ...existing,
      ship_criteria: updatedCriteria,
    };

    const candidateFeatures = [
      ...loaded.features.filter((f) => f.id !== featureId),
      updated,
    ];
    const warnings = this.validateCandidate(loaded.config, loaded.milestones, candidateFeatures);

    this.writeFeatureFile(updated);
    const { roadmapPath } = this.render();
    return { entity: updated, warnings, roadmapPath };
  }

  addFeatureNote(featureId: string, note: string, at?: string): MutationResult<Feature> {
    assertValidId(featureId, "feature");
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      throw new Error("Pulse note message must be non-empty");
    }

    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    const existing = loaded.features.find((f) => f.id === featureId);
    if (!existing) {
      throw new Error(`Feature '${featureId}' not found`);
    }

    const timestamp = at ?? new Date().toISOString();
    const updated: Feature = {
      ...existing,
      updates: [...existing.updates, { at: timestamp, note: trimmedNote }],
    };

    const candidateFeatures = [
      ...loaded.features.filter((f) => f.id !== featureId),
      updated,
    ];
    const warnings = this.validateCandidate(loaded.config, loaded.milestones, candidateFeatures);

    this.writeFeatureFile(updated);
    const { roadmapPath } = this.render();
    return { entity: updated, warnings, roadmapPath };
  }

  render(): { roadmapPath: string; content: string } {
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    const content = renderRoadmapMarkdown(loaded.config, loaded.milestones, loaded.features);
    writeFileAtomic(this.roadmapPath, content);
    return {
      roadmapPath: this.roadmapPath,
      content,
    };
  }

  check(): CheckResult {
    const loaded = this.load();
    const expectedRoadmapMd = renderRoadmapMarkdown(
      loaded.config,
      loaded.milestones,
      loaded.features
    );
    const currentRoadmapMd = existsSync(this.roadmapPath)
      ? readFileSync(this.roadmapPath, "utf8")
      : null;

    const validationIssues = validateStore({
      config: loaded.config,
      milestones: loaded.milestones,
      features: loaded.features,
      currentRoadmapMd,
      expectedRoadmapMd,
      checkRoadmapSync: true,
    });

    const allIssues = [...loaded.parseIssues, ...validationIssues];
    const errors = allIssues.filter((i) => i.level === "error");
    const warnings = allIssues.filter((i) => i.level === "warning");

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }

  async checkWithBeads(options: {
    beads?: boolean;
    beadsClient?: BeadsClient;
  } = {}): Promise<CheckResult> {
    const base = this.check();
    if (!options.beads) {
      return base;
    }

    const loaded = this.load();
    const beadsClient = options.beadsClient ?? new CliBeadsClient();
    const resolvedMap: Record<string, BeadStatusInfo[]> = {};

    for (const feature of loaded.features) {
      if (extractBeadRefs(feature.refs).length > 0) {
        resolvedMap[feature.id] = await beadsClient.resolveRefs(feature.refs, this.rootDir);
      }
    }

    const driftIssues = evaluateBeadsDrift(loaded.features, resolvedMap);
    const errors = [...base.errors, ...driftIssues.filter((i) => i.level === "error")];
    const warnings = [...base.warnings, ...driftIssues.filter((i) => i.level === "warning")];

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      beads: resolvedMap,
    };
  }

  summary(options: { milestone?: string; status?: string } = {}): SummaryResult {
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }

    const filterMilestone = options.milestone;
    const filterStatus = options.status;

    const toSummaryFeature = (f: Feature): SummaryFeatureItem => ({
      id: f.id,
      title: f.title,
      milestone: f.milestone,
      status: f.status,
      area: f.area,
      criteriaDone: f.ship_criteria.filter((c) => c.done).length,
      criteriaTotal: f.ship_criteria.length,
      depends_on: [...f.depends_on],
      refs: [...f.refs],
      latestUpdate: f.updates.length > 0 ? f.updates[f.updates.length - 1] : undefined,
    });

    const filteredFeatures = loaded.features.filter((f) => {
      if (filterMilestone && f.milestone !== filterMilestone) return false;
      if (filterStatus && f.status !== filterStatus) return false;
      return true;
    });

    const milestoneGroups: SummaryMilestoneItem[] = [];
    const knownMilestoneIds = new Set(loaded.milestones.map((m) => m.id));

    for (const milestone of loaded.milestones) {
      if (filterMilestone && milestone.id !== filterMilestone) continue;
      const allForMilestone = loaded.features.filter((f) => f.milestone === milestone.id);
      const visibleForMilestone = filteredFeatures.filter((f) => f.milestone === milestone.id);
      if (filterStatus && visibleForMilestone.length === 0) continue;

      milestoneGroups.push({
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        target: milestone.target,
        totalFeatures: allForMilestone.length,
        shippedFeatures: allForMilestone.filter((f) => f.status === "shipped").length,
        features: visibleForMilestone.map(toSummaryFeature),
      });
    }

    const defaultId = loaded.config.defaults.milestone;
    if (!knownMilestoneIds.has(defaultId) && (!filterMilestone || filterMilestone === defaultId)) {
      const backlogAll = loaded.features.filter((f) => f.milestone === defaultId);
      const backlogVisible = filteredFeatures.filter((f) => f.milestone === defaultId);
      if (backlogVisible.length > 0) {
        milestoneGroups.push({
          id: defaultId,
          title: "Backlog",
          status: "backlog",
          totalFeatures: backlogAll.length,
          shippedFeatures: backlogAll.filter((f) => f.status === "shipped").length,
          features: backlogVisible.map(toSummaryFeature),
        });
      }
    }

    return {
      project: {
        name: loaded.config.project.name,
        summary: loaded.config.project.summary,
      },
      totals: {
        milestones: milestoneGroups.length,
        features: filteredFeatures.length,
        shipped: filteredFeatures.filter((f) => f.status === "shipped").length,
        inProgress: filteredFeatures.filter((f) => f.status === "in-progress").length,
        planned: filteredFeatures.filter((f) => f.status === "planned").length,
        paused: filteredFeatures.filter((f) => f.status === "paused").length,
        cut: filteredFeatures.filter((f) => f.status === "cut").length,
      },
      milestones: milestoneGroups,
    };
  }

  async showFeature(
    featureId: string,
    options: { beads?: boolean; beadsClient?: BeadsClient } = {}
  ): Promise<ShowFeatureResult> {
    const loaded = this.load();
    if (loaded.parseIssues.length > 0) {
      throw new Error(loaded.parseIssues.map((i) => i.message).join("; "));
    }
    const feature = loaded.features.find((f) => f.id === featureId);
    if (!feature) {
      throw new Error(`Feature '${featureId}' not found`);
    }
    const milestone = loaded.milestones.find((m) => m.id === feature.milestone);

    const resolveBeads =
      options.beads ?? (loaded.config.integrations.beads.enabled && extractBeadRefs(feature.refs).length > 0);
    let beads: BeadStatusInfo[] = [];
    if (resolveBeads && extractBeadRefs(feature.refs).length > 0) {
      const client = options.beadsClient ?? new CliBeadsClient();
      beads = await client.resolveRefs(feature.refs, this.rootDir);
    }

    return { feature, milestone, beads };
  }

  writeMilestoneFile(milestone: Milestone): void {
    const path = join(this.milestonesDir, `${milestone.id}.md`);
    writeFileAtomic(path, serializeMilestone(milestone));
  }

  writeFeatureFile(feature: Feature): void {
    const path = join(this.featuresDir, `${feature.id}.md`);
    writeFileAtomic(path, serializeFeature(feature));
  }
}

function truncateText(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

/**
 * Formats a compact, token-lean roadmap summary suitable for agent startup and quick developer review.
 */
export function formatSummaryText(summary: SummaryResult): string {
  const lines: string[] = [
    `# ${summary.project.name} (${summary.totals.shipped}/${summary.totals.features} shipped, ${summary.totals.inProgress} in-progress, ${summary.totals.planned} planned)`,
  ];

  if (summary.milestones.length === 0) {
    lines.push("No matching milestones or features.");
    return lines.join("\n");
  }

  for (const milestone of summary.milestones) {
    const targetSuffix = milestone.target ? ` | ${milestone.target}` : "";
    lines.push(
      `\n## ${milestone.title} (${milestone.id}) [${milestone.status}${targetSuffix}] — ${milestone.shippedFeatures}/${milestone.totalFeatures} shipped`
    );
    if (milestone.features.length === 0) {
      lines.push("- (no features)");
      continue;
    }
    for (const f of milestone.features) {
      const parts: string[] = [`[${f.status}]`];
      if (f.area) parts.push(f.area);
      if (f.criteriaTotal > 0) parts.push(`${f.criteriaDone}/${f.criteriaTotal} criteria`);
      if (f.depends_on.length > 0) parts.push(`deps:${f.depends_on.join(",")}`);
      if (f.latestUpdate) parts.push(`"${truncateText(f.latestUpdate.note, 48)}"`);
      lines.push(`- ${f.id}: ${f.title} — ${parts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats full details for a single feature including criteria, dependencies, Beads refs, and pulse log.
 */
export function formatFeatureText(detail: ShowFeatureResult): string {
  const { feature, milestone, beads } = detail;
  const lines: string[] = [
    `${feature.title} (${feature.id})`,
    `Milestone: ${milestone ? `${milestone.title} (${milestone.id})` : feature.milestone}`,
    `Status: ${feature.status}${feature.area ? ` | Area: ${feature.area}` : ""} | Order: ${feature.order}`,
  ];

  if (feature.depends_on.length > 0) {
    lines.push(`Depends on: ${feature.depends_on.join(", ")}`);
  }
  if (feature.refs.length > 0) {
    lines.push(`Refs: ${feature.refs.join(", ")}`);
  }
  if (feature.description.trim()) {
    lines.push("", feature.description.trim());
  }

  if (feature.ship_criteria.length > 0) {
    lines.push("", "Ship Criteria:");
    feature.ship_criteria.forEach((c, idx) => {
      lines.push(`  ${idx + 1}. [${c.done ? "x" : " "}] ${c.text} (${c.id})`);
    });
  }

  if (beads.length > 0) {
    lines.push("", "Beads Linked Issues:");
    for (const b of beads) {
      if (!b.available) {
        lines.push(`  - ${b.ref}: unavailable (${b.error ?? "bd unreachable"})`);
      } else if (!b.found) {
        lines.push(`  - ${b.ref}: NOT FOUND`);
      } else {
        lines.push(`  - ${b.ref}: [${b.status ?? "unknown"}] ${b.title ?? ""}`.trimEnd());
      }
    }
  }

  if (feature.updates.length > 0) {
    lines.push("", "Pulse Updates:");
    for (const u of feature.updates) {
      lines.push(`  - ${u.at}: ${u.note}`);
    }
  }

  return lines.join("\n");
}
