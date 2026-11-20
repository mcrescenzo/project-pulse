# Project Pulse — v0.5 Public Release Security & Privacy Audit

**Scope:** the full repository and git history at the v0.5 open-source release (`src/`, `tests/`, docs, `.project-pulse/`, and all commits).
**Method:** manual code review of every network, filesystem, and subprocess surface; `gitleaks` scans of the working tree and full history; targeted grep sweeps; new regression tests (`tests/v05-security.test.ts`, plus additions to `tests/slice4.test.ts` and `tests/v03-hub.test.ts`); and a live probe of a running `pp view` hub with `curl`.

## Threat model

Project Pulse is a local developer tool. Its network surface is the `pp view` dashboard: a standalone server or a shared multi-project hub. It binds to `127.0.0.1` only. The MCP server (`pp mcp`) uses stdio, and the TUI has no network surface. The relevant attackers are:

1. **A malicious website** in the user's browser trying to read or change local roadmaps. The routes are CSRF, DNS rebinding, and clickjacking.
2. **Another local user or process** on a shared machine reaching the loopback port.
3. **A process squatting on the hub port**, trying to obtain the hub token or get an arbitrary URL opened.
4. **Untrusted repository content** (roadmap text, Beads refs, git refs) flowing into HTML, subprocess arguments, or file paths.

## Checklist results

| Area | Result |
|---|---|
| Secrets in tree and history | ✅ `gitleaks` found nothing in the tree or across all commits. There are no API keys, tokens, or private keys. |
| Personal data in history | ✅ Fixed. All commits were rewritten from a personal email to the GitHub noreply identity, and the repo-local `user.email` is pinned to it. |
| Hard-coded local paths | ✅ None in `src/`, `tests/`, or docs. The tests use `mkdtemp`, `port: 0`, and `PROJECT_PULSE_HOME`. |
| XSS (dashboard, hub, static export) | ✅ Every `innerHTML` sink goes through `esc()`. Embedded JSON uses `escapeJsonForScript` (it escapes `<`, `>`, `&`, U+2028 and U+2029). Markdown is shown as escaped text. |
| CSRF on mutations | ✅ Mutations need `Content-Type: application/json`, a loopback Host/Origin allowlist, a non-`null` Origin, and `Sec-Fetch-Site` of `same-origin` or `none`. There are no CORS headers. |
| DNS rebinding | ✅ Fixed (H1). |
| Authentication between local users | ✅ Fixed (M1). |
| Clickjacking | ✅ Fixed (M2). |
| Path traversal | ✅ No route reads files by user-supplied path. Every id that becomes a filename passes `assertValidId` (`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`). Hub slugs are limited to `[a-z0-9-]`. |
| Subprocess injection | ✅ `bd`, `git`, and the browser opener all use argv arrays with no shell. Argument separators were added (L5, L6), and the opener was hardened (M3). |
| File writes | ✅ Fixed (M4, M5, L1). |
| MCP robustness | ✅ Fixed (L4). |

## Findings and resolutions

### High

**H1. DNS rebinding could read all roadmaps. Fixed.**
- **Problem:** only POST routes validated the `Host` header. A page that rebinds its domain to `127.0.0.1` could read `/api/roadmap`, `/api/hub/projects` (which includes absolute repo paths), and the SSE streams.
- **Fix:** the view and hub servers now reject any request whose `Host` is not a loopback name for the bound port, on every route, before routing (`isAllowedHost` in `src/http-security.ts`).
- **Tests:** `slice4`, `v03-hub`.

### Medium

**M1. No authentication between local users. Fixed.**
- **Problem:** any local account or process could read every registered roadmap and write notes into a repo's roadmap files. Those notes reach AI agents, so this was a prompt-injection path.
- **Fix:** the dashboard and API now require an access token.
  - The token is persistent and random (32 bytes), stored in `~/.config/project-pulse/access-token` with mode 0600 (or under `$PROJECT_PULSE_HOME`).
  - `pp view` prints and opens `…?t=<token>`. The server swaps that for an `HttpOnly; SameSite=Strict` cookie scoped to the port, then redirects to the clean URL.
  - Programmatic clients can send `X-PP-Access-Token` instead. CLI-to-hub registration still uses the per-launch hub token from `hub.json` (0600).
  - `/api/hub/health` stays public so `pp view` can find a running hub. It exposes no paths or roadmap data.
