import { isUtf8 } from "node:buffer";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./frontmatter";
import { isGeneratedRoadmapContent, type InitOptions, type InitResult, type RoadmapService } from "./store";
import { STORE_LOCK_FILE_NAME, StoreConflictError, withStoreLock } from "./store-lock";

export const AGENTS_BLOCK_START = "<!-- project-pulse:start -->";
export const AGENTS_BLOCK_END = "<!-- project-pulse:end -->";
export const DEFAULT_SKILL_REL_PATH = join(".agents", "skills", "project-pulse", "SKILL.md");

export type SetupActionKind = "create" | "update" | "unchanged";

export interface SetupAction {
  target: "roadmap" | "agents-md" | "mcp-config" | "skill";
  path: string;
  action: SetupActionKind;
  detail: string;
}

const AGENTS_HEADING = "## Project Roadmap (`project-pulse` / `pp`)";
const BEADS_WORKFLOW =
  "Use Project Pulse for milestones, features, and acceptance criteria. Use Beads for execution work: issues, bugs, and blockers. " +
  "Link related issues to a feature with `bd:<id>` instead of copying the task list. Closing an issue does not ship the feature.";
const WORKFLOW_COMMANDS = {
  base: {
    show: "Use `pp show <feature-id>` for details.",
    check: "`pp check` for schema integrity",
  },
  beads: {
    show: "Use `pp show <feature-id> --beads` for linked issue status.",
    check: "`pp check --beads` for schema integrity and drift",
  },
};

function getAgentsSnippet(beadsAware: boolean): string {
  const { show, check } = WORKFLOW_COMMANDS[beadsAware ? "beads" : "base"];
  return `${AGENTS_HEADING}

High-level milestones and features live in \`.project-pulse/\` and compile into \`ROADMAP.md\`.
${beadsAware ? `\n${BEADS_WORKFLOW}\n\n` : ""}- **Golden rule:** Never edit \`ROADMAP.md\` or \`.project-pulse/*.md\` by hand — use \`pp\` CLI commands or \`pp mcp\`.
- **Orient:** Run \`pp summary\` at session start for strategic context. ${show}
- **Update progress:** Use \`pp feature check <id> <criterion>\`, \`pp feature note <id> "<note>"\`, and \`pp feature update <id> --status <status>\`.
- **Validate:** Run ${check} before wrapping up.`;
}

function getManagedAgentsBlock(beadsAware: boolean): string {
  return `${AGENTS_BLOCK_START}\n${getAgentsSnippet(beadsAware)}\n${AGENTS_BLOCK_END}`;
}

// Exact recognition input for past `pp init --agents-snippet` output.
const LEGACY_AGENTS_SNIPPET = `${AGENTS_HEADING}

High-level milestones and features live in \`.project-pulse/\` and compile into \`ROADMAP.md\`.
- **Golden rule:** Never edit \`ROADMAP.md\` or \`.project-pulse/*.md\` by hand — use \`pp\` CLI commands or \`pp mcp\`.
- **Orient:** Run \`pp summary\` (or \`pp show <feature-id> --beads\`) at session start for strategic context.
- **Update progress:** Use \`pp feature check <id> <criterion>\`, \`pp feature note <id> "<note>"\`, and \`pp feature update <id> --status <status>\`.
- **Validate:** Run \`pp check --beads\` before wrapping up to confirm schema integrity and Beads alignment.`;

/**
 * Returns the ready-to-use MCP client configuration snippet for `pp mcp`.
 */
function getMcpConfigSnippet() {
  return {
    mcpServers: {
      "project-pulse": {
        command: "pp",
        args: ["mcp"],
      },
    },
  };
}

function getSkillTemplate(beadsAware: boolean): string {
  const { show, check } = WORKFLOW_COMMANDS[beadsAware ? "beads" : "base"];
  return `---
name: project-pulse
description: Inspect and maintain the repository's high-level product roadmap in .project-pulse/ using pp CLI commands or pp mcp without editing ROADMAP.md manually.
---

# Project Pulse Roadmap Skill

${beadsAware ? BEADS_WORKFLOW : "Use `project-pulse` (`pp`) to track high-level milestones and features rather than granular daily tasks."}

## Workflow
- **Orient first:** Run \`pp summary\` at session start. ${show}
- **Keep generated files sacred:** Never hand-edit \`ROADMAP.md\` or \`.project-pulse/*.md\`; always use \`pp\` CLI commands or \`pp mcp\` tools.
- **Log progress:**
  - \`pp feature update <id> --status in-progress\`
  - \`pp feature check <id> <criterion-id-or-index> --done\`
  - \`pp feature note <id> "<concise milestone progress>"\`
- **Review & validate:**
  - Run \`pp digest --since 7d\` or \`pp changelog\` to summarize recent roadmap movement.
  - Run ${check} before wrapping up.
`;
}

