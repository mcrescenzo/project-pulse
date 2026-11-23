import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeFileAtomic } from "./frontmatter";
import { getAgentsSnippet, RoadmapService } from "./store";

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

export interface SetupOptions {
  agentsMdPath?: string;
  mcpPath?: string;
  skillPath?: string;
  withSkill?: boolean;
  init?: boolean;
  dryRun?: boolean;
}

export interface SetupResult {
  rootDir: string;
  dryRun: boolean;
  actions: SetupAction[];
  mcpConfig: {
    mcpServers: {
      "project-pulse": {
        command: string;
        args: string[];
      };
    };
  };
}

/**
 * Returns the marker-delimited `AGENTS.md` block for Project Pulse.
 */
export function getManagedAgentsBlock(): string {
  return `${AGENTS_BLOCK_START}\n${getAgentsSnippet()}\n${AGENTS_BLOCK_END}`;
}

/**
 * Returns the ready-to-use MCP client configuration snippet for `pp mcp`.
 */
export function getMcpConfigSnippet(): SetupResult["mcpConfig"] {
  return {
    mcpServers: {
      "project-pulse": {
        command: "pp",
        args: ["mcp"],
      },
    },
  };
}

/**
 * Returns an agent skill template (`SKILL.md`) teaching agents how to inspect and update Project Pulse.
 */
export function getSkillTemplate(): string {
  return `---
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
}

/**
 * Merges the managed Project Pulse instructions into an existing `AGENTS.md` without clobbering user content.
 */
export function mergeAgentsMarkdown(
  existing: string | null,
  managedBlock: string = getManagedAgentsBlock()
): { content: string; action: SetupActionKind } {
  if (existing === null) {
    return {
      content: `# Repository Agent Instructions\n\n${managedBlock}\n`,
      action: "create",
    };
  }

  // Match against the original document and splice original slices directly, so every user-owned
  // byte (CRLF endings, trailing whitespace) survives and generated text adopts the document's
  // newline style. Re-running is byte-stable because the restyle choice depends only on the
  // document content itself.
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const styledBlock = managedBlock.replace(/\r\n/g, "\n").replace(/\n/g, newline);

  const startIdx = existing.indexOf(AGENTS_BLOCK_START);
  const endIdx = existing.indexOf(AGENTS_BLOCK_END);

  if (startIdx !== -1 || endIdx !== -1) {
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      throw new Error(
        `Existing AGENTS.md contains unmatched '${AGENTS_BLOCK_START}' / '${AGENTS_BLOCK_END}' markers`
      );
    }
    const next =
      existing.slice(0, startIdx) + styledBlock + existing.slice(endIdx + AGENTS_BLOCK_END.length);
    return {
      content: next === existing ? existing : next,
      action: next === existing ? "unchanged" : "update",
    };
  }

  // Upgrade unmarked snippet pasted from `pp init --agents-snippet` output. Replace only the
  // recognized generated text (its LF endings also match CRLF pastes) so following headings of
  // any level (e.g. a top-level `# Deployment` section) and custom prose around the paste keep
  // every user byte. If no paste matches, fall through to the append path below, which also
  // never removes user bytes.
  const legacySnippetRe = new RegExp(
    `(^|\\n)${escapeRegExp(getAgentsSnippet()).replace(/\n/g, "\\r?\\n")}(?=\\r?\\n|$)`
  );
  const legacyMatch = legacySnippetRe.exec(existing);
  if (legacyMatch) {
    const next =
      existing.slice(0, legacyMatch.index + legacyMatch[1].length) +
      styledBlock +
      existing.slice(legacyMatch.index + legacyMatch[0].length);
    return { content: next, action: "update" };
  }

  // Append after the document's existing trailing whitespace, adding only the newlines still
  // needed for one blank line of separation.
  const pad = newline.repeat(Math.max(0, 2 - trailingNewlineCount(existing)));
  const next =
    existing.length === 0 ? `${styledBlock}${newline}` : `${existing}${pad}${styledBlock}${newline}`;
  return {
    content: next === existing ? existing : next,
    action: next === existing ? "unchanged" : "update",
  };
}

