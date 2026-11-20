import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Feature, Milestone, PulseConfig } from "./types";

export interface ParsedMarkdownFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parses YAML frontmatter delimited by `---` lines and returns the parsed object plus Markdown body.
 */
export function parseMarkdownFile(raw: string): ParsedMarkdownFile {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") {
    throw new Error("Missing opening YAML frontmatter delimiter '---'");
  }

  const afterOpening = normalized.slice(4);
  let yamlContent = "";
  let body = "";

  if (afterOpening.startsWith("---\n") || afterOpening === "---") {
    yamlContent = "";
    body = afterOpening.startsWith("---\n") ? afterOpening.slice(4) : "";
  } else {
    const closeIndex = afterOpening.indexOf("\n---");
    if (closeIndex === -1) {
      throw new Error("Missing closing YAML frontmatter delimiter '---'");
    }
    const afterClose = afterOpening.slice(closeIndex + 4);
    if (afterClose !== "" && !afterClose.startsWith("\n")) {
      throw new Error("Invalid closing YAML frontmatter delimiter line");
    }
    yamlContent = afterOpening.slice(0, closeIndex);
    body = afterClose.startsWith("\n") ? afterClose.slice(1) : "";
  }

  const parsed = yamlContent.trim() ? Bun.YAML.parse(yamlContent) : {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML frontmatter must be a mapping/object");
  }

  return {
    frontmatter: parsed as Record<string, unknown>,
    body: body.trim(),
  };
}

function cleanYamlOutput(rawYaml: string): string {
  return rawYaml.replace(/^(.*?:)[ \t]+$/gm, "$1").trimEnd();
}

function serializeYamlFrontmatter(orderedObject: Record<string, unknown>, body: string): string {
  const yaml = cleanYamlOutput(Bun.YAML.stringify(orderedObject, null, 2));
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return `---\n${yaml}\n---\n`;
  }
  return `---\n${yaml}\n---\n${trimmedBody}\n`;
}

/**
 * Serializes `.project-pulse/config.yaml` with canonical key order.
 */
export function serializeConfig(config: PulseConfig): string {
  const ordered = {
    version: config.version,
    project: {
      name: config.project.name,
      summary: config.project.summary,
    },
    defaults: {
      milestone: config.defaults.milestone,
    },
    integrations: {
      beads: {
        enabled: config.integrations.beads.enabled,
      },
    },
  };
  return `${cleanYamlOutput(Bun.YAML.stringify(ordered, null, 2))}\n`;
}

/**
 * Serializes a milestone `.md` file with fixed canonical frontmatter key order.
 */
export function serializeMilestone(milestone: Milestone): string {
  const ordered: Record<string, unknown> = {
    id: milestone.id,
    title: milestone.title,
    order: milestone.order,
    status: milestone.status,
  };
  if (milestone.target !== undefined && milestone.target !== "") {
    ordered.target = milestone.target;
  }
  return serializeYamlFrontmatter(ordered, milestone.description);
}

/**
 * Serializes a feature `.md` file with fixed canonical frontmatter key order.
 */
export function serializeFeature(feature: Feature): string {
  const ordered: Record<string, unknown> = {
    id: feature.id,
    title: feature.title,
    milestone: feature.milestone,
    order: feature.order,
    status: feature.status,
  };
  if (feature.area !== undefined && feature.area !== "") {
    ordered.area = feature.area;
  }
  ordered.depends_on = [...feature.depends_on];
  ordered.refs = [...feature.refs];
  ordered.ship_criteria = feature.ship_criteria.map((c) => ({
    id: c.id,
    text: c.text,
    done: c.done,
  }));
  ordered.updates = feature.updates.map((u) => ({
    at: u.at,
    note: u.note,
  }));

  return serializeYamlFrontmatter(ordered, feature.description);
}

/**
 * Atomically writes a file by staging a sibling temporary file and renaming it into place.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  );
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failure for non-existent temp file
    }
    throw error;
  }
}
