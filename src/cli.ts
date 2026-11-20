#!/usr/bin/env bun
import { resolve } from "node:path";
import pkg from "../package.json";
import { CliBeadsClient, type BeadsClient } from "./beads";
import { buildChangelog, buildDigest } from "./digest";
import { exportStaticHtml } from "./export";
import { joinOrStartHub } from "./hub";
import { runMcpServer } from "./mcp";
import { runRepoSetup } from "./setup";
import {
  findProjectRoot,
  formatFeatureText,
  formatSummaryText,
  getAgentsSnippet,
  RoadmapService,
} from "./store";
import { runTui } from "./tui/app";
import type { FeatureStatus, MilestoneStatus } from "./types";
import { startViewServer } from "./view";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
}

const VALUE_FLAGS = new Set([
  "name",
  "summary",
  "root",
  "title",
  "order",
  "status",
  "target",
  "description",
  "milestone",
  "area",
  "depends-on",
  "ref",
  "add-ref",
  "remove-ref",
  "criterion",
  "add-criterion",
  "remove-criterion",
  "reassign",
  "port",
  "out",
  "since",
  "agents-md",
  "mcp",
  "skill",
]);

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "json",
  "beads",
  "no-beads",
  "done",
  "undone",
  "agents-snippet",
  "no-open",
  "standalone",
  "force",
  "tui",
  "html",
  "all",
  "with-skill",
  "init",
  "dry-run",
]);

const GLOBAL_VALUE_FLAGS = new Set(["root"]);
const GLOBAL_BOOLEAN_FLAGS = new Set(["help", "version", "json"]);

const COMMAND_FLAG_ALLOWLIST: Record<string, { value: string[]; boolean: string[] }> = {
  init: { value: ["name", "summary"], boolean: ["agents-snippet"] },
  summary: { value: ["milestone", "status"], boolean: [] },
  show: { value: [], boolean: ["beads", "no-beads"] },
  "milestone add": { value: ["title", "order", "status", "target", "description"], boolean: [] },
  "milestone update": { value: ["title", "order", "status", "target", "description"], boolean: [] },
  "milestone remove": { value: ["reassign"], boolean: [] },
  "feature add": {
    value: [
      "title",
      "milestone",
      "area",
      "status",
      "order",
      "depends-on",
      "ref",
      "criterion",
      "description",
    ],
    boolean: [],
  },
  "feature update": {
    value: [
      "title",
      "milestone",
      "area",
      "status",
      "order",
      "depends-on",
      "add-ref",
      "remove-ref",
      "add-criterion",
      "remove-criterion",
      "description",
    ],
    boolean: [],
  },
  "feature check": { value: [], boolean: ["done", "undone"] },
  "feature note": { value: [], boolean: [] },
  "feature remove": { value: [], boolean: ["force"] },
  render: { value: [], boolean: [] },
  check: { value: [], boolean: ["beads"] },
  view: { value: ["port"], boolean: ["no-open", "standalone", "tui", "no-beads"] },
  export: { value: ["out"], boolean: ["html", "beads"] },
  digest: { value: ["since", "milestone"], boolean: [] },
  changelog: { value: [], boolean: ["all"] },
  setup: { value: ["agents-md", "mcp", "skill"], boolean: ["with-skill", "init", "dry-run"] },
  mcp: { value: [], boolean: [] },
};

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const booleans = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        if (BOOLEAN_FLAGS.has(key)) {
          throw new Error(`Flag '--${key}' does not take a value`);
        }
        if (!VALUE_FLAGS.has(key)) {
          throw new Error(`Unknown flag '--${key}'`);
        }
        const arr = flags.get(key) ?? [];
        arr.push(val);
        flags.set(key, arr);
      } else {
        const key = token.slice(2);
        if (VALUE_FLAGS.has(key)) {
          const next = argv[i + 1];
          if (next === undefined) {
            throw new Error(`Missing value for flag --${key}`);
          }
          i++;
          const arr = flags.get(key) ?? [];
          arr.push(next);
          flags.set(key, arr);
        } else if (BOOLEAN_FLAGS.has(key)) {
          booleans.add(key);
        } else {
          throw new Error(`Unknown flag '--${key}'`);
        }
      }
    } else if (token.startsWith("-") && token.length > 1) {
      if (token === "-h") {
        booleans.add("help");
      } else if (token === "-v") {
        booleans.add("version");
      } else {
        throw new Error(`Unknown flag '${token}'`);
      }
    } else {
      positionals.push(token);
    }
  }

  return { positionals, flags, booleans };
}