/** Counts the line terminators (`\n` or `\r\n`) at the end of `text`; each contains one `\n`. */
function trailingNewlineCount(text: string): number {
  return /(?:\r?\n)*$/.exec(text)![0].split("\n").length - 1;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeMcpJson(
  existingRaw: string | null,
  mcpPath: string,
  snippet: SetupResult["mcpConfig"]
): { content: string; action: SetupActionKind } {
  if (existingRaw === null) {
    return {
      content: `${JSON.stringify(snippet, null, 2)}\n`,
      action: "create",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingRaw);
  } catch (error) {
    throw new Error(`Invalid JSON in MCP config '${mcpPath}': ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`MCP config '${mcpPath}' must contain a JSON object at top level`);
  }

  const rootObj = parsed as Record<string, unknown>;
  const serversRaw = rootObj.mcpServers;
  if (
    serversRaw !== undefined &&
    (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw))
  ) {
    throw new Error(`MCP config '${mcpPath}' field 'mcpServers' must be an object`);
  }

  const servers = (serversRaw ?? {}) as Record<string, unknown>;
  const existingEntry = servers["project-pulse"] as Record<string, unknown> | undefined;
  const desiredEntry = snippet.mcpServers["project-pulse"];
  const alreadyMatches =
    Boolean(existingEntry) &&
    typeof existingEntry === "object" &&
    !Array.isArray(existingEntry) &&
    existingEntry.command === desiredEntry.command &&
    Array.isArray(existingEntry.args) &&
    existingEntry.args.length === desiredEntry.args.length &&
    existingEntry.args.every((v, i) => v === desiredEntry.args[i]) &&
    Object.keys(existingEntry).length === 2;

  if (alreadyMatches) {
    return { content: existingRaw, action: "unchanged" };
  }

  const merged = {
    ...rootObj,
    mcpServers: {
      ...servers,
      "project-pulse": desiredEntry,
    },
  };
  return {
    content: `${JSON.stringify(merged, null, 2)}\n`,
    action: "update",
  };
}

/**
 * Idempotently configures `AGENTS.md`, optional MCP client JSON, and optional skill templates.
 */
export function runRepoSetup(rootDir: string, options: SetupOptions = {}): SetupResult {
  const absRoot = resolve(rootDir);
  const dryRun = Boolean(options.dryRun);
  const actions: SetupAction[] = [];
  const mcpConfig = getMcpConfigSnippet();

  // 1. Optional .project-pulse/ initialization
  if (options.init) {
    const svc = new RoadmapService(absRoot);
    if (svc.isInitialized()) {
      actions.push({
        target: "roadmap",
        path: svc.configPath,
        action: "unchanged",
        detail: ".project-pulse/ is already initialized",
      });
    } else {
      if (!dryRun) {
        svc.init();
      }
      actions.push({
        target: "roadmap",
        path: svc.configPath,
        action: "create",
        detail: "Initialize .project-pulse/ and ROADMAP.md",
      });
    }
  }

  // 2. AGENTS.md marker-managed instructions
  const agentsTarget = options.agentsMdPath
    ? resolve(absRoot, options.agentsMdPath)
    : join(absRoot, "AGENTS.md");
  const existingAgents = existsSync(agentsTarget) ? readFileSync(agentsTarget, "utf8") : null;
  const mergedAgents = mergeAgentsMarkdown(existingAgents);
  if (!dryRun && mergedAgents.action !== "unchanged") {
    writeFileAtomic(agentsTarget, mergedAgents.content);
  }
  actions.push({
    target: "agents-md",
    path: agentsTarget,
    action: mergedAgents.action,
    detail:
      mergedAgents.action === "unchanged"
        ? "AGENTS.md already has up-to-date Project Pulse instructions"
        : `${mergedAgents.action === "create" ? "Create" : "Update"} Project Pulse instructions in AGENTS.md`,
  });

  // 3. Optional MCP client config merge
  if (options.mcpPath) {
    const mcpTarget = resolve(absRoot, options.mcpPath);
    const existingMcp = existsSync(mcpTarget) ? readFileSync(mcpTarget, "utf8") : null;
    const mergedMcp = mergeMcpJson(existingMcp, mcpTarget, mcpConfig);
    if (!dryRun && mergedMcp.action !== "unchanged") {
      writeFileAtomic(mcpTarget, mergedMcp.content);
    }
    actions.push({
      target: "mcp-config",
      path: mcpTarget,
      action: mergedMcp.action,
      detail:
        mergedMcp.action === "unchanged"
          ? "MCP config already contains project-pulse server entry"
          : `${mergedMcp.action === "create" ? "Create" : "Add"} project-pulse server entry in MCP config`,
    });
  }

  // 4. Optional skill template
  if (options.withSkill || options.skillPath) {
    const skillTarget = options.skillPath
      ? resolve(absRoot, options.skillPath)
      : join(absRoot, DEFAULT_SKILL_REL_PATH);
    const desiredSkill = getSkillTemplate();
    const existingSkill = existsSync(skillTarget) ? readFileSync(skillTarget, "utf8") : null;
    const skillAction: SetupActionKind =
      existingSkill === null ? "create" : existingSkill === desiredSkill ? "unchanged" : "update";
    if (!dryRun && skillAction !== "unchanged") {
      writeFileAtomic(skillTarget, desiredSkill);
    }
    actions.push({
      target: "skill",
      path: skillTarget,
      action: skillAction,
      detail:
        skillAction === "unchanged"
          ? "Project Pulse skill template is up-to-date"
          : `${skillAction === "create" ? "Install" : "Update"} Project Pulse SKILL.md template`,
    });
  }

  return {
    rootDir: absRoot,
    dryRun,
    actions,
    mcpConfig,
  };
}
