import { chmodSync, lstatSync, mkdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
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
    body: trimMarkdownBody(body),
  };
}

/**
 * Trims blank-line padding from the ends of a Markdown body while preserving
 * the indentation of the first content line (pp-f7m.37): `String.trim` would
 * also strip the four leading spaces of a first-line indented code block,
 * which are Markdown syntax, not padding. Only whole blank lines
 * (whitespace-only, plus the newlines separating them from the content) count
 * as padding; the whitespace of the first content line is content and
 * survives, so the canonical `---\n<body>\n` serialization stays byte-stable
 * across save/reload cycles.
 */
export function trimMarkdownBody(body: string): string {
  const first = body.search(/\S/);
  if (first === -1) return "";
  const lineStart = body.lastIndexOf("\n", first) + 1;
  return body.slice(lineStart).trimEnd();
}

function cleanYamlOutput(rawYaml: string): string {
  return rawYaml.replace(/^(.*?:)[ \t]+$/gm, "$1").trimEnd();
}

/**
 * True when `candidate` parses back to exactly `expected` (type-strict, so a
 * stored "0.5" reloading as the number 0.5 fails). Key order is not
 * re-checked here: it is guaranteed upstream by serializing the ordered
 * store object itself.
 */
function isLosslessYaml(candidate: string, expected: Record<string, unknown>): boolean {
  try {
    return isDeepStrictEqual(Bun.YAML.parse(candidate), expected);
  } catch {
    return false;
  }
}

/**
 * Serializes a store object to YAML that is verified to reload identically.
 *
 * Native `Bun.YAML.stringify` is preferred so unambiguous records keep their
 * exact formatting, but its plain scalars are lossy on supported runtimes:
 * strings ending in `:` were written unquoted before Bun 1.3.5 (reloading as
 * mappings), and numeric-looking strings such as `0.5` are still written
 * unquoted on Bun 1.3.9 (reloading as numbers, which made `pp check` report
 * MISSING_MILESTONE_TITLE). Each candidate is therefore parsed back and
 * deep-compared against the input — after cleanYamlOutput, i.e. exactly the
 * text that would be written. On any mismatch the store falls back to
 * `JSON.stringify(…, null, 2)`, itself a valid YAML document with readable
 * quoted strings, verified the same way before being returned.
 */
function yamlForStore(orderedObject: Record<string, unknown>): string {
  let native = "";
  try {
    native = cleanYamlOutput(Bun.YAML.stringify(orderedObject, null, 2));
  } catch {
    // Fall through to the JSON candidate below.
  }
  if (native && isLosslessYaml(native, orderedObject)) return native;
  const json = cleanYamlOutput(JSON.stringify(orderedObject, null, 2));
  if (isLosslessYaml(json, orderedObject)) return json;
  throw new Error(
    `Store serialization could not produce a round-trippable YAML document (keys: ${Object.keys(orderedObject).join(", ")})`
  );
}

function serializeYamlFrontmatter(orderedObject: Record<string, unknown>, body: string): string {
  const yaml = yamlForStore(orderedObject);
  const trimmedBody = trimMarkdownBody(body);
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
  return `${yamlForStore(ordered)}\n`;
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
 *
 * - If `filePath` is a symlink, the link's target is rewritten and the link itself is preserved.
 * - An existing file's permission bits are carried over exactly (so 0600 configs stay private and a
 *   0644 roadmap stays 0644): the staged file is created no wider than those bits, then chmod-ed to
 *   them, since a creation mode alone would be narrowed by the process umask.
 * - New files use `options.mode` when given as the creation mode (an upper bound the umask can only
 *   narrow further; default: process umask, typically 0644).
 */
export function writeFileAtomic(
  filePath: string,
  content: string,
  options: { mode?: number } = {}
): void {
  let targetPath = filePath;
  // Permission bits of the file being replaced. Only captured when no explicit mode is given:
  // an explicit mode is the caller's intentional default and always wins.
  let carriedMode: number | undefined;
  try {
    if (lstatSync(filePath).isSymbolicLink()) {
      targetPath = realpathSync(filePath);
    }
    if (options.mode === undefined) {
      carriedMode = statSync(targetPath).mode & 0o777;
    }
  } catch {
    // Target does not exist yet (or is a dangling link): write a fresh file at filePath
  }
  const createMode = options.mode ?? carriedMode;

  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  );
  try {
    writeFileSync(tmpPath, content, createMode === undefined ? "utf8" : { encoding: "utf8", mode: createMode });
    if (carriedMode !== undefined) {
      // Re-assert the replaced file's exact bits: umask filtering may have narrowed the creation
      // mode (e.g. 0644 under umask 077 would otherwise come out 0600). A chmod failure propagates
      // so the original file stays untouched instead of being replaced with narrowed permissions.
      chmodSync(tmpPath, carriedMode);
    }
    renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failure for non-existent temp file
    }
    throw error;
  }
}
