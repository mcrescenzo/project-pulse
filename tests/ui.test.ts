import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { RoadmapService } from "../src/store";
import { startViewServer, type ViewServerHandle } from "../src/view";

function resolveChromiumExecutable(): string | null {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

const CHROMIUM_PATH = resolveChromiumExecutable();
const describeUi = CHROMIUM_PATH ? describe : describe.skip;

let tempDir: string;
let handle: ViewServerHandle | null = null;
let browser: Browser | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-ui-"));
});

afterEach(async () => {
  if (browser) {
    await browser.close();
    browser = null;
  }
  if (handle) {
    handle.stop();
    handle = null;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describeUi("Playwright UI Regression Suite (pp view)", () => {
  test("keyboard a11y, criterion label click, SSE draft preservation, health popover, theme toggle, and zero 404/console errors", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "UI Test App", summary: "Browser verification project." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.addFeature({
      id: "ui-feature",
      title: "Interactive Dashboard",
      milestone: "v0.1",
      status: "in-progress",
      area: "UI",
      description: "Verifies accessibility, SSE resilience, health panel, and themes.",
      ship_criteria: ["Keyboard navigation works", "Label click toggles checkbox"],
    });

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    try {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const httpErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("response", (res) => {
        if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.url()}`);
      });

      await page.goto(handle.url, { waitUntil: "networkidle" });
      await page.waitForSelector('.card[data-feature-id="ui-feature"]');

      // 1. Keyboard navigation: focus card -> Enter opens ARIA dialog drawer -> Escape closes & restores focus
      const card = page.locator('.card[data-feature-id="ui-feature"]');
      await card.focus();
      await page.keyboard.press("Enter");

      const drawer = page.locator("#drawer");
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await drawer.getAttribute("role")).toBe("dialog");
      expect(await drawer.getAttribute("aria-modal")).toBe("true");

      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("drawer-backdrop")?.classList.contains("open"));
      const activeFeatureAttr = await page.evaluate(
        () => document.activeElement?.getAttribute("data-feature-id") ?? null
      );
      expect(activeFeatureAttr).toBe("ui-feature");

      // Re-open with Space key
      await page.keyboard.press("Space");
      await page.waitForSelector("#drawer-backdrop.open");

      // 2. Clicking criterion text (via wrapping <label>) persists to disk and ROADMAP.md
      await page.locator(".criteria-item", { hasText: "Label click toggles checkbox" }).click();
      await page.waitForFunction(() => {
        const boxes = document.querySelectorAll('#drawer input[data-criterion-id]');
        return boxes.length === 2 && (boxes[1] as HTMLInputElement).checked;
      });
      const updatedFeature = svc.load().features.find((f) => f.id === "ui-feature");
      expect(updatedFeature?.ship_criteria[1]?.done).toBe(true);
      expect(readFileSync(join(tempDir, "ROADMAP.md"), "utf8")).toContain(
        "- [x] Label click toggles checkbox"
      );

      // 3. Unsaved note draft in drawer survives an external SSE reload
      const noteInput = page.locator("#drawer-note-input");
      await noteInput.fill("Unsaved draft note in progress");
      await noteInput.focus();

      svc.addFeatureNote("ui-feature", "External disk note");
      await page.waitForFunction(() => {
        return (document.getElementById("drawer")?.textContent || "").includes("External disk note");
      });
      expect(await noteInput.inputValue()).toBe("Unsaved draft note in progress");

      // Close drawer cleanly
      await page.keyboard.press("Escape");

      // 4. Health badge opens health diagnostics panel displaying seeded validation errors
      writeFileSync(join(tempDir, "ROADMAP.md"), "# Manually dirtied\n", "utf8");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(() =>
        (document.getElementById("health-badge")?.textContent || "").includes("error")
      );
      await page.locator("#health-badge").click();
      await page.waitForSelector("#health-panel:not([hidden])");
      const panelText = await page.locator("#health-panel").textContent();
      expect(panelText).toContain("ROADMAP_OUT_OF_SYNC");

      // Restore ROADMAP.md clean state
      svc.render();

      // 5. Theme toggle switches data-theme and persists across page.reload()
      const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? "auto");
      await page.locator("#theme-toggle").click();
      const toggledTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      expect(toggledTheme).not.toBe(initialTheme);
      expect(["light", "dark"]).toContain(toggledTheme);

      await page.reload({ waitUntil: "networkidle" });
      const persistedTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      expect(persistedTheme).toBe(toggledTheme);

      expect(consoleErrors).toEqual([]);
      expect(httpErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