function validateCommandFlags(commandKey: string, parsed: ParsedArgs): void {
  const allow = COMMAND_FLAG_ALLOWLIST[commandKey];
  if (!allow) return;

  if (commandKey === "feature update" && parsed.flags.has("criterion")) {
    throw new Error(
      "Flag '--criterion' is not supported on 'feature update' (it would overwrite existing criteria). Use '--add-criterion <text>' or '--remove-criterion <id-or-index>'."
    );
  }

  const allowedValue = new Set(allow.value);
  const allowedBool = new Set(allow.boolean);

  for (const flag of parsed.flags.keys()) {
    if (!GLOBAL_VALUE_FLAGS.has(flag) && !allowedValue.has(flag)) {
      throw new Error(`Flag '--${flag}' is not supported for '${commandKey}'`);
    }
  }
  for (const flag of parsed.booleans) {
    if (!GLOBAL_BOOLEAN_FLAGS.has(flag) && !allowedBool.has(flag)) {
      throw new Error(`Flag '--${flag}' is not supported for '${commandKey}'`);
    }
  }
}

function getFlag(parsed: ParsedArgs, key: string): string | undefined {
  const vals = parsed.flags.get(key);
  return vals && vals.length > 0 ? vals[vals.length - 1] : undefined;
}

function getFlagAll(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

function parseOptionalNumber(raw: string | undefined, flagName: string): number | undefined {
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new Error(`Flag --${flagName} must be a finite number (got '${raw}')`);
  }
  return num;
}

