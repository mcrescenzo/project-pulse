#!/usr/bin/env bun
import { RoadmapService } from "./store";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
}

const VALUE_FLAGS = new Set(["name", "summary", "root"]);

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

function printHelp(): void {
  console.log(`project-pulse (pp) v0.1.0 — Repo-native high-level product roadmap

Usage:
  pp init [--name <name>] [--summary <text>] [--json]
  pp render [--json]
  pp check [--json]
  pp --help | --version

Options:
  --root <dir>   Target repository root (defaults to current working directory)
  --json         Output structured JSON
  -h, --help     Show help
  -v, --version  Show version`);
}

export async function runCli(argv: string[]): Promise<number> {
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

  const [cmd] = parsed.positionals;
  if (!cmd || parsed.booleans.has("help") || cmd === "help") {
    printHelp();
    return 0;
  }

  const service = new RoadmapService(rootDir);

  try {
    switch (cmd) {
      case "init": {
        const result = service.init({
          name: getFlag(parsed, "name"),
          summary: getFlag(parsed, "summary"),
        });
        if (jsonMode) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(
            `${result.created ? "Initialized" : "Updated"} .project-pulse/ for "${result.config.project.name}" and generated ROADMAP.md`
          );
        }
        return 0;
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
        const result = service.check();
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
