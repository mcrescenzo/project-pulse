/**
 * Theme primitives shared by the project dashboard and the hub portfolio page.
 */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f172a"/><path d="M5 17h5l3-8 5 14 3-6h6" fill="none" stroke="#60a5fa" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

/** Colour roles. Status roles are the only colours that encode feature status; every other role
 * (interactive accent, connection, validation, graph trace) uses a hue no status role uses. */
export interface ThemeTokens {
  bg: string;
  surface: string;
  "surface-2": string;
  border: string;
  text: string;
  muted: string;
  "st-planned": string;
  "st-progress": string;
  "st-shipped": string;
  "st-paused": string;
  "st-cut": string;
  accent: string;
  "on-accent": string;
  live: string;
  ok: string;
  warn: string;
  danger: string;
  "trace-up": string;
  "trace-down": string;
  overlay: string;
  shadow: string;
}

export const STATUS_ROLES = ["st-planned", "st-progress", "st-shipped", "st-paused", "st-cut"] as const;
export const SYSTEM_ROLES = ["accent", "live", "ok", "warn", "danger", "trace-up", "trace-down"] as const;
/** Roles rendered as text; each must reach 4.5:1 on every surface and on its own tinted fill. */
export const TEXT_ROLES = ["text", "muted", ...STATUS_ROLES, ...SYSTEM_ROLES] as const;
export const SURFACE_ROLES = ["bg", "surface", "surface-2"] as const;
/** Opacity of the tinted fill behind coloured text (pills, chips, notices). */
export const TINT_PERCENT = 14;

export const THEME_TOKENS: { dark: ThemeTokens; light: ThemeTokens } = {
  dark: {
    bg: "#0b0f17",
    surface: "#121826",
    "surface-2": "#192234",
    border: "#263147",
    text: "#e6edf7",
    muted: "#93a4bd",
    "st-planned": "#94a3b8",
    "st-progress": "#60a5fa",
    "st-shipped": "#34d399",
    "st-paused": "#fbbf24",
    "st-cut": "#a8a8a8",
    accent: "#b69dfb",
    "on-accent": "#0b0f17",
    live: "#2dd4bf",
    ok: "#2dd4bf",
    warn: "#fb923c",
    danger: "#f87171",
    "trace-up": "#f0abfc",
    "trace-down": "#67e8f9",
    overlay: "rgba(0, 0, 0, 0.55)",
    shadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
  },
  light: {
    bg: "#f6f8fc",
    surface: "#ffffff",
    "surface-2": "#f1f5f9",
    border: "#dbe3ef",
    text: "#0f172a",
    muted: "#475569",
    "st-planned": "#4b5869",
    "st-progress": "#1d4ed8",
    "st-shipped": "#03684b",
    "st-paused": "#7c4a00",
    "st-cut": "#5e5e5e",
    accent: "#6d28d9",
    "on-accent": "#ffffff",
    live: "#0b6b64",
    ok: "#0b6b64",
    warn: "#a63a08",
    danger: "#b91c1c",
    "trace-up": "#9d1aaa",
    "trace-down": "#0b6a85",
    overlay: "rgba(15, 23, 42, 0.45)",
    shadow: "0 10px 28px rgba(15, 23, 42, 0.08)",
  },
};

/** Type scale (6 steps, 12px floor), spacing scale and the two radii. */
export const TYPE_SCALE = { xs: "12px", sm: "13px", base: "14px", md: "16px", lg: "20px", xl: "28px" } as const;
export const SPACE_SCALE = { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "24px" } as const;
export const RADII = { sm: "4px", md: "8px" } as const;

function themeVars(tokens: ThemeTokens, indent: string): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${indent}--${k}: ${v};`)
    .join("\n");
}

const tint = (role: string) => `color-mix(in srgb, var(--${role}) ${TINT_PERCENT}%, var(--surface))`;

export const SHARED_THEME_CSS = `
    :root {
      color-scheme: dark;
${themeVars(THEME_TOKENS.dark, "      ")}
${Object.entries(TYPE_SCALE).map(([k, v]) => `      --fs-${k}: ${v};`).join("\n")}
${Object.entries(SPACE_SCALE).map(([k, v]) => `      --sp-${k}: ${v};`).join("\n")}
      --radius-sm: ${RADII.sm};
      --radius: ${RADII.md};
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
${[...STATUS_ROLES, ...SYSTEM_ROLES].map((r) => `      --${r}-soft: ${tint(r)};`).join("\n")}
    }
    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        color-scheme: light;
${themeVars(THEME_TOKENS.light, "        ")}
      }
    }
    :root[data-theme="light"] {
      color-scheme: light;
${themeVars(THEME_TOKENS.light, "      ")}
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
      }
    }
    .nowrap, .pill, .status-word { white-space: nowrap; }
    .num { font-variant-numeric: tabular-nums; }
    .mono { font-family: var(--font-mono); }
`;

export const EARLY_THEME_SCRIPT = `
  <script>
    (function () {
      try {
        var saved = localStorage.getItem("pp-theme");
        if (saved === "light" || saved === "dark") {
          document.documentElement.dataset.theme = saved;
        }
      } catch (e) {}
    })();
  </script>
`;
