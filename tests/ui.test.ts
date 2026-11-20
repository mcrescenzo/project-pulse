import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { RoadmapService } from "../src/store";
import { startViewServer, type ViewServerHandle } from "../src/view";
import { BROWSER_TEST_TIMEOUT_MS, resolveChromiumExecutable } from "./helpers/chromium";

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

      await page.goto(handle.openUrl, { waitUntil: "networkidle" });
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
  }, BROWSER_TEST_TIMEOUT_MS);

  test("switches between Cards, Dependency Graph, and Status Board views with shared filters and DAG highlight", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "View Modes App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Foundation", status: "shipped", order: 10 });
    svc.upsertMilestone({ id: "v0.2", title: "v0.2 Next", status: "planned", order: 20 });
    svc.addFeature({
      id: "node-a",
      title: "Base Store",
      milestone: "v0.1",
      status: "shipped",
      area: "Core",
    });
    svc.addFeature({
      id: "node-b",
      title: "Query Engine",
      milestone: "v0.2",
      status: "in-progress",
      area: "Core",
      depends_on: ["node-a"],
    });
    svc.addFeature({
      id: "node-c",
      title: "Dashboard View",
      milestone: "v0.2",
      status: "planned",
      area: "UI",
      depends_on: ["node-b"],
    });
    svc.addFeature({
      id: "node-d",
      title: "Docs Polish",
      milestone: "v0.2",
      status: "planned",
      area: "Docs",
    });

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    try {
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });

      await page.goto(handle.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector('.card[data-feature-id="node-a"]');

      // Filtering by "planned" hides milestones with no matching features
      expect(await page.locator("section.milestone").count()).toBe(2);
      await page.locator("#filter-status").selectOption("planned");
      expect(await page.locator("section.milestone").count()).toBe(1);
      expect(await page.locator("section.milestone h2").textContent()).toBe("v0.2 Next");
      await page.locator("#filter-reset").click();
      expect(await page.locator("section.milestone").count()).toBe(2);

      // Switch to Dependency Graph view
      await page.locator("#tab-graph").click();
      await page.waitForSelector('.graph-node[data-feature-id="node-b"]');

      // 1. Verify full-window layout & top-to-bottom waterfall ordering
      expect(await page.evaluate(() => document.body.classList.contains("view-mode-graph"))).toBe(true);
      const vpBox = await page.locator("#graph-viewport").boundingBox();
      expect(vpBox).not.toBeNull();
      expect(vpBox!.height).toBeGreaterThanOrEqual(450);
      expect(vpBox!.width).toBeGreaterThanOrEqual(1280);

      const boxA = await page.locator('.graph-node[data-feature-id="node-a"]').boundingBox();
      const boxB = await page.locator('.graph-node[data-feature-id="node-b"]').boundingBox();
      const boxC = await page.locator('.graph-node[data-feature-id="node-c"]').boundingBox();
      expect(boxA).not.toBeNull();
      expect(boxB).not.toBeNull();
      expect(boxC).not.toBeNull();
      expect(boxA!.y).toBeLessThan(boxB!.y);
      expect(boxB!.y).toBeLessThan(boxC!.y);

      // 2. Verify toolbar zoom, fit-to-view, reset, and mouse wheel zoom
      const initialScale = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(initialScale).toBe(1);

      await page.locator("#graph-zoom-out").click();
      const zoomedOutScale = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(zoomedOutScale).toBeLessThan(initialScale);
      expect(await page.locator("#graph-zoom-reset").textContent()).toBe(
        `${Math.round(zoomedOutScale * 100)}%`
      );

      await page.locator("#graph-zoom-in").click();
      const zoomedInScale = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(zoomedInScale).toBeGreaterThan(zoomedOutScale);

      await page.locator("#graph-zoom-fit").click();
      const vpFitBox = await page.locator("#graph-viewport").boundingBox();
      const fittedNodes = await page.locator(".graph-node").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        })
      );
      for (const n of fittedNodes) {
        expect(n.left).toBeGreaterThanOrEqual(vpFitBox!.x - 1);
        expect(n.right).toBeLessThanOrEqual(vpFitBox!.x + vpFitBox!.width + 1);
        expect(n.top).toBeGreaterThanOrEqual(vpFitBox!.y - 1);
        expect(n.bottom).toBeLessThanOrEqual(vpFitBox!.y + vpFitBox!.height + 1);
      }

      await page.locator("#graph-zoom-reset").click();
      expect(Number(await page.locator("#graph-canvas").getAttribute("data-scale"))).toBe(1);
      expect(await page.locator("#graph-zoom-reset").textContent()).toBe("100%");

      // Wheel zoom decreases scale
      await page.mouse.move(vpBox!.x + vpBox!.width / 2, vpBox!.y + vpBox!.height / 2);
      await page.mouse.wheel(0, 240);
      const wheelScale = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(wheelScale).toBeLessThan(1);

      // 3. Click-and-drag panning starting over a node updates transform without opening drawer
      const beforeTransform = await page.locator("#graph-canvas").evaluate((el) => el.style.transform);
      const dragStartBox = await page.locator('.graph-node[data-feature-id="node-b"]').boundingBox();
      const startX = dragStartBox!.x + dragStartBox!.width / 2;
      const startY = dragStartBox!.y + dragStartBox!.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 75, startY + 55, { steps: 6 });
      await page.mouse.up();
      const afterTransform = await page.locator("#graph-canvas").evaluate((el) => el.style.transform);
      expect(afterTransform).not.toBe(beforeTransform);
      expect(await page.locator("#drawer-backdrop.open").count()).toBe(0);

      // Focusing middle node B highlights upstream A, downstream C, and dims unrelated D
      await page.locator('.graph-node[data-feature-id="node-b"]').focus();
      const highlightState = await page.evaluate(() => ({
        a: document.querySelector('.graph-node[data-feature-id="node-a"]')?.className,
        b: document.querySelector('.graph-node[data-feature-id="node-b"]')?.className,
        c: document.querySelector('.graph-node[data-feature-id="node-c"]')?.className,
        d: document.querySelector('.graph-node[data-feature-id="node-d"]')?.className,
        edges: document.querySelectorAll(".graph-edge").length,
      }));
      expect(highlightState.edges).toBe(2);
      expect(highlightState.a).toContain("is-upstream");
      expect(highlightState.b).toContain("is-active");
      expect(highlightState.c).toContain("is-downstream");
      expect(highlightState.d).toContain("is-dimmed");

      // Plain clicking node C after drag opens drawer
      await page.locator('.graph-node[data-feature-id="node-c"]').click();
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await page.locator("#drawer-title").textContent()).toBe("Dashboard View");
      await page.keyboard.press("Escape");

      // Switch to Status Board view removes full-height graph body class and shares filter
      await page.locator("#filter-search").fill("Docs");
      await page.locator("#tab-board").click();
      await page.waitForSelector('.board-card[data-feature-id="node-d"]');
      expect(await page.evaluate(() => document.body.classList.contains("view-mode-graph"))).toBe(false);
      expect(await page.locator(".board-card").count()).toBe(1);

      // Clear filter and press Enter on Status Board card opens drawer
      await page.locator("#filter-reset").click();
      expect(await page.locator(".board-card").count()).toBe(4);
      await page.locator('.board-card[data-feature-id="node-a"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await page.locator("#drawer-title").textContent()).toBe("Base Store");

      expect(consoleErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);
});
