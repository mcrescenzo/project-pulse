# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/mcrescenzo/project-pulse/security/advisories/new)
(**Security → Report a vulnerability** on the repository). Include:

- the affected version or commit,
- the steps to reproduce,
- the impact you observed.

You should get an acknowledgement within a few days. Once the issue is confirmed, a fix and an advisory will follow.

## Supported versions

Project Pulse is pre-1.0. Security fixes land on `main` and in the latest tagged release only.

## Security model

Project Pulse is a local developer tool. The parts that matter for security:

- **`pp view` (browser dashboard / hub)**
  - Binds to `127.0.0.1` only.
  - Every request must:
    - use a loopback `Host` header, which blocks DNS rebinding;
    - carry the **access token**: either the `HttpOnly; SameSite=Strict` cookie set by the `?t=<token>` URL that `pp view` prints and opens, or an `X-PP-Access-Token` header.
  - State-changing requests also need a JSON content type, a same-origin `Origin`, and a same-origin `Sec-Fetch-Site`.
  - Responses forbid framing.
  - The token is stored at `~/.config/project-pulse/access-token` (mode 0600; override the directory with `PROJECT_PULSE_HOME`). Delete that file to rotate the token.
- **`pp mcp`** talks over stdio only and opens no network listener.
- **`pp view --tui`** has no network surface.
- **Subprocesses** (`bd`, `git`, and the OS browser opener) are always called with argument arrays, never through a shell.
- **Untrusted repositories:** running `pp` inside a repository runs `git` there and, when the Beads integration is on, `bd` as well. Treat untrusted checkouts with the same care as running their build scripts. To skip `bd`, set `integrations.beads.enabled: false` in `.project-pulse/config.yaml`, or use `pp view --tui --no-beads`.

The v0.5 pre-release audit is documented in [`docs/security-audit.md`](docs/security-audit.md).