function parseCsvFlag(parsed: ParsedArgs, key: string): string[] | undefined {
  const vals = parsed.flags.get(key);
  if (!vals) return undefined;
  return vals
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function printWarnings(warnings: Array<{ code: string; message: string }>, jsonMode: boolean): void {
  if (jsonMode) return;
  for (const warn of warnings) {
    console.warn(`WARN [${warn.code}]: ${warn.message}`);
  }
}

function printHelp(): void {
  console.log(`project-pulse (pp) v${pkg.version} — Repo-native high-level product roadmap

Usage:
  pp                                  Run summary if initialized, otherwise show help
  pp init [--name <name>] [--summary <text>] [--agents-snippet] [--json]
  pp summary [--milestone <id>] [--status <s>] [--json]
  pp show <feature-id> [--beads | --no-beads] [--json]
  pp milestone add <id> --title <title> [--order <n>] [--status <s>] [--target <str>] [--description <md>] [--json]
  pp milestone update <id> [--title <title>] [--order <n>] [--status <s>] [--target <str>] [--description <md>] [--json]
  pp milestone remove <id> [--reassign <milestone-id>] [--json]
  pp feature add <id> --title <title> [--milestone <m>] [--area <a>] [--status <s>] [--order <n>] [--depends-on <ids>] [--ref <ref>...] [--criterion <text>...] [--description <md>] [--json]
  pp feature update <id> [--title <title>] [--status <s>] [--milestone <m>] [--area <a>] [--order <n>] [--depends-on <ids>] [--add-ref <ref>...] [--remove-ref <ref>...] [--add-criterion <text>...] [--remove-criterion <id-or-index>...] [--description <md>] [--json]
  pp feature check <feature-id> <criterion-id-or-index> [--done | --undone] [--json]
  pp feature note <feature-id> "<message>" [--json]
  pp feature remove <id> [--force] [--json]
  pp render [--json]
  pp check [--beads] [--json]
  pp view [--port <n>] [--standalone] [--no-open]
  pp view --tui [--no-beads]
  pp export --html [--out <path|->] [--beads] [--json]
  pp digest [--since <date|7d|git-ref>] [--milestone <id>] [--json]
  pp changelog [<milestone-id>] [--all] [--json]
  pp setup [--agents-md <path>] [--mcp <path>] [--skill <path>] [--with-skill] [--init] [--dry-run] [--json]
  pp mcp
  pp --help | --version

Options:
  --root <dir>   Target repository root (defaults to nearest parent with .project-pulse/)
  --json         Output structured JSON
  -h, --help     Show help
  -v, --version  Show version`);
}

export interface CliDependencies {
  beadsClient?: BeadsClient;
  cwd?: string;
  isTty?: boolean;
}

export async function runCli(argv: string[], deps: CliDependencies = {}): Promise<number> {
  const earlyJson = argv.includes("--json");
  let parsed: ParsedArgs;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    const message = (error as Error).message;
    if (earlyJson) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  }

  const jsonMode = parsed.booleans.has("json");

  if (parsed.booleans.has("version")) {
    if (jsonMode) {
      console.log(JSON.stringify({ name: "project-pulse", version: pkg.version }));
    } else {
      console.log(pkg.version);
    }
    return 0;
  }

  const [rawCmd, rawSubcmd, ...rest] = parsed.positionals;
  if (parsed.booleans.has("help") || rawCmd === "help") {
    printHelp();
    return 0;
  }

  const cwd = deps.cwd ?? process.cwd();
  const explicitRoot = getFlag(parsed, "root");
  if (explicitRoot !== undefined && !explicitRoot.trim()) {
    const message = "Flag --root requires a non-empty directory path";
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  }

  const rootDir = explicitRoot
    ? resolve(explicitRoot)
    : rawCmd === "init"
    ? resolve(cwd)
    : findProjectRoot(cwd) ?? resolve(cwd);

  const service = new RoadmapService(rootDir);
  const beadsClient = deps.beadsClient ?? new CliBeadsClient();

  let cmd = rawCmd;
  let subcmd = rawSubcmd;
  if (!cmd) {
    if (service.isInitialized()) {
      cmd = "summary";
      subcmd = undefined;
    } else {
      try {
        validateCommandFlags("summary", parsed);
      } catch (error) {
        const message = (error as Error).message;
        if (jsonMode) {
          console.log(JSON.stringify({ ok: false, error: message }));
        } else {
          console.error(`Error: ${message}`);
        }
        return 1;
      }
      printHelp();
      return 0;
    }
  }

  try {
    if (cmd === "milestone" || cmd === "feature") {
      if (subcmd) {
        validateCommandFlags(`${cmd} ${subcmd}`, parsed);
      }
    } else {
      validateCommandFlags(cmd, parsed);
    }

    switch (cmd) {
      case "init": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'init'`);
        }
        const result = service.init({
          name: getFlag(parsed, "name"),
          summary: getFlag(parsed, "summary"),
        });
        const includeSnippet = parsed.booleans.has("agents-snippet");
        if (jsonMode) {
          console.log(
            JSON.stringify(
              includeSnippet ? { ...result, agentsSnippet: getAgentsSnippet() } : result,
              null,
              2
            )
          );
        } else {
          console.log(
            `${result.created ? "Initialized" : "Updated"} .project-pulse/ for "${result.config.project.name}" and generated ROADMAP.md`
          );
          if (includeSnippet) {
            console.log(`\n${getAgentsSnippet()}`);
          } else {
            console.log("Tip: run 'pp init --agents-snippet' to print AGENTS.md instructions for AI agents.");
          }
        }
        return 0;
      }

      case "summary": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'summary'`);
        }
        const summary = service.summary({
          milestone: getFlag(parsed, "milestone"),
          status: getFlag(parsed, "status"),
        });
        if (jsonMode) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatSummaryText(summary));
        }
        return 0;
      }

      case "show": {
        const featureId = subcmd;
        if (!featureId) {
          throw new Error("Usage: pp show <feature-id> [--beads | --no-beads] [--json]");
        }
        if (rest.length > 0) {
          throw new Error(`Unexpected argument '${rest[0]}' for 'show'`);
        }
        const beadsFlag = parsed.booleans.has("beads");
        const noBeadsFlag = parsed.booleans.has("no-beads");
        if (beadsFlag && noBeadsFlag) {
          throw new Error("Flags --beads and --no-beads are mutually exclusive");
        }
        const detail = await service.showFeature(featureId, {
          beads: noBeadsFlag ? false : beadsFlag ? true : undefined,
          beadsClient,
        });
        if (jsonMode) {
          console.log(JSON.stringify(detail, null, 2));
        } else {
          console.log(formatFeatureText(detail));
        }
        return 0;
      }

      case "milestone": {
        if (subcmd === "add") {
          const id = rest[0];
          if (!id) throw new Error("Usage: pp milestone add <id> --title <title> ...");
          if (rest.length > 1) throw new Error(`Unexpected argument '${rest[1]}' for 'milestone add'`);
          const title = getFlag(parsed, "title");
          if (!title) throw new Error("Missing required flag --title");
          const res = service.upsertMilestone({
            id,
            title,
            order: parseOptionalNumber(getFlag(parsed, "order"), "order"),
            status: getFlag(parsed, "status") as MilestoneStatus | undefined,
            target: getFlag(parsed, "target"),
            description: getFlag(parsed, "description"),
          });
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(JSON.stringify({ ok: true, milestone: res.entity, warnings: res.warnings }, null, 2));
          } else {
            console.log(`Saved milestone '${res.entity.id}' (${res.entity.status}) and updated ROADMAP.md`);
          }
          return 0;
        }
        if (subcmd === "update") {
          const id = rest[0];
          if (!id) throw new Error("Usage: pp milestone update <id> [flags]");
          if (rest.length > 1) throw new Error(`Unexpected argument '${rest[1]}' for 'milestone update'`);
          const res = service.updateMilestone(id, {
            title: getFlag(parsed, "title"),
            order: parseOptionalNumber(getFlag(parsed, "order"), "order"),
            status: getFlag(parsed, "status") as MilestoneStatus | undefined,
            target: getFlag(parsed, "target"),
            description: getFlag(parsed, "description"),
          });
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(JSON.stringify({ ok: true, milestone: res.entity, warnings: res.warnings }, null, 2));
          } else {
            console.log(`Updated milestone '${res.entity.id}' (${res.entity.status}) and updated ROADMAP.md`);
          }
          return 0;
        }
        if (subcmd === "remove") {
          const id = rest[0];
          if (!id) throw new Error("Usage: pp milestone remove <id> [--reassign <milestone-id>] [--json]");
          if (rest.length > 1) throw new Error(`Unexpected argument '${rest[1]}' for 'milestone remove'`);
          const res = service.removeMilestone(id, { reassignTo: getFlag(parsed, "reassign") });
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  milestone: res.entity,
                  reassignedFeatures: res.reassignedFeatures ?? [],
                  warnings: res.warnings,
                },
                null,
                2
              )
            );
          } else {
            const suffix =
              res.reassignedFeatures && res.reassignedFeatures.length > 0
                ? ` (reassigned ${res.reassignedFeatures.join(", ")})`
                : "";
            console.log(`Removed milestone '${res.entity.id}'${suffix} and updated ROADMAP.md`);
          }
          return 0;
        }
        throw new Error(`Unknown milestone subcommand '${subcmd ?? ""}'. Expected: add, update, remove`);
      }

      case "feature": {
        if (subcmd === "add") {
          const id = rest[0];
          if (!id) throw new Error("Usage: pp feature add <id> --title <title> --milestone <m> ...");
          if (rest.length > 1) throw new Error(`Unexpected argument '${rest[1]}' for 'feature add'`);
          const title = getFlag(parsed, "title");
          if (!title) throw new Error("Missing required flag --title");
          const criteria = getFlagAll(parsed, "criterion");
          const res = service.addFeature({
            id,
            title,
            milestone: getFlag(parsed, "milestone"),
            area: getFlag(parsed, "area"),
            status: getFlag(parsed, "status") as FeatureStatus | undefined,
            order: parseOptionalNumber(getFlag(parsed, "order"), "order"),
            depends_on: parseCsvFlag(parsed, "depends-on"),
            refs: getFlagAll(parsed, "ref"),
            ship_criteria: criteria.length > 0 ? criteria : undefined,
            description: getFlag(parsed, "description"),
          });
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(JSON.stringify({ ok: true, feature: res.entity, warnings: res.warnings }, null, 2));
          } else {
            console.log(
              `Added feature '${res.entity.id}' to milestone '${res.entity.milestone}' and updated ROADMAP.md`
            );
          }
          return 0;
        }

        if (subcmd === "update") {
          const id = rest[0];
          if (!id) throw new Error("Usage: pp feature update <id> [flags]");
          if (rest.length > 1) throw new Error(`Unexpected argument '${rest[1]}' for 'feature update'`);
          const addRefs = getFlagAll(parsed, "add-ref");
          const removeRefs = getFlagAll(parsed, "remove-ref");
          const addCriteria = getFlagAll(parsed, "add-criterion");
          const removeCriteria = getFlagAll(parsed, "remove-criterion");
          const res = service.updateFeature(id, {
            title: getFlag(parsed, "title"),
            status: getFlag(parsed, "status") as FeatureStatus | undefined,
            milestone: getFlag(parsed, "milestone"),
            area: getFlag(parsed, "area"),
            order: parseOptionalNumber(getFlag(parsed, "order"), "order"),
            depends_on: parseCsvFlag(parsed, "depends-on"),
            addRefs: addRefs.length > 0 ? addRefs : undefined,
            removeRefs: removeRefs.length > 0 ? removeRefs : undefined,
            addCriteria: addCriteria.length > 0 ? addCriteria : undefined,
            removeCriteria: removeCriteria.length > 0 ? removeCriteria : undefined,
            description: getFlag(parsed, "description"),
          });
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(JSON.stringify({ ok: true, feature: res.entity, warnings: res.warnings }, null, 2));
          } else {
            console.log(`Updated feature '${res.entity.id}' (${res.entity.status}) and updated ROADMAP.md`);
          }
          return 0;
        }

        if (subcmd === "check") {
          const [featureId, criterionKey] = rest;
          if (!featureId || !criterionKey) {
            throw new Error("Usage: pp feature check <feature-id> <criterion-id-or-index> [--done | --undone]");
          }
          if (rest.length > 2) {
            throw new Error(`Unexpected argument '${rest[2]}' for 'feature check'`);
          }
          const doneFlag = parsed.booleans.has("done");
          const undoneFlag = parsed.booleans.has("undone");
          if (doneFlag && undoneFlag) {
            throw new Error("Flags --done and --undone are mutually exclusive");
          }
          const desiredState = doneFlag ? true : undoneFlag ? false : undefined;
          const res = service.checkFeatureCriterion(featureId, criterionKey, desiredState);
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(JSON.stringify({ ok: true, feature: res.entity, warnings: res.warnings }, null, 2));
          } else {
            const doneCount = res.entity.ship_criteria.filter((c) => c.done).length;
            console.log(
              `Updated ship criteria on '${res.entity.id}' (${doneCount}/${res.entity.ship_criteria.length} done) and updated ROADMAP.md`
            );
          }
          return 0;
        }

        if (subcmd === "note") {
          const featureId = rest[0];
          const message = rest.slice(1).join(" ").trim();
          if (!featureId || !message) {
            throw new Error('Usage: pp feature note <feature-id> "<message>"');
          }
          const res = service.addFeatureNote(featureId, message);
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(JSON.stringify({ ok: true, feature: res.entity, warnings: res.warnings }, null, 2));
          } else {
            console.log(`Logged pulse note on '${res.entity.id}' and updated ROADMAP.md`);
          }
          return 0;
        }

        if (subcmd === "remove") {
          const id = rest[0];
          if (!id) throw new Error("Usage: pp feature remove <id> [--force] [--json]");
          if (rest.length > 1) throw new Error(`Unexpected argument '${rest[1]}' for 'feature remove'`);
          const res = service.removeFeature(id, { force: parsed.booleans.has("force") });
          printWarnings(res.warnings, jsonMode);
          if (jsonMode) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  feature: res.entity,
                  updatedDependents: res.updatedDependents ?? [],
                  warnings: res.warnings,
                },
                null,
                2
              )
            );
          } else {
            const suffix =
              res.updatedDependents && res.updatedDependents.length > 0
                ? ` (removed dependency from ${res.updatedDependents.join(", ")})`
                : "";
            console.log(`Removed feature '${res.entity.id}'${suffix} and updated ROADMAP.md`);
          }
          return 0;
        }

        throw new Error(
          `Unknown feature subcommand '${subcmd ?? ""}'. Expected: add, update, check, note, remove`
        );
      }

      case "render": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'render'`);
        }
        const result = service.render();
        if (jsonMode) {
          console.log(JSON.stringify({ ok: true, roadmapPath: result.roadmapPath }, null, 2));
        } else {
          console.log(`Rendered ${result.roadmapPath}`);
        }
        return 0;
      }

      case "check": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'check'`);
        }
        const result = await service.checkWithBeads({
          beads: parsed.booleans.has("beads"),
          beadsClient,
        });
        if (jsonMode) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          for (const warn of result.warnings) {
            console.warn(`WARN [${warn.code}]: ${warn.message}`);
          }
          for (const err of result.errors) {
            console.error(`ERROR [${err.code}]: ${err.message}`);
          }
          if (result.ok) {
            console.log(
              `OK: .project-pulse/ and ROADMAP.md are valid (${result.warnings.length} warning(s))`
            );
          }
        }
        return result.ok ? 0 : 1;
      }

      case "mcp": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'mcp'`);
        }
        await runMcpServer(rootDir, beadsClient);
        return 0;
      }

      case "view": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'view'`);
        }
        const tuiMode = parsed.booleans.has("tui");
        const noBeads = parsed.booleans.has("no-beads");
        if (tuiMode) {
          if (parsed.flags.has("port")) {
            throw new Error("Flag '--port' cannot be used with '--tui'");
          }
          if (parsed.booleans.has("standalone")) {
            throw new Error("Flag '--standalone' cannot be used with '--tui'");
          }
          if (parsed.booleans.has("no-open")) {
            throw new Error("Flag '--no-open' cannot be used with '--tui'");
          }
          if (jsonMode) {
            throw new Error("Flag '--json' cannot be used with '--tui'");
          }
          const hasTty = deps.isTty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
          if (!hasTty) {
            throw new Error("pp view --tui requires an interactive TTY terminal");
          }
          await runTui(rootDir, { noBeads, beadsClient });
          return 0;
        }
        if (noBeads) {
          throw new Error("Flag '--no-beads' on 'pp view' is only supported with '--tui'");
        }
        const port = parseOptionalNumber(getFlag(parsed, "port"), "port") ?? 4310;
        const noOpen = parsed.booleans.has("no-open");

        if (parsed.booleans.has("standalone")) {
          const handle = startViewServer(rootDir, { port, beadsClient });
          console.log(`Project Pulse dashboard listening at ${handle.url}`);
          if (!noOpen) openBrowser(handle.url);
          await waitForShutdown(() => handle.stop());
          return 0;
        }

        const hubResult = await joinOrStartHub(rootDir, { port, beadsClient });
        if (hubResult.mode === "joined") {
          console.log(
            `Joined Project Pulse hub at ${hubResult.url} (overview: http://127.0.0.1:${hubResult.port}/)`
          );
          if (!noOpen) openBrowser(hubResult.url);
          return 0;
        }

        console.log(
          `Project Pulse hub listening at ${hubResult.handle.url} (project: ${hubResult.url})`
        );
        if (!noOpen) openBrowser(hubResult.url);
        await waitForShutdown(() => hubResult.handle.stop());
        return 0;
      }

      case "export": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'export'`);
        }
        if (!parsed.booleans.has("html")) {
          throw new Error("Usage: pp export --html [--out <path|->] [--beads] [--json]");
        }
        const rawOut = getFlag(parsed, "out");
        const outPath =
          rawOut === "-" ? "-" : rawOut !== undefined ? resolve(cwd, rawOut) : undefined;
        const result = await exportStaticHtml(rootDir, {
          outPath,
          beads: parsed.booleans.has("beads"),
          beadsClient,
        });
        if (jsonMode) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                outPath: result.outPath,
                bytes: result.bytes,
                ...(result.outPath === null ? { html: result.html } : {}),
              },
              null,
              2
            )
          );
        } else if (result.outPath === null) {
          process.stdout.write(result.html);
        } else {
          console.log(`Exported static roadmap HTML to ${result.outPath} (${result.bytes} bytes)`);
        }
        return 0;
      }

      case "digest": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'digest'`);
        }
        const result = buildDigest(rootDir, {
          since: getFlag(parsed, "since"),
          milestone: getFlag(parsed, "milestone"),
        });
        if (jsonMode) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          process.stdout.write(result.markdown);
        }
        return 0;
      }

      case "changelog": {
        if (rest.length > 0) {
          throw new Error(`Unexpected argument '${rest[0]}' for 'changelog'`);
        }
        const result = buildChangelog(rootDir, {
          milestone: subcmd,
          all: parsed.booleans.has("all"),
        });
        if (jsonMode) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          process.stdout.write(result.markdown);
        }
        return 0;
      }

      case "setup": {
        if (subcmd !== undefined) {
          throw new Error(`Unexpected argument '${subcmd}' for 'setup'`);
        }
        const rawAgents = getFlag(parsed, "agents-md");
        const rawMcp = getFlag(parsed, "mcp");
        const rawSkill = getFlag(parsed, "skill");
        const result = runRepoSetup(rootDir, {
          agentsMdPath: rawAgents ? resolve(cwd, rawAgents) : undefined,
          mcpPath: rawMcp ? resolve(cwd, rawMcp) : undefined,
          skillPath: rawSkill ? resolve(cwd, rawSkill) : undefined,
          withSkill: parsed.booleans.has("with-skill"),
          init: parsed.booleans.has("init"),
          dryRun: parsed.booleans.has("dry-run"),
        });
        if (jsonMode) {
          console.log(JSON.stringify({ ok: true, ...result }, null, 2));
        } else {
          if (result.dryRun) {
            console.log("Dry-run mode — no files were modified:");
          }
          for (const item of result.actions) {
            console.log(`[${item.action}] ${item.path} — ${item.detail}`);
          }
          if (!rawMcp) {
            console.log("\nMCP server config snippet (pass --mcp <path> to write automatically):");
            console.log(JSON.stringify(result.mcpConfig, null, 2));
          }
        }
        return 0;
      }

      default:
        if (jsonMode) {
          console.log(JSON.stringify({ ok: false, error: `Unknown command: ${cmd}` }));
        } else {
          console.error(`Unknown command: ${cmd}`);
          printHelp();
        }
        return 1;
    }
  } catch (error) {
    const message = (error as Error).message;
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  }
}

function openBrowser(targetUrl: string): void {
  const opener =
    process.platform === "darwin"
      ? ["open", targetUrl]
      : process.platform === "win32"
      ? ["cmd", "/c", "start", targetUrl]
      : ["xdg-open", targetUrl];
  try {
    Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Best-effort browser open; ignore in headless environments
  }
}

async function waitForShutdown(onStop: () => void): Promise<void> {
  await new Promise<void>((resolveStop) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      onStop();
      resolveStop();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

if (import.meta.main) {
  const exitCode = await runCli(Bun.argv.slice(2));
  process.exit(exitCode);
}