// Exact recognition input for the skill installed by the former setup command.
const LEGACY_SKILL_TEMPLATE = `---
name: project-pulse
description: Inspect and maintain the repository's high-level product roadmap in .project-pulse/ using pp CLI commands or pp mcp without editing ROADMAP.md manually.
---

# Project Pulse Roadmap Skill

Use \`project-pulse\` (\`pp\`) to track high-level milestones and features rather than granular daily tasks.

## Workflow
- **Orient first:** Run \`pp summary\` (or \`pp show <feature-id> --beads\`) at session start.
- **Keep generated files sacred:** Never hand-edit \`ROADMAP.md\` or \`.project-pulse/*.md\`; always use \`pp\` CLI commands or \`pp mcp\` tools.
- **Log progress cleanly:**
  - \`pp feature update <id> --status in-progress\`
  - \`pp feature check <id> <criterion-id-or-index> --done\`
  - \`pp feature note <id> "<concise milestone progress>"\`
- **Review & validate:**
  - Run \`pp digest --since 7d\` or \`pp changelog\` to summarize recent roadmap movement.
  - Run \`pp check --beads\` before wrapping up to confirm zero schema or Beads drift.
`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeAgentsMarkdown(existing: string | null, managedBlock: string, path: string): string {
  if (existing === null) return `# Repository Agent Instructions\n\n${managedBlock}\n`;

  // Splice original slices instead of rebuilding the document; user bytes and line endings
  // outside the block must survive, even in a document with mixed line endings.
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const startIdx = existing.indexOf(AGENTS_BLOCK_START);
  const endIdx = existing.indexOf(AGENTS_BLOCK_END);
  if (startIdx !== -1 || endIdx !== -1) {
    const start = new RegExp(`^[ \\t]*${AGENTS_BLOCK_START}[ \\t]*(?=\\r?$)`, "m").exec(existing);
    const end = new RegExp(`^[ \\t]*${AGENTS_BLOCK_END}[ \\t]*(?=\\r?$)`, "m").exec(existing);
    if (
      !start || !end || start.index >= end.index ||
      startIdx !== existing.lastIndexOf(AGENTS_BLOCK_START) ||
      endIdx !== existing.lastIndexOf(AGENTS_BLOCK_END)
    ) {
      throw new Error(`Malformed Project Pulse markers in '${path}'. Fix the markers or omit --with-agents.`);
    }
    const blockNewline = existing.startsWith("\r\n", start.index + start[0].length) ? "\r\n" : "\n";
    return (
      existing.slice(0, start.index) +
      managedBlock.replaceAll("\n", blockNewline) +
      existing.slice(end.index + end[0].length)
    );
  }

  const styledBlock = managedBlock.replaceAll("\n", newline);
  const headingPattern = new RegExp(`^ {0,3}${escapeRegExp(AGENTS_HEADING)}[ \\t]*(?=\\r?$)`, "gm");
  const headings = [...existing.matchAll(headingPattern)];
  if (headings.length > 0) {
    const heading = headings[0]!;
    const rest = existing.slice(heading.index + heading[0].length);
    const nextSection = rest.search(/^ {0,3}#{1,2}(?:[ \t]|(?=\r?$))/m);
    const section = heading[0] + (nextSection === -1 ? rest : rest.slice(0, nextSection));
    if (headings.length === 1) {
      for (const snippet of [LEGACY_AGENTS_SNIPPET, getAgentsSnippet(false), getAgentsSnippet(true)]) {
        const pattern = escapeRegExp(snippet).replaceAll("\n", "\\r?\\n");
        const stock = new RegExp(`^(${pattern})(?:\\r?\\n[ \\t]*)*$`).exec(section)?.[1];
        if (stock !== undefined) {
          return existing.slice(0, heading.index) + styledBlock + existing.slice(heading.index + stock.length);
        }
      }
    }
    throw new Error(
      `Unmarked Project Roadmap section in '${path}' contains custom instructions. ` +
        "Move them out of that section and retry, or omit --with-agents."
    );
  }

  if (!existing) return `${styledBlock}${newline}`;
  const pad = existing.endsWith(newline + newline) ? "" : existing.endsWith("\n") ? newline : newline + newline;
  return `${existing}${pad}${styledBlock}${newline}`;
}

function mergeMcpJson(existingRaw: string | null, mcpPath: string): string {
  const snippet = getMcpConfigSnippet();
  if (existingRaw === null) return `${JSON.stringify(snippet, null, 2)}\n`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingRaw);
  } catch {
    throw new Error(`Invalid JSON in MCP config '${mcpPath}'. Fix it or omit --with-mcp.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`MCP config '${mcpPath}' must contain a JSON object at top level. Fix it or omit --with-mcp.`);
  }

  const rootObj = parsed as Record<string, unknown>;
  const serversRaw = rootObj.mcpServers;
  if (
    serversRaw !== undefined &&
    (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw))
  ) {
    throw new Error(`MCP config '${mcpPath}' field 'mcpServers' must be an object. Fix it or omit --with-mcp.`);
  }

  const servers = (serversRaw ?? {}) as Record<string, unknown>;
  const desiredEntry = snippet.mcpServers["project-pulse"];
  if (Object.hasOwn(servers, "project-pulse")) {
    const entry = servers["project-pulse"];
    if (
      entry && typeof entry === "object" && !Array.isArray(entry) &&
      Object.keys(entry).length === 2 && "command" in entry && "args" in entry &&
      entry.command === desiredEntry.command && Array.isArray(entry.args) &&
      entry.args.length === desiredEntry.args.length &&
      entry.args.every((arg, index) => arg === desiredEntry.args[index])
    ) {
      return existingRaw;
    }
    throw new Error(
      `Conflicting project-pulse entry in MCP config '${mcpPath}'. Resolve it or omit --with-mcp.`
    );
  }

  return `${JSON.stringify({ ...rootObj, mcpServers: { ...servers, "project-pulse": desiredEntry } }, null, 2)}\n`;
}

function mergeSkill(existing: string | null, beadsAware: boolean, path: string): string {
  const desired = getSkillTemplate(beadsAware);
  if (existing === null) return desired;
  const normalized = existing.replaceAll("\r\n", "\n");
  if (normalized === desired) return existing;
  if (normalized !== LEGACY_SKILL_TEMPLATE && normalized !== getSkillTemplate(!beadsAware)) {
    throw new Error(`Custom skill at '${path}'. Move it aside or omit --with-skill.`);
  }
  return existing.includes("\r\n") ? desired.replaceAll("\n", "\r\n") : desired;
}

function lstatIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function hasBeadsMarker(root: string): boolean {
  const directory = join(root, ".beads");
  if (!lstatIfPresent(directory)?.isDirectory()) return false;
  return ["config.yaml", "metadata.json", "redirect"].some((name) =>
    lstatIfPresent(join(directory, name))?.isFile()
  );
}

/** Prepare every selected file before writing any of them. */
export function prepareRepoInit(
  service: RoadmapService,
  options: InitOptions & {
    writeRoadmap: boolean;
    withAgents: boolean;
    withMcp: boolean;
    withSkill: boolean;
    includeSnippet: boolean;
  }
): { result: InitResult; actions: SetupAction[]; agentsSnippet?: string; apply(): void } {
  const { rootDir, pulseDir, configPath, roadmapPath, milestonesDir, featuresDir } = service;
  const selected: Omit<SetupAction, "action">[] = [];
  if (options.withAgents) {
    selected.push({
      target: "agents-md",
      path: join(rootDir, "AGENTS.md"),
      detail: "Project Pulse instructions",
    });
  }
  if (options.withMcp) {
    selected.push({
      target: "mcp-config",
      path: join(rootDir, ".mcp.json"),
      detail: "Project Pulse server entry (compatible clients only)",
    });
  }
  if (options.withSkill) {
    selected.push({
      target: "skill",
      path: join(rootDir, DEFAULT_SKILL_REL_PATH),
      detail: "Repo-local Project Pulse skill",
    });
  }

  const lockPath = join(pulseDir, STORE_LOCK_FILE_NAME);
  const paths = new Map<string, "directory" | "regular file">();
  function addPath(path: string, kind: "directory" | "regular file"): void {
    if (path === rootDir || paths.has(path)) return;
    addPath(dirname(path), "directory");
    paths.set(path, kind);
  }
  addPath(configPath, "regular file");
  if (options.writeRoadmap) {
    addPath(roadmapPath, "regular file");
    addPath(milestonesDir, "directory");
    addPath(featuresDir, "directory");
    addPath(lockPath, "regular file");
  }
  for (const { path } of selected) addPath(path, "regular file");

  function preflight(): Set<string> {
    const present = new Set<string>();
    for (const [path, kind] of paths) {
      const stat = lstatIfPresent(path);
      if (!stat) continue;
      if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) {
        throw new Error(`Expected a ${kind} at '${path}' (symlinks are not allowed). Fix the path and rerun 'pp init'.`);
      }
      present.add(path);
    }
    return present;
  }

  const present = preflight();
  const originals = new Map<string, Buffer | undefined>();
  const inputs = [configPath, ...(options.writeRoadmap ? [roadmapPath] : []), ...selected.map((file) => file.path)];
  for (const path of inputs) {
    originals.set(path, present.has(path) ? readFileSync(path) : undefined);
  }

  const roadmap = options.writeRoadmap ? service.prepareInit(options) : undefined;
  if (!roadmap && !originals.get(configPath)) {
    throw new Error(`'${configPath}' is no longer present. Rerun 'pp init'.`);
  }
  const result: InitResult = roadmap?.result ?? {
    pulseDir, configPath, roadmapPath, config: service.loadConfig(), created: false,
  };
  const beadsAware =
    (options.withAgents || options.withSkill || options.includeSnippet) &&
    result.config.integrations.beads.enabled && hasBeadsMarker(rootDir);
  const originalRoadmap = originals.get(roadmapPath);
  const forcedReplacement = options.force && originalRoadmap !== undefined &&
    !isGeneratedRoadmapContent(originalRoadmap.toString());
  const actions: SetupAction[] = [
    {
      target: "roadmap", path: configPath,
      action: roadmap?.writesConfig ? (present.has(configPath) ? "update" : "create") : "unchanged",
      detail: roadmap?.writesConfig ? "Write project configuration" : "Keep existing project configuration",
    },
    {
      target: "roadmap", path: roadmapPath,
      action: roadmap ? (present.has(roadmapPath) ? "update" : "create") : "unchanged",
      detail: forcedReplacement
        ? "Replace hand-written roadmap (--force)"
        : roadmap ? "Generate project roadmap" : "Leave roadmap untouched",
    },
  ];
  const writes: { path: string; content: string }[] = [];
  for (const file of selected) {
    const original = originals.get(file.path);
    if (original && !isUtf8(original)) {
      const option = file.target === "agents-md" ? "agents" : file.target === "mcp-config" ? "mcp" : "skill";
      throw new Error(`'${file.path}' is not UTF-8. Fix it or omit --with-${option}.`);
    }
    const existing = original?.toString() ?? null;
    const content =
      file.target === "agents-md" ? mergeAgentsMarkdown(existing, getManagedAgentsBlock(beadsAware), file.path) :
      file.target === "mcp-config" ? mergeMcpJson(existing, file.path) :
      mergeSkill(existing, beadsAware, file.path);
    const action = existing === null ? "create" : content === existing ? "unchanged" : "update";
    actions.push({ ...file, action });
    if (action !== "unchanged") writes.push({ path: file.path, content });
  }

  function verifyOriginals(): void {
    const currentPaths = preflight();
    for (const [path, original] of originals) {
      let current: Buffer | undefined;
      if (currentPaths.has(path)) {
        try {
          current = readFileSync(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (original === undefined ? current !== undefined : !current?.equals(original)) {
        throw new Error(`'${path}' changed since the initialization preview. Retry by running 'pp init' again.`);
      }
    }
  }

  function applyFiles(): void {
    roadmap?.apply();
    for (const { path, content } of writes) {
      try {
        writeFileAtomic(path, content);
      } catch (error) {
        throw new Error(
          `Cannot apply initialization at '${path}': ${(error as Error).message} Inspect the files and retry.`,
          { cause: error }
        );
      }
    }
  }

  return {
    result,
    actions,
    agentsSnippet: options.includeSnippet ? getAgentsSnippet(beadsAware) : undefined,
    apply() {
      if (!roadmap && writes.length === 0) return;
      verifyOriginals();
      if (!roadmap) {
        applyFiles();
        return;
      }

      // Check again inside the re-entrant store lock: a writer can change the files
      // while we wait for the lock. Check first above so a rejected preview creates no lock file.
      let locked = false;
      try {
        withStoreLock(pulseDir, () => {
          locked = true;
          verifyOriginals();
          applyFiles();
        });
      } catch (error) {
        if (locked || error instanceof StoreConflictError) throw error;
        throw new Error(
          `Cannot apply initialization at '${lockPath}': ${(error as Error).message} Inspect the files and retry.`,
          { cause: error }
        );
      }
    },
  };
}
