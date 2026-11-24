# Contributing to Project Pulse

Thanks for your interest in improving Project Pulse! Bug reports, docs fixes, and focused pull requests are all welcome.

## Development setup

You need [Bun](https://bun.sh/) **1.3 or newer** and `git`.

```bash
git clone https://github.com/mcrescenzo/project-pulse.git
cd project-pulse
bun install

bun run typecheck                    # tsc --noEmit
bun test                             # full test suite
bun run src/cli.ts --help            # run the CLI from source
bun link                             # optional: put `pp` / `project-pulse` on your PATH
```

### Browser UI tests

The Playwright tests (`tests/ui.test.ts`, plus parts of `v03-hub` and `v03-export`) drive a locally installed Chrome or Chromium through `playwright-core`.
- They look in the usual Linux and macOS install locations.
- To use a different browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome`.
- If no browser is found, these tests are **skipped with a warning**.
- Set `PP_REQUIRE_UI_TESTS=1`, as CI does, to make a missing browser a failure instead.

The PTY smoke test needs `python3` and is skipped without it.

## Making changes

1. Fork the repo and create a short-lived branch from `main`.
2. Keep changes focused. Add or update tests in `tests/` for any behavior change.
3. Run `bun run typecheck`, `bun test`, and `bun run src/cli.ts check` before you push.
4. Open a pull request describing **what** changed and **why**. CI must pass before merge.

Commit messages follow a light conventional style, e.g. `feat(tui): …`, `fix(hub): …`, `docs: …`, `roadmap: …`.

## Stable npm releases

PR CI and the `Publish` workflow run the same runtime matrix and packed npm install checks. Merge the version bump with green CI; do not publish from a local checkout.

Before pushing `vX.Y.Z`, verify that it matches `package.json` on `main`, release tag creation is restricted, and the `npm-release` environment requires maintainer approval. The npm trusted publisher must point to `mcrescenzo/project-pulse`, `publish.yml`, and `npm-release`.

Review the tested tarball's SHA-512 in the tag run before approving publication. Verify the registry's `latest` version, integrity, provenance, and clean installs before marking the release shipped in the roadmap.

## The project's own roadmap

This repository dogfoods Project Pulse: `ROADMAP.md` is generated from `.project-pulse/`.

- **Never edit `ROADMAP.md` or `.project-pulse/*.md` by hand.** Use the CLI, e.g. `pp feature note <id> "…"` or `pp feature check <id> <criterion>`, or use `pp mcp`.
- Run `pp check` to confirm the roadmap is valid and in sync.

Features reference `bd:<id>` refs from the maintainer's local [Beads](https://github.com/steveyegge/beads) tracker. Contributors don't need Beads; plain `pp check` (without `--beads`) works without it.

## Security issues

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
