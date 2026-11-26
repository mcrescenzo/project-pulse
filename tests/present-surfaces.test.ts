import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { RoadmapService } from "../src/store";
import { startViewServer, type ViewServerHandle } from "../src/view";
import { BROWSER_TEST_TIMEOUT_MS, resolveChromiumExecutable } from "./helpers/chromium";
import { openTui, press, screenText } from "./helpers/tui";

const CHROMIUM_PATH = resolveChromiumExecutable();
const describeUi = CHROMIUM_PATH ? describe : describe.skip;

/** Display text that the shared vocabulary replaced. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ["ACTIVE KPI label", /\bACTIVE\b/],
  ["abbreviated warn", /\bwarn\b/],
  ["raw in-progress enum", /\bin-progress\b/],
  ["raw in_progress enum", /\bin_progress\b/],
  ["plural (s) suffix", /\(s\)/],
  ["raw ISO timestamp", /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/],
];

function violations(text: string): string[] {
  return FORBIDDEN.filter(([, re]) => re.test(text)).map(([name, re]) => `${name}: ${text.match(re)![0]}`);
}

let tempDir: string;
let handle: ViewServerHandle | null = null;
let browser: Browser | null = null;

function seed(dir: string): void {
  const svc = new RoadmapService(dir);
  svc.init({ name: "Vocabulary", summary: "Shared labels." });
  svc.upsertMilestone({ id: "m1", title: "Milestone One", status: "active", order: 10 });
  svc.addFeature({
    id: "busy",
    title: "Busy feature",
    milestone: "m1",
    status: "in-progress",
    area: "Core",
    // more than the recommended criteria count yields a validation warning
    ship_criteria: ["a", "b", "c", "d", "e", "f", "g"],
  });
  svc.addFeature({ id: "done", title: "Done feature", milestone: "m1", status: "shipped", ship_criteria: [] });
  svc.logFeaturePulse({ id: "busy", note: "Progress note with a timestamp." });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-present-surfaces-"));
  seed(tempDir);
});

afterEach(async () => {
  await browser?.close();
  browser = null;
  await handle?.stop();
  handle = null;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("shared vocabulary on the TUI", () => {
  test("no view, drawer or overlay shows retired labels, raw enums or ISO timestamps", () => {
    for (const [w, h] of [
      [80, 24],
      [140, 40],
    ] as const) {
      const { ctrl } = openTui(tempDir, w, h);
      try {
        const seen: string[] = [];
        seen.push(screenText(ctrl));
        press(ctrl, "2");
        seen.push(screenText(ctrl));
        press(ctrl, "3");
        seen.push(screenText(ctrl));
        press(ctrl, "1");
        press(ctrl, "enter");
        seen.push(screenText(ctrl));
        const all = seen.join("\n");
        expect(violations(all)).toEqual([]);
        expect(all).toContain("in progress");
        expect(all).toMatch(/0\/7 criteria/);
        expect(all).toContain("1 warning");
      } finally {
        ctrl.stop();
      }
    }
  });
});

describeUi("shared vocabulary on the web dashboard", () => {
  test(
    "no view or drawer shows retired labels, raw enums or ISO timestamps",
    async () => {
      handle = await startViewServer(tempDir, { port: 0 });
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      await page.goto(handle.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-feature-id="busy"]');
      const seen: string[] = [];
      const visibleText = () =>
        page.evaluate(() => {
          const opts = [...document.querySelectorAll("option")].map((o) => o.textContent ?? "");
          return document.body.innerText + "\n" + opts.join("\n");
        });
      seen.push(await visibleText());
      for (const tab of ["graph", "board", "cards"]) {
        await page.click(`[data-view="${tab}"]`);
        await page.waitForTimeout(150);
        seen.push(await visibleText());
      }
      await page.click('[data-feature-id="busy"]');
      await page.waitForSelector("#drawer-backdrop.open");
      seen.push(await visibleText());
      const all = seen.join("\n");
      expect(violations(all)).toEqual([]);
      expect(all).toContain("in progress");
      expect(all).toContain("0/7 criteria");
      expect(all).toContain("1 warning");
      expect(all).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}/);
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});
