import { defineConfig } from "vitest/config";

// Dev-only Node test runner: the suites are written against `bun:test`'s surface; aliasing it to
// `vitest` lets the exact same files execute in-process under Node. No source changes per runner.
export default defineConfig({
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // The suites own most per-case timeouts (browser/PTY cases use long deadlines); this is the
    // default bound for cases that do not override it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Fixture-heavy suites spawn subprocesses and bind loopback ports; files run sequentially in
    // one process, mirroring bun test's default.
    fileParallelism: false,
  },
});
