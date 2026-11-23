import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { Readable, type Writable } from "node:stream";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this helper's own location (import.meta.dir replacement). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_CLI = join(REPO_ROOT, "src", "cli.ts");
const BUILT_CLI = join(REPO_ROOT, "dist", "cli.js");

export interface CliCommand {
  execPath: string;
  /** Argument prefix selecting the CLI: empty for the built artifact or a direct Bun source run. */
  args: string[];
  cliPath: string;
}

/**
 * The CLI command for this test run.
 *
 * - `PP_TEST_CLI` selects an absolute built artifact: release gates run the packaged
 *   `dist/cli.js` under both runtimes through this override.
 * - Under Bun without an override, the Bun source CLI runs directly (`bun src/cli.ts`), so the
 *   default bare `bun test` from a fresh checkout needs no build.
 * - Under Node without an override, the built bundle is required (run `bun run build` first).
 */
export function cliCommand(): CliCommand {
  const override = process.env.PP_TEST_CLI;
  if (override) {
    const artifact = resolve(override);
    if (!existsSync(artifact)) {
      throw new Error(`PP_TEST_CLI points at a missing file: ${artifact}`);
    }
    return { execPath: process.execPath, args: [artifact], cliPath: artifact };
  }
  if (process.versions.bun) {
    return { execPath: process.execPath, args: [SOURCE_CLI], cliPath: SOURCE_CLI };
  }
  if (!existsSync(BUILT_CLI)) {
    throw new Error(
      "Node test runs require the built CLI; run `bun run build` first (or set PP_TEST_CLI)."
    );
  }
  return { execPath: process.execPath, args: [BUILT_CLI], cliPath: BUILT_CLI };
}

export interface SpawnCliOptions {
  cwd?: string;
  /** Extra environment merged over `process.env` for the child. */
  env?: Record<string, string | undefined>;
  /** Text written to the child's stdin, which is then closed (EOF) — e.g. MCP JSON-RPC lines. */
  stdin?: string;
}

/** A spawned CLI child with Bun-shaped handles: web-ReadableStream stdio and an `exited` promise. */
export interface SpawnedCli {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number | null>;
  readonly child: ChildProcess;
  kill(signal?: NodeJS.Signals): void;
}

/** Piped-stdio child shape used internally. */
type PipedChild = ChildProcessByStdio<Writable, Readable, Readable>;

function toWeb(stream: Readable): ReadableStream<Uint8Array> {
  // Node's web-stream type is structurally equivalent but nominally distinct from the DOM type.
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

/**
 * Spawns the project CLI with piped stdio. With `stdin` the text is written and the pipe closed,
 * so consumers (e.g. `pp mcp`) see EOF and flush; without it the pipe is closed immediately,
 * matching the previous `bun run` inherit-noninteractive behavior.
 */
export function spawnCli(args: string[], options: SpawnCliOptions = {}): SpawnedCli {
  const cmd = cliCommand();
  const child: PipedChild = spawn(cmd.execPath, [...cmd.args, ...args], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const { promise: exited, resolve: resolveExit } = Promise.withResolvers<number | null>();
  // `close` fires after stdio is flushed and the process is reaped; a spawn failure (missing
  // runtime binary) surfaces on `error` — first settlement wins.
  child.once("close", (code) => resolveExit(code));
  child.once("error", () => resolveExit(null));

  if (options.stdin !== undefined) {
    child.stdin.end(options.stdin);
  } else {
    child.stdin.end();
  }

  return {
    stdout: toWeb(child.stdout),
    stderr: toWeb(child.stderr),
    exited,
    child,
    kill: (signal?: NodeJS.Signals) => {
      child.kill(signal ?? "SIGTERM");
    },
  };
}

export interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Asserts clean CLI stderr. Bun must be fully quiet. On early Node 24 builds the first write
 * through the store lock can emit exactly one known platform diagnostic (`node:sqlite` is still
 * flagged experimental there); that diagnostic alone is tolerated, and only when it is the
 * SQLite ExperimentalWarning — any other stderr content fails on both runtimes.
 */
export function expectQuietStderr(stderr: string, context: string): void {
  if (stderr === "") return;
  if (!process.versions.bun) {
    const lines = stderr.split("\n").filter((line) => line.trim() !== "");
    const isSqliteWarning = (line: string) =>
      /ExperimentalWarning/.test(line) && /SQLite/.test(line) && /experimental feature|may change/.test(line);
    // The warning's companion hint ("Use `node --trace-warnings ...`") is part of the same
    // platform diagnostic, never a standalone signal.
    const isWarningHint = (line: string) => /node --trace-warnings/.test(line);
    const hasWarning = lines.some(isSqliteWarning);
    const others = lines.filter((line) => !isSqliteWarning(line) && !isWarningHint(line));
    if (hasWarning && others.length === 0) return;
  }
  throw new Error(`${context}: expected empty stderr, got:\n${stderr}`);
}

/** Timer-based delay for polling loops awaiting real cross-process filesystem signals. */
export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * PATH-based executable lookup (Bun.which replacement). Resolves the first accessible regular
 * file named `bin` in a PATH directory; null when absent.
 */
export function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    try {
      accessSync(candidate, constants.F_OK | constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep looking through the remaining PATH entries.
    }
  }
  return null;
}

/** Runs the CLI to completion, capturing stdout/stderr (streams drained concurrently). */
export async function runCliCaptured(
  args: string[],
  options: SpawnCliOptions = {}
): Promise<CliRunResult> {
  const proc = spawnCli(args, options);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
