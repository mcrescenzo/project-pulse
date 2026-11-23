#!/usr/bin/env bun
// Bun source entrypoint (`bun run src/cli.ts`). The full CLI implementation lives in
// cli-main.ts, which is also bundled to dist/cli.js with a Node shebang for npm installs.
// Setting process.exitCode (instead of calling process.exit) lets piped stdout drain
// before the process exits.
import { runCli } from "./cli-main";

process.exitCode = await runCli(process.argv.slice(2));
