import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDashboardHtml, buildPortfolioHtml } from "../src/dashboard-html";
import {
  RADII,
  STATUS_ROLES,
  SURFACE_ROLES,
  SYSTEM_ROLES,
  TEXT_ROLES,
  THEME_TOKENS,
  TINT_PERCENT,
  TYPE_SCALE,
} from "../src/dashboard/theme";

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) throw new Error(`not a #rrggbb colour: ${value}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: Rgb): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Same blend as `color-mix(in srgb, fg P%, bg)`. */
function mix(fg: Rgb, bg: Rgb, percent: number): Rgb {
  const p = percent / 100;
  return [0, 1, 2].map((i) => Math.round(fg[i]! * p + bg[i]! * (1 - p))) as Rgb;
}

function hue([r, g, b]: Rgb): number {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return -1; // achromatic
  let h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe("dashboard design tokens", () => {
  for (const [themeName, tokens] of Object.entries(THEME_TOKENS)) {
    test(`${themeName}: every text role reaches 4.5:1 on every surface and on its own tint`, () => {
      const failures: string[] = [];
      for (const role of TEXT_ROLES) {
        const fg = hex(tokens[role]);
        for (const surface of SURFACE_ROLES) {
          const ratio = contrast(fg, hex(tokens[surface]));
          if (ratio < 4.5) failures.push(`${role} on ${surface}: ${ratio.toFixed(2)}`);
        }
        const tinted = mix(fg, hex(tokens.surface), TINT_PERCENT);
        const ratio = contrast(fg, tinted);
        if (ratio < 4.5) failures.push(`${role} on its tint: ${ratio.toFixed(2)}`);
      }
      const onAccent = contrast(hex(tokens["on-accent"]), hex(tokens.accent));
      if (onAccent < 4.5) failures.push(`on-accent on accent: ${onAccent.toFixed(2)}`);
      expect(failures).toEqual([]);
    });

    test(`${themeName}: no system role reuses a status hue`, () => {
      const clashes: string[] = [];
      for (const sys of SYSTEM_ROLES) {
        const hs = hue(hex(tokens[sys]));
        for (const st of STATUS_ROLES) {
          const ht = hue(hex(tokens[st]));
          if (tokens[sys].toLowerCase() === tokens[st].toLowerCase()) clashes.push(`${sys} = ${st}`);
          else if (hs >= 0 && ht >= 0 && hueDistance(hs, ht) < 12) {
            clashes.push(`${sys} (${hs.toFixed(0)}°) ~ ${st} (${ht.toFixed(0)}°)`);
          }
        }
      }
      expect(clashes).toEqual([]);
    });
  }

  const pages = {
    dashboard: buildDashboardHtml({ mode: "live" }),
    portfolio: buildPortfolioHtml(),
  };

  for (const [name, html] of Object.entries(pages)) {
    test(`${name}: font sizes and radii come only from the token scales`, () => {
      const sizes = [...html.matchAll(/font-size:\s*([^;"'}]+)/g)].map((m) => m[1]!.trim());
      const badSizes = sizes.filter((v) => !/^var\(--fs-(xs|sm|base|md|lg|xl)\)$/.test(v) && v !== "inherit");
      expect(badSizes).toEqual([]);
      expect(Object.keys(TYPE_SCALE).length).toBeLessThanOrEqual(6);
      expect(Math.min(...Object.values(TYPE_SCALE).map((v) => parseFloat(v)))).toBeGreaterThanOrEqual(12);

      const radii = [...html.matchAll(/border-radius:\s*([^;"'}]+)/g)].map((m) => m[1]!.trim());
      const badRadii = radii.filter((v) => !/^var\(--radius(-sm)?\)$/.test(v) && v !== "0");
      expect(badRadii).toEqual([]);
      expect(Object.keys(RADII).length).toBeLessThanOrEqual(2);
    });

    test(`${name}: no hard-coded colours outside the token definitions`, () => {
      const tokenBlockEnd = html.indexOf("@media (prefers-reduced-motion");
      const rest = html.slice(tokenBlockEnd).replace(/<link rel="icon"[^>]*>/g, "");
      const literals = [...rest.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)].map((m) => m[0]);
      expect(literals).toEqual([]);
    });

    test(`${name}: reduced motion disables transitions`, () => {
      expect(html).toContain("@media (prefers-reduced-motion: reduce)");
      expect(html).toMatch(/transition: none !important/);
    });
  }

  test("DESIGN.md documents every token value for both themes and the type scale", () => {
    const doc = readFileSync(join(import.meta.dir, "..", "DESIGN.md"), "utf8");
    const missing: string[] = [];
    for (const role of Object.keys(THEME_TOKENS.dark) as (keyof typeof THEME_TOKENS.dark)[]) {
      const row = `| \`--${role}\` | \`${THEME_TOKENS.dark[role]}\` | \`${THEME_TOKENS.light[role]}\` |`;
      if (!doc.includes(row)) missing.push(row);
    }
    for (const [step, size] of Object.entries(TYPE_SCALE)) {
      const row = `| \`--fs-${step}\` | ${size} |`;
      if (!doc.includes(row)) missing.push(row);
    }
    for (const [name, size] of Object.entries(RADII)) {
      const token = name === "sm" ? "--radius-sm" : "--radius";
      if (!doc.includes(`\`${token}\` ${size}`)) missing.push(`${token} ${size}`);
    }
    expect(missing).toEqual([]);
  });
});