- **Tests:** `slice4`, `v03-hub`, `ui`.

**M2. Clickjacking. Fixed.**
- **Problem:** no response prevented the dashboard from being framed by another site.
- **Fix:** every response now carries `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. The last one also keeps the landing token out of `Referer` headers.

**M3. The browser opener trusted a URL from the network. Fixed.**
- **Problem:** in joined mode, the opened URL came straight from the hub's JSON response. On Windows it was passed to `cmd /c start`, which interprets shell characters.
- **Fix:**
  - The project URL is now built locally from a slug checked against `^[a-z0-9][a-z0-9-]*$`.
  - `openBrowser` only accepts `http://` loopback URLs.
  - Windows uses `rundll32 url.dll,FileProtocolHandler`, so no shell is involved.
  - The hub token is only sent when the running hub's pid and port match `hub.json` (L2).

**M4. `writeFileAtomic` broke symlinks and widened permissions. Fixed.**
- **Problem:** a symlinked `AGENTS.md` (for example to `CLAUDE.md`) was replaced by a regular file, and a 0600 MCP config became 0644.
- **Fix:** atomic writes now rewrite the symlink's target instead of the link and keep the existing permission bits. New private files are created 0600 from the start.

**M5. `pp init` overwrote a hand-written `ROADMAP.md`. Fixed.**
- **Fix:** `pp init` now refuses unless the existing file carries the project-pulse generated header, or `--force` is given.

### Low

| ID | Finding | Status |
|---|---|---|
| L1 | `hub.json` was briefly world-readable, and `projects.json` and the state dir were 0644/0755. | **Fixed.** State dir is 0700, files are 0600 from creation. |
| L2 | The hub token could be sent to a process squatting on the port. | **Fixed.** The pid and port must match `hub.json`. |
| L3 | Hub token comparison was not constant-time. | **Fixed.** Uses `crypto.timingSafeEqual`. |
| L4 | A malformed JSON-RPC message (`null`, a number, or a missing `method`) crashed `pp mcp`. | **Fixed.** Returns `-32600`; handler errors become `-32603`. |
| L5 | `pp digest --since -x` placed the ref where git expects options. | **Fixed.** Added `--end-of-options`. |
| L6 | Beads ids starting with `-` relied on `--id=` rewriting. | **Fixed.** `bd … show --json -- <ids>`. |
| L7 | No caps on SSE clients or request body size. | **Accepted.** Requires an authenticated local client, and the worst case is local resource use. Tracked for a later release. |
| L8 | API error messages included absolute paths. | **Fixed.** The home directory is replaced with `~`. |
| L9 | `pp setup --with-skill` and `pp export` overwrite their outputs without asking. | **Accepted.** These are explicit, user-invoked commands with documented outputs, and `--dry-run` exists for setup. |
| L10 | The static export had no CSP. | **Fixed.** `default-src 'none'`, inline script and style only, `img-src data:`. |
| L11 | Running `pp` in an untrusted repo invokes `bd` and `git` there and follows symlinks under `.project-pulse/`. | **Accepted.** Documented. Treat untrusted repos as you would running their build scripts, and use `pp view --tui --no-beads` or set `integrations.beads.enabled: false` to skip `bd`. |

## Residual risks and guidance

- Anyone who can read your files can read the access token. That is the same trust boundary as your roadmap files themselves.
- The access token is persistent so bookmarked dashboards keep working. To rotate it, delete `~/.config/project-pulse/access-token` and restart `pp view`.
- Report vulnerabilities privately as described in [`SECURITY.md`](../SECURITY.md).
