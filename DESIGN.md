# Project Pulse design system

The web dashboard, the hub page and the static export share one set of tokens, defined in
[`src/dashboard/theme.ts`](src/dashboard/theme.ts). `tests/design-tokens.test.ts` checks this
file against that module, enforces contrast, and rejects hard-coded colours, font sizes and
radii in the generated pages. The TUI keeps its own palette (`TUI_PALETTE` in
`src/tui/screen.ts`) but uses the same labels and formats from `src/present.ts`.

## Principles

1. **Read first.** The dashboard answers four questions without a click: where is the project,
   what is at risk, what is blocked, what changed. Editing is a fast secondary path.
2. **Status is the only colour that means status.** Five status roles exist, and no other role
   reuses their hues. Interactive, connection, validation and graph-trace states have roles of
   their own.
3. **Typography over containers.** Hierarchy comes from size, weight and the mono face, not from
   nested borders and boxes.
4. **Never fail silently.** Every state names what happened, why, and what to do next.

## Colour roles

Both themes follow the system setting by default. The theme toggle persists an override in
`localStorage` (`pp-theme`).

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--bg` | `#0b0f17` | `#f6f8fc` | Page background |
| `--surface` | `#121826` | `#ffffff` | Panels, cards, drawer |
| `--surface-2` | `#192234` | `#f1f5f9` | Inputs, nested rows, hover |
| `--border` | `#263147` | `#dbe3ef` | Hairlines and dividers |
| `--text` | `#e6edf7` | `#0f172a` | Primary text |
| `--muted` | `#93a4bd` | `#475569` | Secondary text, metadata |
| `--st-planned` | `#94a3b8` | `#4b5869` | Status: planned |
| `--st-progress` | `#60a5fa` | `#1d4ed8` | Status: in progress (also an active milestone) |
| `--st-shipped` | `#34d399` | `#03684b` | Status: shipped; milestone progress fill |
| `--st-paused` | `#fbbf24` | `#7c4a00` | Status: paused |
| `--st-cut` | `#a8a8a8` | `#5e5e5e` | Status: cut |
| `--accent` | `#b69dfb` | `#6d28d9` | Interactive accent: focus ring, selected tab, links, primary button |
| `--on-accent` | `#0b0f17` | `#ffffff` | Text on an accent fill |
| `--live` | `#2dd4bf` | `#0b6b64` | Connection state (Live pill) |
| `--ok` | `#2dd4bf` | `#0b6b64` | Validation passed |
| `--warn` | `#fb923c` | `#a63a08` | Validation warning |
| `--danger` | `#f87171` | `#b91c1c` | Validation error, destructive action, failed save |
| `--trace-up` | `#f0abfc` | `#9d1aaa` | Graph: upstream prerequisites |
| `--trace-down` | `#67e8f9` | `#0b6a85` | Graph: downstream dependents |
| `--overlay` | `rgba(0, 0, 0, 0.55)` | `rgba(15, 23, 42, 0.45)` | Modal backdrop |
| `--shadow` | `0 12px 32px rgba(0, 0, 0, 0.35)` | `0 10px 28px rgba(15, 23, 42, 0.08)` | Raised surfaces |

Each status and system role also has a `--<role>-soft` tint. It is the role colour mixed at 14%
into `--surface`, and it is used behind text of that role (pills, chips, notices). For hairline
borders in a role colour, use `color-mix(in srgb, var(--<role>) 35%, transparent)`.

Rules, all enforced by the test:

- Every text role (`--text`, `--muted`, the five status roles and the seven system roles) reaches
  **4.5:1** on `--bg`, `--surface`, `--surface-2` and on its own tint, in both themes.
- A system role never matches a status hue: every pair is at least 12° apart, or the status
  colour is neutral grey (`--st-cut`).
- No colour literals appear in the stylesheet or the page scripts outside the token block.

## Type scale

Six steps with a 12px floor. Counts use tabular numerals (`.num`). Ids, refs, timestamps and
counts use the mono stack (`--font-mono`, `.mono`). No webfonts: the static export's CSP is
`default-src 'none'`.

