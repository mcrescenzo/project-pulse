/**
 * Release build: bundles the CLI to a single Node ESM artifact plus third-party license notices,
 * and bundles the test-only fixtures alongside it (never into dist/).
 *
 * - dist/cli.js: `bun build --target=node --format=esm`, bun:sqlite / node:sqlite stay external
 *   so each runtime loads its own built-in driver; the artifact gets a `#!/usr/bin/env node`
 *   shebang and mode 0755.
 * - dist/THIRD-PARTY-NOTICES.txt: copyright/license texts of the bundled JS libraries.
 * - tests-build/*.mjs: fixture bundles used by tests under Node (gitignored, never packaged).
 *
 * Run with Bun (`bun run build`): the bundler is a build-time tool only — consumers never need it.
 */
import { build } from "bun";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = import.meta.dir + "/..";
const DIST_DIR = join(REPO_ROOT, "dist");
const TESTS_BUILD_DIR = join(REPO_ROOT, "tests-build");
const SHEBANG = "#!/usr/bin/env node\n";

/** Bundled JS libraries whose license notices ship with the artifact. Keep in sync with imports. */
const BUNDLED_PACKAGES = [
  "yaml",
  "string-width",
  "get-east-asian-width",
  "strip-ansi",
  "ansi-regex",
];

function findLicenseFile(packageDir: string): string | null {
  for (const entry of readdirSync(packageDir)) {
    if (/^LICEN[CS]E(\.|$)/i.test(entry) && existsSync(join(packageDir, entry))) {
      return join(packageDir, entry);
    }
  }
  return null;
}

async function buildEntry(
  entrypoint: string,
  outdir: string,
  entryNaming: string,
  external: string[] = []
): Promise<void> {
  const result = await build({
    entrypoints: [join(REPO_ROOT, entrypoint)],
    target: "node",
    format: "esm",
    outdir,
    naming: { entry: entryNaming },
    external,
    sourcemap: "none",
  });
  if (!result.success) {
    throw new Error(
      `Bundling ${entrypoint} failed:\n${result.logs.map((l) => String(l)).join("\n")}`
    );
  }
}

// Clean rebuild: stale outputs must never survive into an artifact.
rmSync(DIST_DIR, { recursive: true, force: true });
rmSync(TESTS_BUILD_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

await buildEntry("src/cli.ts", DIST_DIR, "cli.js", ["bun:sqlite", "node:sqlite"]);

// Deterministic shebang: strip any leading hashbang the bundler kept, then prepend exactly one.
const cliPath = join(DIST_DIR, "cli.js");
const bundled = readFileSync(cliPath, "utf8");
const withoutShebang = bundled.startsWith("#!") ? bundled.slice(bundled.indexOf("\n") + 1) : bundled;
writeFileSync(cliPath, SHEBANG + withoutShebang);
chmodSync(cliPath, 0o755);

// Third-party notices: version + license + license text per bundled package.
const notices: string[] = [
  "project-pulse bundles the following third-party JavaScript libraries.",
  "This file aggregates their copyright and license notices.",
  "",
];
for (const name of BUNDLED_PACKAGES) {
  const packageDir = join(REPO_ROOT, "node_modules", name);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
    version: string;
    license?: string;
    homepage?: string;
  };
  notices.push("=".repeat(78));
  notices.push(`${name}@${manifest.version}${manifest.homepage ? ` — ${manifest.homepage}` : ""}`);
  notices.push(`License: ${manifest.license ?? "UNKNOWN"}`);
  const licenseFile = findLicenseFile(packageDir);
  if (licenseFile) {
    notices.push("-".repeat(78));
    notices.push(readFileSync(licenseFile, "utf8").trimEnd());
  }
  notices.push("");
}
writeFileSync(join(DIST_DIR, "THIRD-PARTY-NOTICES.txt"), `${notices.join("\n")}\n`);

// Test-only fixture bundles (executed by the Node test runner; never packaged).
mkdirSync(TESTS_BUILD_DIR, { recursive: true });
for (const fixture of ["token-launcher", "digest-probe"]) {
  await buildEntry(join("tests", "fixtures", `${fixture}.ts`), TESTS_BUILD_DIR, `${fixture}.mjs`);
}

const cliBytes = existsSync(cliPath) ? readFileSync(cliPath).length : 0;
console.log(
  `built dist/cli.js (${cliBytes} bytes), dist/THIRD-PARTY-NOTICES.txt, and tests-build fixtures`
);
