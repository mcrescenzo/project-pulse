#!/usr/bin/env bun
import { CliBeadsClient, type BeadsClient } from "./beads";
import { runMcpServer } from "./mcp";
import { formatFeatureText, formatSummaryText, getAgentsSnippet, RoadmapService } from "./store";
import type { FeatureStatus, MilestoneStatus } from "./types";

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
]);

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
        } else {
          booleans.add(key);
        }
      }
    } else if (token === "-h") {
      booleans.add("help");
    } else if (token === "-v") {
      booleans.add("version");
    } else {
      positionals.push(token);
    }
  }

  return { positionals, flags, booleans };
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
  console.log(`project-pulse (pp) v0.1.0 — Repo-native high-level product roadmap

Usage:
  pp init [--name <name>] [--summary <text>] [--agents-snippet] [--json]
  pp summary [--milestone <id>] [--status <s>] [--json]
  pp show <feature-id> [--beads] [--json]
  pp milestone add <id> --title <title> [--order <n>] [--status <s>] [--target <str>] [--description <md>] [--json]
  pp milestone update <id> [--title <title>] [--order <n>] [--status <s>] [--target <str>] [--description <md>] [--json]
  pp feature add <id> --title <title> [--milestone <m>] [--area <a>] [--status <s>] [--order <n>] [--depends-on <ids>] [--ref <ref>...] [--criterion <text>...] [--description <md>] [--json]
  pp feature update <id> [--title <title>] [--status <s>] [--milestone <m>] [--area <a>] [--order <n>] [--depends-on <ids>] [--add-ref <ref>...] [--remove-ref <ref>...] [--description <md>] [--json]
  pp feature check <feature-id> <criterion-id-or-index> [--done | --undone] [--json]
  pp feature note <feature-id> "<message>" [--json]
  pp render [--json]
  pp check [--beads] [--json]
  pp mcp
  pp --help | --version

Options:
  --root <dir>   Target repository root (defaults to current working directory)
  --json         Output structured JSON
  -h, --help     Show help
  -v, --version  Show version`);
}

export interface CliDependencies {
  beadsClient?: BeadsClient;
}

export async function runCli(argv: string[], deps: CliDependencies = {}): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    return 1;
  }

  const jsonMode = parsed.booleans.has("json");
  const rootDir = getFlag(parsed, "root") ?? process.cwd();

  if (parsed.booleans.has("version")) {
    if (jsonMode) {
      console.log(JSON.stringify({ name: "project-pulse", version: "0.1.0" }));
    } else {
      console.log("0.1.0");
    }
    return 0;
  }

  const [cmd, subcmd, ...rest] = parsed.positionals;
  if (!cmd || parsed.booleans.has("help") || cmd === "help") {
    printHelp();
    return 0;
  }

  const service = new RoadmapService(rootDir);
  const beadsClient = deps.beadsClient ?? new CliBeadsClient();

  try {
    switch (cmd) {
      case "init": {
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
          throw new Error("Usage: pp show <feature-id> [--beads] [--json]");
        }
        const detail = await service.showFeature(featureId, {
          beads: parsed.booleans.has("beads") ? true : undefined,
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
        throw new Error(`Unknown milestone subcommand '${subcmd ?? ""}'. Expected: add, update`);
      }

      case "feature": {
        if (subcmd === "add") {
          const id = rest[0];
          if (!id) throw new Error("Usage: pp feature add <id> --title <title> --milestone <m> ...");
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
          const addRefs = getFlagAll(parsed, "add-ref");
          const removeRefs = getFlagAll(parsed, "remove-ref");
          const criteria = getFlagAll(parsed, "criterion");
          const res = service.updateFeature(id, {
            title: getFlag(parsed, "title"),
            status: getFlag(parsed, "status") as FeatureStatus | undefined,
            milestone: getFlag(parsed, "milestone"),
            area: getFlag(parsed, "area"),
            order: parseOptionalNumber(getFlag(parsed, "order"), "order"),
            depends_on: parseCsvFlag(parsed, "depends-on"),
            addRefs: addRefs.length > 0 ? addRefs : undefined,
            removeRefs: removeRefs.length > 0 ? removeRefs : undefined,
            ship_criteria: criteria.length > 0 ? criteria : undefined,
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

        throw new Error(
          `Unknown feature subcommand '${subcmd ?? ""}'. Expected: add, update, check, note`
        );
      }

      case "render": {
        const result = service.render();
        if (jsonMode) {
          console.log(JSON.stringify({ ok: true, roadmapPath: result.roadmapPath }, null, 2));
        } else {
          console.log(`Rendered ${result.roadmapPath}`);
        }
        return 0;
      }

      case "check": {
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
        await runMcpServer(rootDir, beadsClient);
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

if (import.meta.main) {
  const exitCode = await runCli(Bun.argv.slice(2));
  process.exit(exitCode);
}
