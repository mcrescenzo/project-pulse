import { existsSync } from "node:fs";

const CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

let warned = false;

/**
 * Locates a Chrome/Chromium binary for Playwright UI tests.
 *
 * - `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides the search.
 * - When no browser is found, UI tests are skipped with a visible warning.
 * - Set `PP_REQUIRE_UI_TESTS=1` (as CI does) to turn a missing browser into a hard failure.
 */
export function resolveChromiumExecutable(): string | null {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const candidates = override ? [override, ...CANDIDATES] : CANDIDATES;
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  if (process.env.PP_REQUIRE_UI_TESTS === "1") {
    throw new Error(
      "PP_REQUIRE_UI_TESTS=1 but no Chrome/Chromium was found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH."
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "[project-pulse tests] No Chrome/Chromium found; skipping browser UI tests. " +
        "Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run them."
    );
  }
  return null;
}

/** Per-test timeout for real-browser tests: cold Chrome launches on CI runners can exceed Bun's 5s default. */
export const BROWSER_TEST_TIMEOUT_MS = 30_000;