| Token | Size | Use |
| --- | --- | --- |
| `--fs-xs` | 12px | Metadata, chips, legends, footer hints |
| `--fs-sm` | 13px | Secondary rows, labels, controls |
| `--fs-base` | 14px | Ledger rows, drawer body |
| `--fs-md` | 16px | Body copy, section titles |
| `--fs-lg` | 20px | Milestone group titles, drawer title |
| `--fs-xl` | 28px | Project name |

## Spacing and shape

- Spacing: `--sp-1` 4px, `--sp-2` 8px, `--sp-3` 12px, `--sp-4` 16px, `--sp-5` 24px.
- Radii: `--radius-sm` 4px (chips, pills, inputs, dots) and `--radius` 8px (panels, drawer,
  cards). No others.
- `prefers-reduced-motion: reduce` turns off every transition and animation on the dashboard
  and hub pages.
- Labels that must never break (status words, pills, counts) carry `white-space: nowrap`
  (`.nowrap`, `.pill`, `.status-word`).

## Labels and formats

`src/present.ts` is the single source for user-facing names on the web and TUI.

| Thing | Display |
| --- | --- |
| Views | Roadmap, Graph, Activity |
| Statuses | planned, in progress, shipped, paused, cut (the stored enum stays `in-progress`) |
| Criteria | `n/m criteria`, or `no criteria` |
| Timestamps | `Nov 25, 18:32` in local time (the year is added when it isn't the current year) |
| Health | `Check OK`, `1 warning`, `3 warnings`, `1 error`, `2 errors` |

## Status marks

Status is the only colour that means status, and it always comes with a word, so it never depends on
colour alone.

| Status | Web mark | TUI glyph | Role |
| --- | --- | --- | --- |
| planned | hollow dot | `○` | `--st-planned` |
| in progress | filled dot | `●` | `--st-progress` |
| shipped | filled dot | `✓` | `--st-shipped` |
| paused | two bars | `‖` (U+2016, present in common monospace fonts) | `--st-paused` |
| cut | hollow square | `✕` | `--st-cut` |

## Layout

- **Header**: one line with the project name, summary (one line, full text on hover), the status
  distribution (counts per status; zero counts take no segment; a click filters by that status),
  health, Live and the theme control (labelled by its action). The hub navigation sits on its own
  bar above.
- **Toolbar**: one line with the view tabs (Roadmap, Graph, Activity), filters capped in width,
  search, the Deps toggle and a Reset button whose space is reserved so nothing shifts.
- **Roadmap ledger**: rows grouped by milestone. Columns, in drop order as the window narrows:
  latest update (below 1200px), area (1040px), needs and Issues (900px), id (720px). Status, title
  and criteria always stay. Nothing scrolls sideways at 360px or wider.
- **Drawer**: a sticky header (title, id, Close). The body order is notices (freeze, stale,
  read-only), status, overview, milestone, Depends on, Unblocks, external refs, criteria, note, and
  updates.
- **TUI**: the same order in cells. At 80×24 the ledger row is status mark, title, `n/m` and the
  first dependency; from 120 columns it adds id, area and latest update. The footer always ends with
  `? Help · q Quit` (`Esc first: ? Help · q Quit` while typing) and shows only whole hints for the
  current mode.

## State copy pattern

Every notice, empty state and error says **what happened, why, and the next action**, in that
order, in one or two short sentences. Name the control or filter involved. The shipped strings:

- Empty, unfiltered: "No features yet." followed by how to add one.
- Empty, filtered: "No features match status: paused." followed by **Reset filters** (TUI:
  "c Clear filters").
- Edit freeze: "Editing paused — 2 errors. The roadmap has errors that block every save. Fix them,
  then recheck." followed by **Show diagnostics** and **Recheck** (TUI: `e` opens Health).
- Stale generated file: "ROADMAP.md is out of sync — run pp render (or save any change here)."
- Failed save: "Couldn't save: <reason>". It stays next to the control until dismissed.
- Load failure: "Couldn't load the roadmap." with the reason, the request path, and **Retry**.
- Ship with open criteria: "2 criteria still open. Shipped usually means every criterion is done."
  followed by **Also mark 2 criteria done**, **Ship anyway** and **Cancel**.
