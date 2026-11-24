import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runCli } from "../src/cli-main";
import { ROADMAP_GENERATED_MARKER } from "../src/renderer";
import { AGENTS_BLOCK_END, AGENTS_BLOCK_START, DEFAULT_SKILL_REL_PATH, type SetupAction } from "../src/setup";

const CONFIG = ".project-pulse/config.yaml";
const ROADMAP = "ROADMAP.md";
const AGENTS = "AGENTS.md";
const MCP = ".mcp.json";
const SKILL = DEFAULT_SKILL_REL_PATH;
const ALL_EXTRAS = ["--with-agents", "--with-mcp", "--with-skill"];
const GENERATED_HEADER = `${ROADMAP_GENERATED_MARKER} Do not edit manually. -->\n`;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-init-"));
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
    const code = await runCli(args, { cwd, isTty: false });
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

function read(path: string): string {
  return readFileSync(join(tempDir, path), "utf8");
}

function write(path: string, content: string): void {
  const absolute = join(tempDir, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function present(path: string): boolean {
  return existsSync(join(tempDir, path));
}

function planned(stdout: string): [string, string][] {
  return JSON.parse(stdout).actions.map(({ path, action }: SetupAction) => [path, action]);
}

describe("pp init", () => {
  test("bare JSON init keeps its shape and creates only roadmap storage", async () => {
    const result = await captureCli(["init", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      pulseDir: join(tempDir, ".project-pulse"),
      configPath: join(tempDir, CONFIG),
      roadmapPath: join(tempDir, ROADMAP),
      created: true,
      config: {
        version: 1,
        project: { name: basename(tempDir), summary: "High-level product roadmap managed with project-pulse." },
        defaults: { milestone: "backlog" },
        integrations: { beads: { enabled: true } },
      },
    });
    expect(readdirSync(tempDir).sort()).toEqual([".project-pulse", ROADMAP]);
    expect(read(ROADMAP).slice(0, GENERATED_HEADER.length)).toBe(GENERATED_HEADER);
  });

  test("dry run plans every selected file without creating anything", async () => {
    const result = await captureCli(["init", "--json", "--dry-run", ...ALL_EXTRAS]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ created: true, dryRun: true });
    expect(planned(result.stdout)).toEqual(
      [CONFIG, ROADMAP, AGENTS, MCP, SKILL].map((path) => [join(tempDir, path), "create"])
    );
    expect(readdirSync(tempDir)).toEqual([]);
  });

  test("applies selected outputs, preserves sibling MCP settings, and leaves an existing roadmap untouched on refresh", async () => {
    const agentsBefore = "# Team instructions  \n\n\n";
    const mcpBefore = { mcpServers: { otherTool: { command: "npx", args: ["other-mcp"] } }, extraSetting: true };
    write(AGENTS, agentsBefore);
    write(MCP, JSON.stringify(mcpBefore));
    const first = await captureCli(["init", "--json", ...ALL_EXTRAS]);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ created: true, dryRun: false });
    expect(planned(first.stdout)).toEqual([
      [join(tempDir, CONFIG), "create"],
      [join(tempDir, ROADMAP), "create"],
      [join(tempDir, AGENTS), "update"],
      [join(tempDir, MCP), "update"],
      [join(tempDir, SKILL), "create"],
    ]);
    const agentsPrefix = agentsBefore + AGENTS_BLOCK_START;
    expect(read(AGENTS).slice(0, agentsPrefix.length)).toBe(agentsPrefix);
    expect(read(SKILL)).toContain("name: project-pulse");
    expect(JSON.parse(read(MCP))).toEqual({
      ...mcpBefore,
      mcpServers: { ...mcpBefore.mcpServers, "project-pulse": { command: "pp", args: ["mcp"] } },
    });

    expect((await captureCli(["milestone", "add", "backlog", "--title", "Backlog"])).code).toBe(0);
    expect((await captureCli(["feature", "add", "real", "--title", "Real feature"])).code).toBe(0);
    const generated = read(ROADMAP);
    expect(generated).toContain("Real feature");
    const stale = `${GENERATED_HEADER}\n# Stale roadmap\n`;
    write(ROADMAP, stale);
    write(MCP, JSON.stringify(JSON.parse(read(MCP))) + " \n");
    const paths = [CONFIG, ".project-pulse/features/real.md", ROADMAP, AGENTS, MCP, SKILL];
    const before = paths.map(read);
    const rerun = await captureCli(["init", "--json", ...ALL_EXTRAS]);
    expect(rerun.code).toBe(0);
    expect(JSON.parse(rerun.stdout).created).toBe(false);
    expect(planned(rerun.stdout)).toEqual(
      [CONFIG, ROADMAP, AGENTS, MCP, SKILL].map((path) => [join(tempDir, path), "unchanged"])
    );
    expect(paths.map(read)).toEqual(before);

    const bareRerun = await captureCli(["init", "--non-interactive"]);
    expect(bareRerun.code).toBe(0);
    expect(bareRerun.stdout).toMatch(/^Updated \.project-pulse\//);
    expect(read(ROADMAP)).toBe(generated);
  });

  test("retires setup and enables only the selected extra from the selected root", async () => {
    const retired = await captureCli(["setup", "--json"]);
    expect(retired.code).toBe(1);
    expect(JSON.parse(retired.stdout)).toEqual({ ok: false, error: "Unknown command: setup" });
    expect((await captureCli(["init", "--json"])).code).toBe(0);
    const nested = join(tempDir, "nested");
    mkdirSync(nested);
    const init = await captureCli(["init", "--with-agents", "--json"], nested);
    expect(init.code).toBe(0);
    expect(JSON.parse(init.stdout).created).toBe(true);
    expect(readdirSync(nested).sort()).toEqual([".project-pulse", AGENTS, ROADMAP]);
    expect(present(AGENTS)).toBe(false);
  });

  test("refreshes both guidance files with Beads marker changes and preserves adjacent CRLF bytes", async () => {
    const prefix = "# Guide\r\n\r\nTeam notes  \r\n\r\n";
    const suffix = "\r\n\r\n# Deployment\r\n\r\nKeep the checklist current.  \r\n\r\n";
    write(AGENTS, `${prefix}${AGENTS_BLOCK_START}\r\nOld content\r\n${AGENTS_BLOCK_END}${suffix}`);
    mkdirSync(join(tempDir, ".beads"));
    expect((await captureCli(["init", "--json"])).code).toBe(0);
    const config = read(CONFIG);
    const roadmap = read(ROADMAP);
    const refresh = ["init", "--json", "--with-agents", "--with-skill", "--agents-snippet"];
    const assertGuidance = async (withBeads: boolean) => {
      const result = await captureCli(refresh);
      expect(result.code).toBe(0);
      const agents = read(AGENTS);
      const snippet = JSON.parse(result.stdout).agentsSnippet;
      expect(agents).toBe(`${prefix}${AGENTS_BLOCK_START}\r\n${snippet.replaceAll("\n", "\r\n")}\r\n${AGENTS_BLOCK_END}${suffix}`);
      expect(agents.split(AGENTS_BLOCK_START)).toHaveLength(2);
      for (const guidance of [agents, read(SKILL)]) {
        expect(guidance).toContain("pp summary");
        if (withBeads) {
          expect(guidance).toContain("Use Beads for execution work: issues, bugs, and blockers.");
          expect(guidance).toContain("`bd:<id>`");
          expect(guidance).toContain("Closing an issue does not ship the feature.");
          expect(guidance).toContain("pp show <feature-id> --beads");
          expect(guidance).toContain("pp check --beads");
        } else {
          expect(guidance).not.toMatch(/Beads|--beads|bd:<id>/);
          expect(guidance).toContain("`pp show <feature-id>`");
          expect(guidance).toContain("`pp check`");
        }
      }
      expect(read(ROADMAP)).toBe(roadmap);
    };

    await assertGuidance(false);
    for (const marker of ["config.yaml", "metadata.json", "redirect"]) {
      write(`.beads/${marker}`, "not read or resolved by init\n");
      await assertGuidance(true);
      rmSync(join(tempDir, ".beads", marker));
      await assertGuidance(false);
    }
    expect(read(CONFIG)).toBe(config);
    write(".beads/config.yaml", "");
    const disabled = config.replace("enabled: true", "enabled: false");
    write(CONFIG, disabled);
    await assertGuidance(false);
    expect(read(CONFIG)).toBe(disabled);
  });

  test("ignores Beads markers in parents and behind symlinks", async () => {
    const markers = join(tempDir, ".beads");
    write(".beads/config.yaml", "");
    const nested = join(tempDir, "nested");
    mkdirSync(nested);
    const local = join(nested, ".beads");
    symlinkSync(markers, local, "dir");
    const args = ["init", "--json", "--agents-snippet", "--dry-run"];
    const linkedDirectory = await captureCli(args, nested);
    expect(linkedDirectory.code).toBe(0);
    expect(JSON.parse(linkedDirectory.stdout).agentsSnippet).not.toMatch(/Beads|--beads/);
    unlinkSync(local);
    mkdirSync(local);
    symlinkSync(join(markers, "config.yaml"), join(local, "config.yaml"));
    const linkedMarker = await captureCli(args, nested);
    expect(linkedMarker.code).toBe(0);
    expect(JSON.parse(linkedMarker.stdout).agentsSnippet).not.toMatch(/Beads|--beads/);
  });

  test("upgrades only exact stock guidance pasted into a CRLF document", async () => {
    const legacy = [
      "## Project Roadmap (`project-pulse` / `pp`)",
      "",
      "High-level milestones and features live in `.project-pulse/` and compile into `ROADMAP.md`.",
      "- **Golden rule:** Never edit `ROADMAP.md` or `.project-pulse/*.md` by hand — use `pp` CLI commands or `pp mcp`.",
      "- **Orient:** Run `pp summary` (or `pp show <feature-id> --beads`) at session start for strategic context.",
      '- **Update progress:** Use `pp feature check <id> <criterion>`, `pp feature note <id> "<note>"`, and `pp feature update <id> --status <status>`.',
      "- **Validate:** Run `pp check --beads` before wrapping up to confirm schema integrity and Beads alignment.",
    ].join("\r\n");
    const prefix = "# Guide\r\n\r\nIntro.\r\n\r\n";
    const suffix = "\r\n\r\n# Deployment\r\n\r\nKeep the checklist current.  \r\n\r\n";
    const args = ["init", "--with-agents", "--agents-snippet", "--json"];
    write(AGENTS, prefix + legacy + suffix);
    const first = await captureCli(args);
    expect(first.code).toBe(0);
    const snippet = JSON.parse(first.stdout).agentsSnippet.replaceAll("\n", "\r\n");
    const migrated = `${prefix}${AGENTS_BLOCK_START}\r\n${snippet}\r\n${AGENTS_BLOCK_END}${suffix}`;
    expect(read(AGENTS)).toBe(migrated);

    // The current print-only variant can be wrapped without moving adjacent user sections, too.
    write(AGENTS, prefix + snippet + suffix);
    expect((await captureCli(args)).code).toBe(0);
    expect(read(AGENTS)).toBe(migrated);
  });

  test.each([
    ["custom MCP command", MCP, '{"mcpServers":{"project-pulse":{"command":"node","args":["pulse.js"]}}}', /Conflicting.*--with-mcp/],
    ["extra MCP fields", MCP, '{"mcpServers":{"project-pulse":{"command":"pp","args":["mcp"],"disabled":true}}}', /Conflicting.*--with-mcp/],
    ["nonobject MCP entry", MCP, '{"mcpServers":{"project-pulse":null}}', /Conflicting.*--with-mcp/],
    ["unparseable MCP", MCP, "{sensitive-input", /Invalid JSON.*--with-mcp/],
    ["nonobject server map", MCP, '{"mcpServers":[]}', /must be an object.*--with-mcp/],
    ["nonobject MCP root", MCP, "[]", /must contain a JSON object.*--with-mcp/],
    ["custom skill", SKILL, "# Custom skill\n", /Custom skill.*--with-skill/],
    ["unpaired marker", AGENTS, `# Team\n\n${AGENTS_BLOCK_START}\n`, /Malformed.*--with-agents/],
    ["inline marker", AGENTS, `# Team ${AGENTS_BLOCK_START}\n${AGENTS_BLOCK_END}\n`, /Malformed.*--with-agents/],
    ["two marker blocks", AGENTS, `${AGENTS_BLOCK_START}\n${AGENTS_BLOCK_END}\n`.repeat(2), /Malformed.*--with-agents/],
    ["reversed markers", AGENTS, `${AGENTS_BLOCK_END}\n${AGENTS_BLOCK_START}\n`, /Malformed.*--with-agents/],
    ["custom roadmap instructions", AGENTS, "## Project Roadmap (`project-pulse` / `pp`)\n\nHand-written rules.\n", /custom instructions.*--with-agents/],
  ])("rejects %s without writing any selected file, even with --force", async (_case, path, original, error) => {
    write(path, original);
    const result = await captureCli(["init", "--json", "--force", ...ALL_EXTRAS]);
    expect(result.code).toBe(1);
    const failure = JSON.parse(result.stdout);
    expect(failure).toMatchObject({ ok: false });
    expect(failure.error).toMatch(error);
    expect(failure.error).toContain(join(tempDir, path));
    expect(failure.error).not.toContain("sensitive-input");
    expect(read(path)).toBe(original);
    for (const other of [".project-pulse", ROADMAP, AGENTS, MCP, SKILL]) {
      if (other !== path) expect(present(other)).toBe(false);
    }
  });

  test("protects a hand-written roadmap on fresh and initialized runs, and previews forced replacements", async () => {
    const handWritten = "# Hand-written\n";
    write(ROADMAP, handWritten);
    const args = ["init", "--json", "--with-agents"];
    expect(JSON.parse((await captureCli(args)).stdout)).toMatchObject({ ok: false, error: expect.stringContaining("--force") });
    expect(present(".project-pulse")).toBe(false);
    expect(present(AGENTS)).toBe(false);
    const dry = await captureCli([...args, "--force", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.stdout).actions[1]).toMatchObject({
      path: join(tempDir, ROADMAP), action: "update", detail: expect.stringContaining("hand-written"),
    });
    expect(read(ROADMAP)).toBe(handWritten);
    expect(present(".project-pulse")).toBe(false);
    expect((await captureCli(["init", "--json", "--force"])).code).toBe(0);
    expect(read(ROADMAP).slice(0, GENERATED_HEADER.length)).toBe(GENERATED_HEADER);

    write(ROADMAP, handWritten);
    const configBefore = read(CONFIG);
    const rerun = await captureCli([...args, "--name", "Would overwrite"]);
    expect(rerun.code).toBe(1);
    expect(read(CONFIG)).toBe(configBefore);
    expect(read(ROADMAP)).toBe(handWritten);
    expect(present(AGENTS)).toBe(false);
    expect((await captureCli(args)).code).toBe(0); // Integration-only: the roadmap is not selected.
    expect(read(ROADMAP)).toBe(handWritten);
  });

  test("rejects a skill parent symlink before any write and does not inspect unselected files", async () => {
    const outside = mkdtempSync(join(tmpdir(), "project-pulse-outside-"));
    try {
      symlinkSync(outside, join(tempDir, ".agents"), "dir");
      symlinkSync(join(tempDir, "missing-target"), join(tempDir, AGENTS));
      const agents = await captureCli(["init", "--json", "--with-agents"]);
      expect(agents.code).toBe(1);
      expect(JSON.parse(agents.stdout).error).toContain(join(tempDir, AGENTS));
      const result = await captureCli(["init", "--json", "--with-mcp", "--with-skill"]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout).error).toContain(join(tempDir, ".agents"));
      expect(readdirSync(outside)).toEqual([]);
      expect(present(".project-pulse")).toBe(false);
      expect(present(ROADMAP)).toBe(false);
      expect(present(MCP)).toBe(false);
      expect((await captureCli(["init", "--json", "--with-mcp"])).code).toBe(0);
      expect(present(MCP)).toBe(true);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects unparseable stored entries before writing an init plan", async () => {
    const path = ".project-pulse/features/broken.md";
    write(path, "no frontmatter\n");
    const result = await captureCli(["init", "--json", ...ALL_EXTRAS]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain("Failed to parse feature 'broken.md'");
    expect(read(path)).toBe("no frontmatter\n");
    for (const other of [CONFIG, ".project-pulse/milestones", ROADMAP, AGENTS, MCP, SKILL]) {
      expect(present(other)).toBe(false);
    }
  });
});
