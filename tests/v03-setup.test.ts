import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import {
  AGENTS_BLOCK_END,
  AGENTS_BLOCK_START,
  DEFAULT_SKILL_REL_PATH,
  getManagedAgentsBlock,
  mergeAgentsMarkdown,
  runRepoSetup,
} from "../src/setup";
import { getAgentsSnippet } from "../src/store";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-setup-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function captureCli(args: string[], cwd = tempDir): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => err.push(a.map(String).join(" "));
  try {
    const code = await runCli(args, { cwd });
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

describe("v0.3 Agent Onboarding & Repo Setup (pp setup)", () => {
  test("creates AGENTS.md from scratch, prints MCP snippet, and is idempotent on re-run", async () => {
    const first = await captureCli(["setup", "--init", "--with-skill", "--json"]);
    expect(first.code).toBe(0);
    const res1 = JSON.parse(first.stdout);
    expect(res1.actions.map((a: { action: string }) => a.action)).toEqual([
      "create",
      "create",
      "create",
    ]);

    expect(existsSync(join(tempDir, ".project-pulse/config.yaml"))).toBe(true);
    expect(existsSync(join(tempDir, "ROADMAP.md"))).toBe(true);
    const agentsMd = readFileSync(join(tempDir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain(AGENTS_BLOCK_START);
    expect(agentsMd).toContain(AGENTS_BLOCK_END);
    expect(agentsMd).toContain("pp summary");

    const skillPath = join(tempDir, DEFAULT_SKILL_REL_PATH);
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, "utf8")).toContain("name: project-pulse");

    // Second run performs zero mutations and reports 'unchanged'
    const second = await captureCli(["setup", "--init", "--with-skill", "--json"]);
    expect(second.code).toBe(0);
    const res2 = JSON.parse(second.stdout);
    expect(res2.actions.map((a: { action: string }) => a.action)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });

  test("preserves existing user content in AGENTS.md and upgrades unmarked sections cleanly", () => {
    const customAgents = [
      "# Team Instructions",
      "",
      "## Build & Test",
      "- Run `bun test`",
      "",
      "## Coding Conventions",
      "- Keep functions small.",
      "",
    ].join("\n");
    writeFileSync(join(tempDir, "AGENTS.md"), customAgents, "utf8");

    const res = runRepoSetup(tempDir);
    expect(res.actions[0]?.action).toBe("update");
    const updated = readFileSync(join(tempDir, "AGENTS.md"), "utf8");
    expect(updated).toContain("## Build & Test");
    expect(updated).toContain("## Coding Conventions");
    expect(updated).toContain(AGENTS_BLOCK_START);

    // Unmarked section pasted from `pp init --agents-snippet` upgrades in-place without duplication
    const pastedLegacy = [
      "# Repo Guide",
      "",
      getAgentsSnippet(),
      "",
      "## Footer Rules",
      "- Preserve comments.",
      "",
    ].join("\n");
    const upgraded = mergeAgentsMarkdown(pastedLegacy);
    expect(upgraded.action).toBe("update");
    expect(upgraded.content).toContain("# Repo Guide");
    expect(upgraded.content).toContain("## Footer Rules");
    expect(upgraded.content).toContain(AGENTS_BLOCK_START);
    expect(upgraded.content.match(/Project Roadmap/g)?.length).toBe(1);
  });

  test("migrates unmarked legacy snippet byte-exactly, keeping top-level sections, same-section prose, and double-run stability", () => {
    const managedBlock = getManagedAgentsBlock();

    // Regression: a legacy paste followed by a top-level (`# `) section must not swallow that
    // section; migration replaces only the recognized generated text.
    const withDeployment = [
      "# Repo Guide",
      "",
      "Intro prose.",
      "",
      getAgentsSnippet(),
      "",
      "# Deployment",
      "",
      "- Ship via `pp` releases.",
      "",
    ].join("\n");
    const migrated = mergeAgentsMarkdown(withDeployment);
    expect(migrated.action).toBe("update");
    expect(migrated.content).toBe(
      `# Repo Guide\n\nIntro prose.\n\n${managedBlock}\n\n# Deployment\n\n- Ship via \`pp\` releases.\n`
    );

    // Custom prose written inside the same section after the paste survives the upgrade
    const withProse = [
      "# Repo Guide",
      "",
      getAgentsSnippet(),
      "",
      "> Team note: also check RELEASES.md before merging.",
      "",
    ].join("\n");
    const proseMigrated = mergeAgentsMarkdown(withProse);
    expect(proseMigrated.action).toBe("update");
    expect(proseMigrated.content).toBe(
      `# Repo Guide\n\n${managedBlock}\n\n> Team note: also check RELEASES.md before merging.\n`
    );

    // Re-running the merge on already-migrated output is byte-stable
    const reMigrated = mergeAgentsMarkdown(migrated.content);
    expect(reMigrated.action).toBe("unchanged");
    expect(reMigrated.content).toBe(migrated.content);

    // Heading whose body no longer matches the generated snippet is not migrated; the fallback
    // appends the managed block and preserves every user byte
    const edited = [
      "# Repo Guide",
      "",
      "## Project Roadmap (`project-pulse` / `pp`)",
      "",
      "Hand-written workflow notes that do not match the generated snippet.",
      "",
    ].join("\n");
    const fallback = mergeAgentsMarkdown(edited);
    expect(fallback.action).toBe("update");
    expect(fallback.content).toBe(`${edited.trimEnd()}\n\n${managedBlock}\n`);
  });

  test("upgrades CRLF originals byte-exactly, restyling the managed block to CRLF", () => {
    const crlfBlock = getManagedAgentsBlock().replace(/\n/g, "\r\n");
    const original = [
      "# Repo Guide",
      "",
      getAgentsSnippet(),
      "",
      "# Deployment",
      "",
      "- Keep the release checklist current.",
      "",
      "",
    ].join("\r\n");
    const migrated = mergeAgentsMarkdown(original);
    expect(migrated.action).toBe("update");
    expect(migrated.content).toBe(
      `# Repo Guide\r\n\r\n${crlfBlock}\r\n\r\n# Deployment\r\n\r\n- Keep the release checklist current.\r\n\r\n`
    );

    // Re-running on migrated output is byte-stable via the managed path
    const rerun = mergeAgentsMarkdown(migrated.content);
    expect(rerun.action).toBe("unchanged");
    expect(rerun.content).toBe(migrated.content);

    // Append fallback preserves the document's trailing whitespace instead of trimming it
    const appended = mergeAgentsMarkdown("# Notes\n\n\n");
    expect(appended.action).toBe("update");
    expect(appended.content).toBe(`# Notes\n\n\n${getManagedAgentsBlock()}\n`);
  });

  test("merges into existing MCP config preserving sibling servers and supports --dry-run", async () => {
    const mcpPath = join(tempDir, ".mcp.json");
    writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            otherTool: { command: "npx", args: ["other-mcp"] },
          },
          extraSetting: true,
        },
        null,
        2
      ),
      "utf8"
    );

    // Dry-run plans changes without writing disk
    const customSkill = join(tempDir, "skills", "pp-skill.md");
    const dryRes = await captureCli([
      "setup",
      "--init",
      "--mcp",
      ".mcp.json",
      "--skill",
      "skills/pp-skill.md",
      "--dry-run",
      "--json",
    ]);
    expect(dryRes.code).toBe(0);
    const dryJson = JSON.parse(dryRes.stdout);
    expect(dryJson.dryRun).toBe(true);
    expect(dryJson.actions.some((a: { action: string }) => a.action === "create" || a.action === "update")).toBe(true);
    expect(existsSync(join(tempDir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(tempDir, ".project-pulse/config.yaml"))).toBe(false);
    expect(existsSync(customSkill)).toBe(false);
    expect(readFileSync(mcpPath, "utf8")).not.toContain("project-pulse");

    // Apply for real
    const applyRes = await captureCli([
      "setup",
      "--mcp",
      ".mcp.json",
      "--skill",
      "skills/pp-skill.md",
      "--json",
    ]);
    expect(applyRes.code).toBe(0);
    const mergedMcp = JSON.parse(readFileSync(mcpPath, "utf8"));
    expect(mergedMcp.extraSetting).toBe(true);
    expect(mergedMcp.mcpServers.otherTool).toEqual({ command: "npx", args: ["other-mcp"] });
    expect(mergedMcp.mcpServers["project-pulse"]).toEqual({ command: "pp", args: ["mcp"] });
    expect(existsSync(customSkill)).toBe(true);

    // Invalid existing JSON fails cleanly before writing
    const badMcp = join(tempDir, "bad-mcp.json");
    writeFileSync(badMcp, "{ invalid json", "utf8");
    const badRes = await captureCli(["setup", "--mcp", "bad-mcp.json"]);
    expect(badRes.code).toBe(1);
    expect(badRes.stderr).toContain("Invalid JSON");

    // Text mode prints MCP JSON snippet when --mcp is omitted
    const subDir = join(tempDir, "nested");
    mkdirSync(subDir, { recursive: true });
    const textOut = await captureCli(["setup"], subDir);
    expect(textOut.code).toBe(0);
    expect(textOut.stdout).toContain('"project-pulse"');
  });

  test("updates only owned command/args on a customized project-pulse entry, keeping extra fields and siblings, and is a no-op once owned fields match", () => {
    const mcpPath = join(tempDir, ".mcp.json");
    writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            otherTool: { command: "npx", args: ["other-mcp"], env: { DEBUG: "1" } },
            "project-pulse": {
              command: "node",
              args: ["/old/path/pulse.js"],
              env: { PP_TOKEN: "secret" },
              disabled: true,
            },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    // Stale owned fields trigger an update, but only command/args change on the entry
    const first = runRepoSetup(tempDir, { mcpPath: ".mcp.json" });
    const firstAction = first.actions.find((a) => a.target === "mcp-config");
    expect(firstAction?.action).toBe("update");
    const updated = JSON.parse(readFileSync(mcpPath, "utf8"));
    expect(updated.mcpServers["project-pulse"]).toEqual({
      command: "pp",
      args: ["mcp"],
      env: { PP_TOKEN: "secret" },
      disabled: true,
    });
    expect(updated.mcpServers.otherTool).toEqual({ command: "npx", args: ["other-mcp"], env: { DEBUG: "1" } });

    // With owned fields matching, extra fields do not force a rewrite: second setup is a no-op
    const afterFirst = readFileSync(mcpPath, "utf8");
    const second = runRepoSetup(tempDir, { mcpPath: ".mcp.json" });
    const secondAction = second.actions.find((a) => a.target === "mcp-config");
    expect(secondAction?.action).toBe("unchanged");
    expect(readFileSync(mcpPath, "utf8")).toBe(afterFirst);

    // An entry whose owned fields already match is left byte-identical on first contact too
    const customized = join(tempDir, "custom-mcp.json");
    writeFileSync(
      customized,
      JSON.stringify(
        {
          mcpServers: {
            "project-pulse": { command: "pp", args: ["mcp"], env: { PP_TOKEN: "secret" }, disabled: true },
          },
        },
        null,
        2
      ),
      "utf8"
    );
    const customizedRaw = readFileSync(customized, "utf8");
    const customizedRun = runRepoSetup(tempDir, { mcpPath: "custom-mcp.json" });
    const customizedAction = customizedRun.actions.find((a) => a.target === "mcp-config");
    expect(customizedAction?.action).toBe("unchanged");
    expect(readFileSync(customized, "utf8")).toBe(customizedRaw);
  });
});
