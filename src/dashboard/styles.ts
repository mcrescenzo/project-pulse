/**
 * Stylesheet for the project dashboard (inserted after SHARED_THEME_CSS inside <style>).
 * Every size, radius and colour comes from the tokens in ./theme.ts (enforced by
 * tests/design-tokens.test.ts); DESIGN.md documents them.
 */
export const DASHBOARD_CSS = `
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html { scrollbar-gutter: stable; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: var(--fs-base);
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    body.drawer-open { overflow: hidden; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    h1, h2, h3, p { margin: 0; }
    button, input, select { font: inherit; color: inherit; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* ---------- marks: status dot + word, the only colour that means status ---------- */
    .st { --c: var(--st-planned); display: inline-flex; align-items: center; gap: var(--sp-2); white-space: nowrap; }
    .st-planned { --c: var(--st-planned); }
    .st-in-progress, .st-active { --c: var(--st-progress); }
    .st-shipped { --c: var(--st-shipped); }
    .st-paused { --c: var(--st-paused); }
    .st-cut, .st-archived { --c: var(--st-cut); }
    .st-backlog { --c: var(--st-planned); }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: var(--radius-sm); background: var(--c); flex: none; }
    .st-paused .dot { background: transparent; box-shadow: inset 3px 0 0 var(--c), inset -3px 0 0 var(--c); border-radius: 0; }
    .st-cut .dot { background: transparent; border: 2px solid var(--c); border-radius: 0; }
    .st-planned .dot, .st-backlog .dot { background: transparent; border: 2px solid var(--c); }
    .status-word { color: var(--c); font-weight: 600; font-size: var(--fs-sm); }
    .mono { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--muted); font-variant-numeric: tabular-nums; }
    .num { font-variant-numeric: tabular-nums; }
    .track { display: inline-block; width: 64px; height: 4px; border-radius: var(--radius-sm); background: var(--border); overflow: hidden; vertical-align: middle; flex: none; }
    .track > i { display: block; height: 100%; background: var(--c, var(--text)); }
    .track.is-shipped > i { background: var(--st-shipped); }
    .track.is-criteria > i { background: var(--st-progress); }
    .track.is-criteria.is-done > i { background: var(--st-shipped); }

    /* ---------- pills (system state only) ---------- */
    .pill {
      display: inline-flex; align-items: center; gap: var(--sp-2);
      padding: 3px 10px; border-radius: var(--radius-sm);
      font-size: var(--fs-xs); font-weight: 600; white-space: nowrap;
      border: 1px solid var(--border); background: var(--surface); line-height: 1.6;
    }
    .pill-btn { cursor: pointer; }
    .pill-live { background: var(--live-soft); color: var(--live); border-color: color-mix(in srgb, var(--live) 35%, transparent); }
    .pill-live .dot { background: var(--live); }
    .pill-snapshot { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
    .pill-ok { background: var(--ok-soft); color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
    .pill-warn { background: var(--warn-soft); color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, transparent); }
    .pill-err { background: var(--danger-soft); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }

    /* ---------- page chrome ---------- */
    .page { max-width: 1480px; margin: 0 auto; }
    .hub-bar { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-5); border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
    .hub-home-link { color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap; }
    .hub-home-link:hover { text-decoration: underline; }
    .hub-select { min-width: 0; max-width: 320px; padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3) var(--sp-5); padding: var(--sp-3) var(--sp-5); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .who { display: flex; align-items: baseline; gap: var(--sp-3); min-width: 0; flex: 1 1 320px; }
    .who h1 { font-size: var(--fs-lg); font-weight: 650; letter-spacing: -0.01em; white-space: nowrap; }
    .subtitle { color: var(--muted); font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .topbar-right { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
    .icon-btn { padding: 3px 10px; border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--border); cursor: pointer; font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; line-height: 1.6; }
    .icon-btn:hover { border-color: var(--accent); }

    /* status distribution bar */
    .dist { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; flex-wrap: wrap; }
    .dist-bar { display: inline-flex; width: 150px; height: 8px; border-radius: var(--radius-sm); overflow: hidden; background: var(--border); flex: none; }
    .dist-seg { display: block; height: 100%; background: var(--c); border: 0; padding: 0; cursor: pointer; min-width: 3px; }
    .dist-legend { display: flex; flex-wrap: wrap; gap: 2px var(--sp-1); align-items: center; }
    .dist-item { border: 1px solid transparent; background: none; padding: 1px 6px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-xs); font-weight: 600; color: var(--c); white-space: nowrap; }
    .dist-item:hover { border-color: var(--border); }
    .dist-item[aria-pressed="true"] { border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, var(--surface)); }
    .dist.is-filtered .dist-seg:not(.is-active) { opacity: 0.3; }

    /* toolbar */
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-2) var(--sp-5); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .view-tabs { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius); flex: none; }
    .view-tab { border: 0; background: none; padding: 3px 12px; border-radius: var(--radius-sm); font-size: var(--fs-sm); font-weight: 600; color: var(--muted); cursor: pointer; white-space: nowrap; }
    .view-tab.is-active { color: var(--text); background: var(--surface-2); }
    .filters { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; min-width: 0; flex: 1 1 auto; justify-content: flex-end; }
    .filters select, .filters input[type="search"] {
      min-width: 0; max-width: 200px; height: 30px; padding: 0 var(--sp-2);
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); font-size: var(--fs-sm);
    }
    .filters input[type="search"] { width: 200px; }
    .toggle-label { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--muted); white-space: nowrap; }
    .btn-ghost { border: 1px solid var(--border); background: none; padding: 3px 10px; border-radius: var(--radius-sm); font-size: var(--fs-sm); cursor: pointer; white-space: nowrap; }
    .btn-ghost:hover { border-color: var(--accent); }
    #filter-reset[data-visible="false"] { visibility: hidden; }
    .linkish { border: 0; background: none; padding: 0; color: var(--accent); font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }

    /* health panel */
    .health-panel { margin: var(--sp-3) var(--sp-5); padding: var(--sp-4); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .health-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
    .health-head h3 { font-size: var(--fs-md); }
    .health-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
    .health-item { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
    .health-item-main { display: flex; gap: var(--sp-2); align-items: baseline; min-width: 0; flex-wrap: wrap; font-size: var(--fs-sm); }
    .close-btn { border: 1px solid var(--border); background: var(--surface); padding: 3px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
    .close-btn:hover { border-color: var(--accent); }
    .dep-chip { border: 1px solid var(--border); background: var(--surface-2); padding: 1px 8px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--fs-xs); cursor: pointer; white-space: nowrap; }
    .dep-chip:hover { border-color: var(--accent); }

    /* ---------- views ---------- */
    .view { padding: 0 0 var(--sp-5); min-height: 50vh; }
    .loading { padding: var(--sp-5); color: var(--muted); }
    .state-msg { padding: var(--sp-5); display: grid; gap: var(--sp-2); justify-items: start; }
    .state-msg h2 { font-size: var(--fs-md); }
    .state-msg p { color: var(--muted); max-width: 70ch; }
    .state-msg.is-error h2 { color: var(--danger); }
    .btn-primary { border: 0; background: var(--accent); color: var(--on-accent); padding: 6px 14px; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; font-size: var(--fs-sm); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ledger */
    .ledger { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .ledger th { text-align: left; font-size: var(--fs-xs); font-weight: 500; color: var(--muted); padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); white-space: nowrap; }
    .ledger td { padding: 0 var(--sp-3); height: 42px; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
    .ledger th:first-child, .ledger td:first-child { padding-left: var(--sp-5); }
    .ledger th:last-child, .ledger td:last-child { padding-right: var(--sp-5); }
    .ledger th.c-status { width: 132px; }
    .ledger th.c-title { width: 26%; }
    .ledger th.c-id-cell { width: 150px; }
    .ledger th.c-crit { width: 132px; }
    .ledger th.c-area-cell { width: 124px; }
    .ledger th.c-needs-cell { width: 140px; }
    .ledger th.c-issues-cell { width: 156px; }
    .ledger th.c-latest-cell { width: auto; }
    .ledger tr.group td { height: auto; padding-top: var(--sp-3); padding-bottom: var(--sp-2); background: var(--surface); }
    .group-line { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
    .group-line h2 { font-size: var(--fs-sm); font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
    .group-line .grow { flex: 1 1 12px; }
    .group-progress { display: inline-flex; align-items: center; gap: var(--sp-2); flex: none; }
    .ledger tr.row { cursor: pointer; }
    .ledger tr.row:hover td, .ledger tr.row:focus-within td { background: var(--surface); }
    .row-open { border: 0; background: none; padding: 0; margin: 0; font-weight: 600; text-align: left; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
    .crit { display: inline-flex; align-items: center; gap: var(--sp-2); }
    .note { color: var(--muted); font-size: var(--fs-sm); }
    .dim { color: var(--muted); opacity: 0.6; }
    .ledger tr.empty-row td { color: var(--muted); font-style: italic; height: 38px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); font-family: var(--font-mono); font-size: var(--fs-xs); white-space: nowrap; margin-right: 4px; }
    .chip.ref-closed { color: var(--st-shipped); border-color: color-mix(in srgb, var(--st-shipped) 35%, transparent); }
    .chip.ref-open { color: var(--muted); }
    .chip.ref-in-progress { color: var(--st-progress); border-color: color-mix(in srgb, var(--st-progress) 35%, transparent); }
    .chip.ref-missing { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
    .chip.more { color: var(--muted); }
    .ledger th.c-title:last-child { width: auto; }
    @media (max-width: 1200px) { .ledger th.c-title { width: auto; } }
    @media (max-width: 900px) {
      .topbar { gap: var(--sp-2) var(--sp-3); padding-top: var(--sp-2); padding-bottom: var(--sp-2); }
      .toolbar { padding-top: var(--sp-1); padding-bottom: var(--sp-1); gap: var(--sp-2); }
      .dist-bar { display: none; }
      .ledger th { padding-top: var(--sp-1); padding-bottom: var(--sp-1); }
      .ledger tr.group td { padding-top: var(--sp-2); padding-bottom: var(--sp-1); }
      .topbar-right { flex: 1 1 100%; justify-content: flex-start; }
      .dist { flex: 1 1 200px; flex-wrap: nowrap; }
      .dist-legend { min-width: 0; }
    }
    @media (max-width: 720px) {
      .topbar, .toolbar, .hub-bar { padding-left: var(--sp-4); padding-right: var(--sp-4); }
      .ledger th:first-child, .ledger td:first-child { padding-left: var(--sp-4); }
      .ledger th:last-child, .ledger td:last-child { padding-right: var(--sp-4); }
      .filters { justify-content: flex-start; }
      .filters select, .filters input[type="search"] { flex: 1 1 120px; max-width: none; width: auto; }
    }
    @media (max-width: 520px) {
      .ledger th.c-status { width: 40px; }
      .ledger .status-word-cell .status-word { display: none; }
      .ledger th.c-crit { width: 64px; }
      .dist-bar { width: 100%; }
      .ledger .crit .track { display: none; }
      .who { flex-direction: column; gap: 2px; }
      .subtitle { white-space: normal; }
      .group-line .group-target { display: none; }
    }

    /* activity */
    .activity-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-3) var(--sp-5); flex-wrap: wrap; }
    .activity-head p { color: var(--muted); font-size: var(--fs-sm); }
    .activity-window { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius); }
    .activity-window button { border: 0; background: none; padding: 2px 10px; border-radius: var(--radius-sm); font-size: var(--fs-sm); color: var(--muted); cursor: pointer; white-space: nowrap; }
    .activity-window button[aria-pressed="true"] { background: var(--surface-2); color: var(--text); font-weight: 600; }
    .notice { margin: 0 var(--sp-5) var(--sp-3); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); font-size: var(--fs-sm); border: 1px solid var(--border); background: var(--surface); }
    .load-status { margin-top: var(--sp-3); }
    .notice.is-warn { border-color: color-mix(in srgb, var(--warn) 35%, transparent); background: var(--warn-soft); }
    .day { border-top: 1px solid var(--border); }
    .day h3 { font-size: var(--fs-sm); font-weight: 650; padding: var(--sp-3) var(--sp-5) var(--sp-1); }
    .day h3 .mono { margin-left: var(--sp-2); }
    .events { list-style: none; margin: 0; padding: 0 0 var(--sp-2); }
    .event { display: grid; grid-template-columns: 52px 150px minmax(0, 1fr); gap: var(--sp-3); align-items: baseline; padding: 5px var(--sp-5); cursor: pointer; }
    .event:hover, .event:focus-within { background: var(--surface); }
    .event-kind { white-space: nowrap; font-size: var(--fs-sm); }
    .event-kind.k-note { color: var(--muted); }
    .event-main { min-width: 0; display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: baseline; }
    .event-detail { color: var(--muted); font-size: var(--fs-sm); overflow-wrap: anywhere; }
    @media (max-width: 720px) {
      .event { grid-template-columns: 44px minmax(0, 1fr); }
      .event-kind, .event-main { grid-column: 2; }
      .activity-head, .day h3, .event { padding-left: var(--sp-4); padding-right: var(--sp-4); }
      .notice { margin-left: var(--sp-4); margin-right: var(--sp-4); }
    }

    /* graph */
    body.view-mode-graph .view { padding-bottom: 0; }
    .graph-shell { display: flex; flex-direction: column; height: calc(100vh - 140px); min-height: 360px; }
    .graph-bar { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-5); flex-wrap: wrap; border-bottom: 1px solid var(--border); }
    .graph-legend { display: flex; flex-wrap: wrap; gap: var(--sp-1) var(--sp-4); align-items: center; font-size: var(--fs-xs); color: var(--muted); }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .legend-swatch { width: 14px; height: 3px; border-radius: var(--radius-sm); display: inline-block; }
    .graph-controls { display: inline-flex; gap: 4px; }
    .graph-ctrl-btn { border: 1px solid var(--border); background: var(--surface); padding: 2px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; min-width: 34px; }
    .graph-ctrl-btn:hover { border-color: var(--accent); }
    .graph-viewport { position: relative; flex: 1 1 auto; overflow: hidden; cursor: grab; touch-action: none; background-image: radial-gradient(var(--border) 1px, transparent 1px); }
    .graph-viewport.is-dragging { cursor: grabbing; }
    .graph-canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
    .graph-stage { position: relative; }
    .graph-edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
    .graph-edge { fill: none; stroke: var(--muted); stroke-width: 1.4; opacity: 0.55; marker-end: url(#pp-arrow); }
    .graph-edge.is-upstream { stroke: var(--trace-up); stroke-width: 2.4; opacity: 1; marker-end: url(#pp-arrow-up); }
    .graph-edge.is-downstream { stroke: var(--trace-down); stroke-width: 2.4; opacity: 1; marker-end: url(#pp-arrow-down); }
    .graph-edge.is-dimmed { opacity: 0.12; }
    .graph-node {
      position: absolute; display: flex; flex-direction: column; gap: 4px; justify-content: center;
      padding: var(--sp-2) var(--sp-3); text-align: left; cursor: pointer;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      transition: border-color 0.12s ease, opacity 0.12s ease;
    }
    .graph-node:hover { border-color: var(--accent); }
    .graph-node.is-active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
    .graph-node.is-pinned { box-shadow: 0 0 0 3px var(--accent); }
    .graph-node.is-upstream { border-color: var(--trace-up); box-shadow: 0 0 0 2px var(--trace-up-soft); }
    .graph-node.is-downstream { border-color: var(--trace-down); box-shadow: 0 0 0 2px var(--trace-down-soft); }
    .graph-node.is-dimmed { opacity: 0.35; }
    .graph-node-title { font-weight: 600; font-size: var(--fs-sm); line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: break-word; }
    .graph-node-meta { display: flex; justify-content: space-between; gap: var(--sp-2); align-items: center; font-size: var(--fs-xs); color: var(--muted); white-space: nowrap; }

    /* ---------- drawer ---------- */
    .drawer-backdrop { position: fixed; inset: 0; background: var(--overlay); display: none; justify-content: flex-end; z-index: 50; }
    .drawer-backdrop.open { display: flex; }
    .drawer { width: min(560px, 100vw); height: 100%; overflow-y: auto; background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow); overscroll-behavior: contain; }
    .drawer-head { position: sticky; top: 0; z-index: 2; background: var(--surface); border-bottom: 1px solid var(--border); padding: var(--sp-4) var(--sp-5) var(--sp-3); display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-3); }
    .drawer-head h2 { font-size: var(--fs-lg); line-height: 1.2; overflow-wrap: anywhere; }
    .drawer-meta { margin-top: 6px; display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: center; }
    .drawer-body { padding: var(--sp-4) var(--sp-5) var(--sp-5); display: grid; gap: var(--sp-5); }
    .section-label { display: block; font-size: var(--fs-xs); font-weight: 600; color: var(--muted); margin-bottom: var(--sp-2); }
    .status-pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .status-pill { --c: var(--st-planned); display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--surface); padding: 3px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-sm); white-space: nowrap; }
    .status-pill[aria-pressed="true"] { border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, var(--surface)); color: var(--c); font-weight: 600; }
    .status-pill:disabled { cursor: not-allowed; opacity: 0.55; }
    .ctl-feedback { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); font-weight: 600; margin-top: 6px; }
    .ctl-feedback.is-ok { color: var(--ok); }
    .ctl-feedback.is-saving { color: var(--muted); }
    .ctl-feedback.is-err { color: var(--danger); padding: var(--sp-2) var(--sp-3); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); background: var(--danger-soft); border-radius: var(--radius-sm); display: flex; justify-content: space-between; font-weight: 500; }
    .ctl-feedback .dismiss { border: 0; background: none; color: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; }
    .is-saved-flash { border-color: var(--ok) !important; box-shadow: 0 0 0 2px var(--ok-soft); }
    .confirm { margin-top: var(--sp-2); padding: var(--sp-3); border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent); background: var(--warn-soft); border-radius: var(--radius-sm); display: grid; gap: var(--sp-2); }
    .confirm-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
    .freeze { padding: var(--sp-3); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); background: var(--danger-soft); border-radius: var(--radius-sm); display: grid; gap: var(--sp-2); }
    .freeze strong { color: var(--danger); }
    .freeze ul { margin: 0; padding-left: var(--sp-5); font-size: var(--fs-sm); }
    .stale { padding: var(--sp-2) var(--sp-3); border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent); background: var(--warn-soft); border-radius: var(--radius-sm); font-size: var(--fs-sm); }
    .readonly { padding: var(--sp-2) var(--sp-3); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); background: var(--accent-soft); border-radius: var(--radius-sm); font-size: var(--fs-sm); }
    .criteria-list, .updates-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .criteria-item { display: flex; gap: var(--sp-2); align-items: flex-start; padding: var(--sp-2) var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); cursor: pointer; }
    .criteria-item.is-readonly { cursor: default; }
    .criteria-item input { margin-top: 3px; }
    .criteria-body { min-width: 0; display: grid; gap: 2px; }
    .criteria-text { overflow-wrap: anywhere; }
    .note-form { display: flex; gap: var(--sp-2); }
    .note-form input { flex: 1 1 auto; min-width: 0; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
    .update-entry { padding: var(--sp-2) var(--sp-3); border-left: 2px solid var(--border); display: grid; gap: 2px; overflow-wrap: anywhere; }
    .update-at { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--muted); }
    .link-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .empty-msg { color: var(--muted); font-style: italic; }
    .diagnostics:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
`;
