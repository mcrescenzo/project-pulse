import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright-core";
import { runCli } from "../src/cli";
import { exportStaticHtml } from "../src/export";
import { RoadmapService } from "../src/store";
import { BROWSER_TEST_TIMEOUT_MS, resolveChromiumExecutable } from "./helpers/chromium";

const CHROMIUM_PATH = resolveChromiumExecutable();
const testUi = CHROMIUM_PATH ? test : test.skip;

let tempDir: string;
let browser: Browser | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-export-"));
});

afterEach(async () => {
  if (browser) {
    await browser.close();
    browser = null;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

async function captureCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => err.push(a.map(String).join(" "));
  try {
    const code = await runCli(args, { cwd: tempDir });
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

describe("v0.3 Static HTML Export", () => {
  test("exports deterministic zero-network HTML with XSS-safe JSON escaping and --out support", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Export Project", summary: "Offline distribution demo." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Release", status: "active", order: 10 });
    svc.addFeature({
      id: "xss-test",
      title: "Safe Snapshot </script>",
      milestone: "v0.1",
      status: "in-progress",
      area: "UI",
      description: 'Checks </script><script>window.__pwned = true;</script> safety.',
      ship_criteria: ["Works offline", "Renders read-only drawer"],
    });
    svc.checkFeatureCriterion("xss-test", "1", true);

    const out1 = join(tempDir, "snapshot-1.html");
    const out2 = join(tempDir, "snapshot-2.html");

    const res1 = await captureCli(["export", "--html", "--out", out1, "--json"]);
    const res2 = await captureCli(["export", "--html", "--out", out2, "--json"]);
    expect(res1.code).toBe(0);
    expect(res2.code).toBe(0);

    const html1 = readFileSync(out1, "utf8");
    const html2 = readFileSync(out2, "utf8");

    // Deterministic byte-for-byte output
    expect(html1).toBe(html2);

    // Zero external http/https references
    expect(html1).not.toMatch(/\b(?:href|src)\s*=\s*["']https?:\/\//i);
    // Raw </script> inside JSON is escaped as \u003c/script>
    expect(html1).not.toContain('window.__pwned = true;</script>');
    expect(html1).toContain("\\u003c/script\\u003e");

    // Missing --html flag fails cleanly
    const missingFlag = await captureCli(["export"]);
    expect(missingFlag.code).toBe(1);
    expect(missingFlag.stderr).toContain("--html");

    // --out - returns HTML cleanly in library API
    const mem = await exportStaticHtml(tempDir, { outPath: "-" });
    expect(mem.outPath).toBeNull();
    expect(mem.html).toBe(html1);
  });

  testUi("renders views, filters, theme toggle, and read-only drawer offline over file:// with zero network calls", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Offline Browser Project", summary: "Static export runtime verification." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "shipped", order: 10 });
    svc.addFeature({
      id: "core-api",
      title: "Core API",
      milestone: "v0.1",
      status: "shipped",
      area: "Core",
      description: "First node </script><script>window.__xss=1</script>.",
      ship_criteria: ["API is deterministic"],
    });
    svc.addFeature({
      id: "offline-ui",
      title: "Offline Viewer",
      milestone: "v0.1",
      status: "planned",
      area: "UI",
      depends_on: ["core-api"],
      ship_criteria: ["Filters work offline"],
    });

    const outPath = join(tempDir, "dist", "roadmap.html");
    await exportStaticHtml(tempDir, { outPath });

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const blockedNetworkRequests: string[] = [];

      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await page.route("**/*", (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith("http://") || reqUrl.startsWith("https://")) {
          blockedNetworkRequests.push(reqUrl);
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(pathToFileURL(outPath).href, { waitUntil: "load" });
      await page.waitForSelector('.card[data-feature-id="core-api"]');

      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      expect(await page.locator("#live-badge").textContent()).toContain("Offline Snapshot");

      // Filters work offline
      await page.locator("#filter-search").fill("Viewer");
      expect(await page.locator(".card").count()).toBe(1);
      await page.locator("#filter-reset").click();
      expect(await page.locator(".card").count()).toBe(2);

      // View switcher works offline
      await page.locator("#tab-graph").click();
      await page.waitForSelector('.graph-node[data-feature-id="offline-ui"]');
      await page.locator("#tab-board").click();
      await page.waitForSelector('.board-card[data-feature-id="core-api"]');

      // Opening drawer offline renders read-only controls (no form, disabled checkbox)
      await page.locator('.board-card[data-feature-id="core-api"]').click();
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await page.locator("#drawer-status").count()).toBe(0);
      expect(await page.locator("#drawer-note-form").count()).toBe(0);
      expect(
        await page.locator('#drawer input[data-criterion-id]').first().isDisabled()
      ).toBe(true);

      await page.keyboard.press("Escape");

      // Theme toggle works offline
      await page.locator("#theme-toggle").click();
      expect(["light", "dark"]).toContain(
        (await page.evaluate(() => document.documentElement.dataset.theme)) ?? ""
      );

      expect(blockedNetworkRequests).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);
});
