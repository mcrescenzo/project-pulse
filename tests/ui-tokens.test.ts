import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { buildPortfolioHtml } from "../src/dashboard-html";
import { RoadmapService } from "../src/store";
import { startViewServer, type ViewServerHandle } from "../src/view";
import { BROWSER_TEST_TIMEOUT_MS, resolveChromiumExecutable } from "./helpers/chromium";

const CHROMIUM_PATH = resolveChromiumExecutable();
const describeUi = CHROMIUM_PATH ? describe : describe.skip;

let tempDir: string;
let handle: ViewServerHandle | null = null;
let browser: Browser | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-ui-tokens-"));
});

afterEach(async () => {
  await browser?.close();
  browser = null;
  await handle?.stop();
  handle = null;
  rmSync(tempDir, { recursive: true, force: true });
});

describeUi("design tokens in the browser", () => {
  test(
    "reduced motion disables transitions on the dashboard and hub, and status words never wrap, in both themes",
    async () => {
      const svc = new RoadmapService(tempDir);
      svc.init({ name: "Tokens", summary: "Token checks." });
      svc.upsertMilestone({ id: "m1", title: "M1", status: "active", order: 10 });
      svc.addFeature({ id: "f1", title: "Feature one", milestone: "m1", status: "in-progress", ship_criteria: ["a"] });
      handle = await startViewServer(tempDir, { port: 0 });
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });

      for (const colorScheme of ["dark", "light"] as const) {
        const ctx = await browser.newContext({
          viewport: { width: 360, height: 800 },
          reducedMotion: "reduce",
          colorScheme,
        });
        const page = await ctx.newPage();
        await page.goto(handle.openUrl, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-feature-id="f1"]');

        const dashboard = await page.evaluate(() => {
          const durations = [...document.querySelectorAll("*")]
            .map((el) => getComputedStyle(el).transitionDuration)
            .filter((d) => d.split(",").some((part) => parseFloat(part) > 0));
          const pills = [...document.querySelectorAll(".pill")].map((el) => ({
            ws: getComputedStyle(el).whiteSpace,
            lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || "16")),
          }));
          return { durations, pills };
        });
        expect(dashboard.durations).toEqual([]);
        expect(dashboard.pills.length).toBeGreaterThan(0);
        expect(dashboard.pills.every((p) => p.ws === "nowrap")).toBe(true);

        await page.setContent(buildPortfolioHtml());
        const hubDurations = await page.evaluate(() =>
          [...document.querySelectorAll("*")]
            .map((el) => getComputedStyle(el).transitionDuration)
            .filter((d) => d.split(",").some((part) => parseFloat(part) > 0))
        );
        expect(hubDurations).toEqual([]);
        await ctx.close();
      }
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});
