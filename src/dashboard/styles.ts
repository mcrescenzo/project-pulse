/**
 * Stylesheet for the project dashboard (inserted after SHARED_THEME_CSS inside <style>).
 */
export const DASHBOARD_CSS = `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    button:focus-visible,
    select:focus-visible,
    input:focus-visible,
    a:focus-visible,
    .card:focus-visible,
    .board-card:focus-visible,
    .graph-node:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .container { max-width: 1220px; margin: 0 auto; padding: 28px 24px 72px; }
    header {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 18px;
    }
    .hub-nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .hub-home-link {
      font-size: var(--fs-xs);
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    }
    .hub-home-link:hover { filter: brightness(1.1); }
    .hub-select {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 4px 10px;
      font-size: var(--fs-sm);
      font-family: inherit;
    }
    h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.02em; }
    .subtitle { margin: 6px 0 0; color: var(--muted); max-width: 72ch; }
    .header-badges { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: var(--radius-sm);
      font-size: var(--fs-xs);
      font-weight: 600;
      border: 1px solid transparent;
      font-family: inherit;
    }
    .pill-btn {
      cursor: pointer;
      transition: filter 0.12s ease, transform 0.12s ease;
    }
    .pill-btn:hover { filter: brightness(1.08); }
    .pill-live { background: var(--live-soft); color: var(--live); border-color: color-mix(in srgb, var(--live) 35%, transparent); }
    .pill-live .dot { width: 8px; height: 8px; border-radius: var(--radius-sm); display: inline-block; background: var(--live); }
    .pill-snapshot { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
    .pill-warn { background: var(--warn-soft); color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, transparent); }
    .pill-err { background: var(--danger-soft); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: var(--radius-sm);
      font-size: var(--fs-xs);
      font-weight: 600;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      cursor: pointer;
      font-family: inherit;
    }
    .icon-btn:hover { border-color: var(--accent); }
    .health-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 18px;
      margin-bottom: 18px;
      box-shadow: var(--shadow);
    }
    .health-panel[hidden] { display: none; }
    .health-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .health-head h3 { margin: 0; font-size: var(--fs-md); }
    .health-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .health-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 12px;
      font-size: var(--fs-sm);
    }
    .health-item-main { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    @media (max-width: 960px) {
      .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .container { padding: 20px 14px 56px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
      min-width: 0;
    }
    .stat-label { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .stat-value { font-size: var(--fs-lg); font-weight: 700; margin-top: 2px; display: flex; align-items: baseline; gap: 6px; }
    .stat-sub { font-size: var(--fs-xs); font-weight: 500; color: var(--muted); }
    .controls-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .view-tabs {
      display: inline-flex;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 4px;
      gap: 4px;
    }
    .view-tab {
      background: transparent;
      color: var(--muted);
      border: none;
      border-radius: var(--radius);
      padding: 6px 12px;
      font-size: var(--fs-sm);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .view-tab:hover { color: var(--text); }
    .view-tab.is-active {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .filters {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 12px;
      min-width: 280px;
    }
    .filters select, .filters input[type="search"] {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 6px 10px;
      font-size: var(--fs-sm);
      font-family: inherit;
    }
    .filters input[type="search"] { min-width: 170px; flex: 1; }
    .toggle-label { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--muted); cursor: pointer; }
    .btn-ghost {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 5px 10px;
      font-size: var(--fs-sm);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-ghost:hover { border-color: var(--accent); background: var(--accent-soft); }
    .milestone {
      margin-bottom: 30px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
    }
    .milestone-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .milestone-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .milestone-title h2 { margin: 0; font-size: var(--fs-lg); }
    .code-tag {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--fs-xs);
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .milestone-desc { margin: 6px 0 14px; color: var(--muted); font-size: var(--fs-base); }
    .progress-track {
      width: 100%;
      height: 7px;
      background: var(--surface-2);
      border-radius: var(--radius-sm);
      overflow: hidden;
      margin-bottom: 16px;
    }
    .progress-fill { height: 100%; background: var(--st-shipped); transition: width 0.25s ease; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 15px;
      cursor: pointer;
      transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .card:hover { transform: translateY(-1px); border-color: var(--accent); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .card-title-wrap { min-width: 0; }
    .card-title { font-weight: 650; font-size: var(--fs-md); line-height: 1.3; }
    .card-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--fs-xs);
      color: var(--muted);
      margin-top: 2px;
      word-break: break-word;
    }
    .card-desc {
      margin: 0;
      font-size: var(--fs-sm);
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: var(--fs-xs); color: var(--muted); }
    .area-badge {
      font-size: var(--fs-xs);
      font-weight: 600;
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .mini-track {
      flex: 1;
      min-width: 48px;
      max-width: 96px;
      height: 5px;
      background: var(--surface);
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .mini-fill { display: block; height: 100%; background: var(--st-progress); }
    .mini-fill.is-done { background: var(--st-shipped); }
    .ref-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--fs-xs);
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .ref-closed { color: var(--st-shipped); border-color: color-mix(in srgb, var(--st-shipped) 35%, transparent); }
    .ref-in_progress, .ref-in-progress { color: var(--st-progress); border-color: color-mix(in srgb, var(--st-progress) 35%, transparent); }
    .ref-missing { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
    .card-pulse { font-size: var(--fs-sm); color: var(--muted); border-left: 2px solid var(--border); padding-left: 8px; }
    .status-planned { background: var(--st-planned-soft); color: var(--st-planned); }
    .status-in-progress, .status-active { background: var(--st-progress-soft); color: var(--st-progress); }
    .status-shipped { background: var(--st-shipped-soft); color: var(--st-shipped); }
    .status-paused { background: var(--st-paused-soft); color: var(--st-paused); }
    .status-cut, .status-archived { background: var(--st-cut-soft); color: var(--st-cut); }

    /* Dependency Graph View */
    body.view-mode-graph .container {
      max-width: none;
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 14px 20px 16px;
    }
    body.view-mode-graph header { padding-bottom: 10px; margin-bottom: 10px; }
    body.view-mode-graph h1 { font-size: var(--fs-lg); }
    body.view-mode-graph .subtitle { margin-top: 2px; font-size: var(--fs-base); }
    body.view-mode-graph .stats { gap: 8px; margin-bottom: 10px; }
    body.view-mode-graph .stat-card {
      padding: 7px 12px;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    body.view-mode-graph .stat-value { font-size: var(--fs-lg); margin-top: 0; }
    body.view-mode-graph .controls-row { margin-bottom: 10px; gap: 8px; }
    body.view-mode-graph .filters { padding: 7px 10px; }
    body.view-mode-graph main#milestones {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: max(420px, 55vh);
    }
    body.view-mode-graph .graph-shell {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding: 12px 14px 14px;
    }
    .graph-shell {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
    }
    .graph-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    .graph-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 0;
      font-size: var(--fs-xs);
      color: var(--muted);
    }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .legend-swatch { width: 10px; height: 10px; border-radius: var(--radius-sm); display: inline-block; }
    .graph-controls {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 3px;
    }
    .graph-ctrl-btn {
      min-width: 28px;
      height: 26px;
      padding: 0 8px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text);
      font-size: var(--fs-xs);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .graph-ctrl-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .graph-zoom-readout { min-width: 50px; font-variant-numeric: tabular-nums; }
    .graph-viewport {
      flex: 1 1 auto;
      min-height: 360px;
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background-color: var(--bg);
      background-image: radial-gradient(color-mix(in srgb, var(--border) 65%, transparent) 1px, transparent 1px);
      background-size: 24px 24px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .graph-viewport.is-dragging { cursor: grabbing; }
    .graph-viewport.is-dragging .graph-node { cursor: grabbing; }
    .graph-canvas {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      will-change: transform;
    }
    .graph-stage { position: relative; min-height: 240px; }
    .graph-edges {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .graph-edge {
      fill: none;
      stroke: var(--border);
      stroke-width: 1.8;
      marker-end: url(#pp-arrow);
      transition: stroke 0.14s ease, opacity 0.14s ease, stroke-width 0.14s ease;
    }
    .graph-edge.is-upstream { stroke: var(--trace-up); stroke-width: 2.6; opacity: 1; marker-end: url(#pp-arrow-up); }
    .graph-edge.is-downstream { stroke: var(--trace-down); stroke-width: 2.6; opacity: 1; marker-end: url(#pp-arrow-down); }
    .graph-edge.is-dimmed { opacity: 0.18; }
    .graph-node {
      position: absolute;
      text-align: left;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 12px;
      cursor: pointer;
      font-family: inherit;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 6px;
      transition: border-color 0.14s ease, box-shadow 0.14s ease, opacity 0.14s ease, transform 0.14s ease;
    }
    .graph-node:hover { border-color: var(--accent); }
    .graph-node.is-active {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-soft);
      transform: translateY(-1px);
    }
    .graph-node.is-upstream {
      border-color: var(--trace-up);
      box-shadow: 0 0 0 2px var(--trace-up-soft);
    }
    .graph-node.is-downstream {
      border-color: var(--trace-down);
      box-shadow: 0 0 0 2px var(--trace-down-soft);
    }
    .graph-node.is-dimmed { opacity: 0.28; }
    .graph-node-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
    .graph-node-title {
      font-weight: 650;
      font-size: var(--fs-sm);
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .graph-node-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: var(--fs-xs);
      color: var(--muted);
    }

    /* Status Board View */
    .board-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .board-col {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 180px;
    }
    .board-col-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .board-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 7px;
      transition: border-color 0.12s ease, transform 0.12s ease;
    }
    .board-card:hover { border-color: var(--accent); transform: translateY(-1px); }

    /* Drawer */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: var(--overlay);
      display: none;
      justify-content: flex-end;
      z-index: 50;
    }
    .drawer-backdrop.open { display: flex; }
    .drawer {
      width: min(560px, 100vw);
      height: 100%;
      background: var(--surface);
      border-left: 1px solid var(--border);
      padding: 24px;
      overflow-y: auto;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .close-btn {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 6px 10px;
      cursor: pointer;
      font-weight: 600;
      font-family: inherit;
    }
    .close-btn:hover { border-color: var(--accent); }
    .drawer-feedback {
      min-height: 20px;
      font-size: var(--fs-sm);
      border-radius: var(--radius);
      padding: 0;
    }
    .drawer-feedback.is-visible { padding: 7px 10px; border: 1px solid var(--border); }
    .drawer-feedback.is-saving { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
    .drawer-feedback.is-ok { background: var(--ok-soft); color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); }
    .drawer-feedback.is-err { background: var(--danger-soft); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
    .section-label { display: block; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 6px; font-weight: 700; }
    .criteria-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .criteria-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: var(--surface-2);
      padding: 9px 11px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      cursor: pointer;
    }
    .criteria-item:hover { border-color: var(--accent); }
    .criteria-item.is-readonly { cursor: default; }
    .criteria-item.is-readonly:hover { border-color: var(--border); }
    .criteria-item input { margin-top: 3px; cursor: pointer; flex-shrink: 0; }
    .criteria-item.is-readonly input { cursor: default; }
    .criteria-body { min-width: 0; flex: 1; }
    .criteria-text { font-size: var(--fs-base); }
    .criteria-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: var(--fs-xs);
      color: var(--muted);
      margin-top: 2px;
      word-break: break-word;
    }
    .note-form { display: flex; gap: 8px; }
    .note-form input {
      flex: 1;
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 10px;
      font-family: inherit;
    }
    .btn-primary {
      background: var(--accent);
      color: var(--on-accent);
      border: none;
      border-radius: var(--radius);
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-primary:disabled { opacity: 0.65; cursor: progress; }
    .updates-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .update-entry { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; font-size: var(--fs-sm); }
    .update-at { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--fs-xs); color: var(--muted); margin-bottom: 2px; }
    .dep-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--fs-xs);
      padding: 3px 9px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: var(--accent);
      cursor: pointer;
      border: 1px solid transparent;
      font-family: inherit;
    }
    .dep-chip:hover { border-color: var(--accent); }
    .empty-msg { color: var(--muted); font-style: italic; }
    .load-status { margin-top: 8px; padding: 8px 12px; border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); font-size: var(--fs-base); }
`;
