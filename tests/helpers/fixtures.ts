import { spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { REPO_ROOT } from "./cli";

const FIXTURES_BUILD_DIR = join(REPO_ROOT, "tests-build");

/**
 * Returns the bundled JS fixture to execute with the test runtime (`<exec> <fixture>.mjs ...`).
 *
 * Fixture sources live in tests/fixtures/ and are bundled by `bun run build` into tests-build/
 * (gitignored, never packaged into the npm tarball). Bare `bun test` bundles a missing fixture
 * on demand, so a fresh checkout needs no explicit build step; Node test runs require the build
 * (they have no bundler available) and fail with an actionable message.
 */
export function ensureFixture(name: string): string {
  const built = join(FIXTURES_BUILD_DIR, `${name}.mjs`);
  if (existsSync(built)) return built;
  if (!process.versions.bun) {
    throw new Error(`Missing test fixture ${built}; run \`bun run build\` first.`);
  }
  mkdirSync(FIXTURES_BUILD_DIR, { recursive: true });
  const res = spawnSync(
    process.execPath,
    [
      "build",
      join(REPO_ROOT, "tests", "fixtures", `${name}.ts`),
      "--target=node",
      "--format=esm",
      "--outfile",
      built,
    ],
    { encoding: "utf8" }
  );
  if (res.status !== 0) {
    throw new Error(`Failed to bundle test fixture ${name}: ${res.stderr}`);
  }
  return built;
}

/** Resolves with the child's exit code after stdio closes (raw-child `exited` replacement). */
export function exitPromise(child: ChildProcess): Promise<number | null> {
  const { promise, resolve } = Promise.withResolvers<number | null>();
  child.once("error", () => resolve(null));
  child.once("close", (code) => resolve(code));
  return promise;
}

/**
 * Collects a child stdio stream to a UTF-8 string. Data listeners are attached eagerly; first of
 * `end`/`close` settles. (Bun's `Readable.toWeb` interop can stall on child pipes that close
 * quickly, so the web-stream route is avoided here.)
 */
export function drainChildStream(stream: Readable): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const settle = () => resolve(Buffer.concat(chunks).toString("utf8"));
  stream.once("end", settle);
  stream.once("close", settle);
  return promise;
}
