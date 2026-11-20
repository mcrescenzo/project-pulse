import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  parseMarkdownFile,
  serializeConfig,
  serializeFeature,
  serializeMilestone,
  writeFileAtomic,
} from "./frontmatter";
import { renderRoadmapMarkdown, sortFeatures, sortMilestones } from "./renderer";
import type {
  CheckResult,
  Feature,
  FeatureStatus,
  FeatureUpdate,
  Milestone,
  MilestoneStatus,
  PulseConfig,
  ShipCriterion,
  ValidationIssue,
} from "./types";
import { validateStore } from "./validator";

export const PULSE_DIR_NAME = ".project-pulse";
export const CONFIG_FILE_NAME = "config.yaml";
export const MILESTONES_DIR_NAME = "milestones";
export const FEATURES_DIR_NAME = "features";
export const ROADMAP_FILE_NAME = "ROADMAP.md";

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function parseShipCriteria(value: unknown, featureId: string, parseIssues: ValidationIssue[]): ShipCriterion[] {
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

function parseUpdates(value: unknown, featureId: string, parseIssues: ValidationIssue[]): FeatureUpdate[] {
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

  writeMilestoneFile(milestone: Milestone): void {
    const path = join(this.milestonesDir, `${milestone.id}.md`);
    writeFileAtomic(path, serializeMilestone(milestone));
  }

  writeFeatureFile(feature: Feature): void {
    const path = join(this.featuresDir, `${feature.id}.md`);
    writeFileAtomic(path, serializeFeature(feature));
  }
}
