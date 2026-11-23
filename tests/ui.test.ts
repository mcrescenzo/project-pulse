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

  test("completing a deferred stale roadmap read cannot restore old data over a newer snapshot", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Stale Read App", summary: "Old responses must not clobber fresh data." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.addFeature({
      id: "stale-a",
      title: "Stale Read Target",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    try {
      const page = await context.newPage();
      const staleHeld = Promise.withResolvers<void>();
      const staleReleaseGate = Promise.withResolvers<void>();
      let roadmapRequests = 0;
      await page.route("**/api/roadmap", async (route) => {
        roadmapRequests += 1;
        if (roadmapRequests === 1) {
          // Capture a pre-edit snapshot and hold it in flight well past newer reads.
          const stale = await route.fetch();
          staleHeld.resolve();
          await staleReleaseGate.promise;
          await route.fulfill({ response: stale });
          return;
        }
        const fresh = await route.fetch();
        await route.fulfill({ response: fresh });
      });

      await page.goto(handle.openUrl, { waitUntil: "domcontentloaded" });
      await staleHeld.promise;

      // A newer read (triggered by the live reload event) must win while the first stays in flight.
      svc.addFeatureNote("stale-a", "Second read wins");
      await page.waitForFunction(
        () => (document.body.textContent || "").includes("Second read wins"),
        null,
        { timeout: 15000 }
      );

      // Only now does the old in-flight read complete; it must be discarded, not republished.
      const staleResponse = page.waitForResponse((response) => response.url().includes("/api/roadmap"));
      staleReleaseGate.resolve();
      await staleResponse;
      // Observe a bounded window in which a republished stale payload would drop the newer note.
      await page
        .waitForFunction(
          () => !(document.body.textContent || "").includes("Second read wins"),
          null,
          { timeout: 1500 }
        )
        .then(
          () => {
            throw new Error("Stale read replaced the newer snapshot");
          },
          () => undefined
        );
      expect(
        await page.evaluate(() => (document.body.textContent || "").includes("Second read wins"))
      ).toBe(true);
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  test("offline edit followed by SSE reconnect shows the new state without additional mutation", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Reconnect App", summary: "Missed edits surface on reconnect." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.addFeature({
      id: "recon-a",
      title: "Reconnect Target",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });

    const accessToken = "reconnect-fixture-token-0123456789";
    handle = startViewServer(tempDir, { port: 0, accessToken });
    const serverPort = handle.port;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    try {
      const page = await context.newPage();
      await page.goto(handle.openUrl, { waitUntil: "networkidle" });

      // Baseline live edit proves the event stream is connected before it is severed.
      svc.addFeatureNote("recon-a", "Baseline online note");
      await page.waitForFunction(
        () => (document.body.textContent || "").includes("Baseline online note"),
        null,
        { timeout: 15000 }
      );

      // Controlled disconnect: stopping the server closes the established SSE stream client-side.
      handle.stop();
      handle = null;
      await page.waitForFunction(
        () => (document.getElementById("live-badge")?.textContent || "").includes("Reconnecting"),
        null,
        { timeout: 15000 }
      );

      // Edited while disconnected: the SSE reload event is missed entirely.
      svc.addFeatureNote("recon-a", "Offline edit appears on reconnect");

      // Restart on the same port and token so the session cookie stays valid; the page itself
      // is never reloaded or interacted with from here on.
      handle = startViewServer(tempDir, { port: serverPort, accessToken });
      await page.waitForFunction(
        () => (document.body.textContent || "").includes("Offline edit appears on reconnect"),
        null,
        { timeout: 20000 }
      );
      expect(
        await page.evaluate(() => (document.getElementById("live-badge")?.textContent || "").includes("Live"))
      ).toBe(true);
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  test("failed roadmap loads show safe server diagnostics and clear once the current snapshot loads", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Diagnostics App", summary: "Server failures stay visible and safe." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.addFeature({
      id: "diag-a",
      title: "Diagnostics Target",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    try {
      const page = await context.newPage();
      const failRoadmap = () =>
        page.route("**/api/roadmap", (route) =>
          route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "PP-DIAG store read failed [redacted]" }),
          })
        );

      // Initial load failure surfaces the server-supplied redacted error, not a generic client string.
      await failRoadmap();
      await page.goto(handle.openUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => {
          const el = document.getElementById("load-status");
          return !!el && !el.hidden && (el.textContent || "").includes("PP-DIAG store read failed [redacted]");
        },
        null,
        { timeout: 15000 }
      );

      // A successful load of the current snapshot clears the diagnostics.
      await page.unroute("**/api/roadmap");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector('.card[data-feature-id="diag-a"]');
      await page.waitForFunction(
        () => {
          const el = document.getElementById("load-status");
          return !!el && el.hidden && (el.textContent || "") === "";
        },
        null,
        { timeout: 15000 }
      );

      // Live-reload failure keeps the last good data on screen and shows diagnostics again.
      await failRoadmap();
      svc.addFeatureNote("diag-a", "Diag note while failing");
      await page.waitForFunction(
        () => {
          const el = document.getElementById("load-status");
          return !!el && !el.hidden && (el.textContent || "").includes("PP-DIAG store read failed [redacted]");
        },
        null,
        { timeout: 15000 }
      );
      expect(await page.locator('.card[data-feature-id="diag-a"]').count()).toBe(1);

      // Recovery renders the current snapshot and clears the banner.
      await page.unroute("**/api/roadmap");
      svc.addFeatureNote("diag-a", "Diag note after recovery");
      await page.waitForFunction(
        () => (document.body.textContent || "").includes("Diag note after recovery"),
        null,
        { timeout: 15000 }
      );
      await page.waitForFunction(
        () => {
          const el = document.getElementById("load-status");
          return !!el && el.hidden;
        },
        null,
        { timeout: 15000 }
      );
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  test("drawer drafts and save feedback stay scoped when jumping between features", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Draft Scope App", summary: "Drafts and feedback follow their own feature." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.addFeature({
      id: "jump-b",
      title: "Dependency B",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });
    svc.addFeature({
      id: "jump-a",
      title: "Feature A",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
      depends_on: ["jump-b"],
    });
    svc.addFeature({
      id: "constructor",
      title: "Prototype Key Feature",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    try {
      const page = await context.newPage();
      await page.goto(handle.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector('.card[data-feature-id="jump-a"]');

      // Draft in A, then jump to dependency B: B must not inherit A's draft.
      await page.locator('.card[data-feature-id="jump-a"]').click();
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await page.locator("#drawer-title").textContent()).toBe("Feature A");
      await page.locator("#drawer-note-input").fill("Draft for A");
      await page.locator('.dep-chip[data-jump="jump-b"]').click();
      await page.waitForFunction(() => document.getElementById("drawer-title")?.textContent === "Dependency B");
      expect(await page.locator("#drawer-note-input").inputValue()).toBe("");

      // A retains its draft when the user comes back.
      await page.locator("#drawer-note-input").fill("Draft for B");
      await page.locator("#drawer-close").click();
      await page.locator('.card[data-feature-id="jump-a"]').click();
      await page.waitForFunction(() => document.getElementById("drawer-title")?.textContent === "Feature A");
      expect(await page.locator("#drawer-note-input").inputValue()).toBe("Draft for A");

      // Submit A's note with the save response deferred.
      const pulseGate = Promise.withResolvers<void>();
      const pulseHeld = Promise.withResolvers<void>();
      await page.route("**/api/features/jump-a/pulse", async (route) => {
        const res = await route.fetch();
        pulseHeld.resolve();
        await pulseGate.promise;
        await route.fulfill({ response: res });
      });

      await page.locator("#drawer-note-input").fill("Late note for A");
      await page.locator("#drawer-note-submit").click();
      await pulseHeld.promise;

      // While the old save is still deferred, a newer A draft begins; its resolution must not discard it.
      await page.locator("#drawer-note-input").fill("Newer draft for A");

      // Jump to B while A's save response is still deferred; give B its own draft.
      await page.locator('.dep-chip[data-jump="jump-b"]').click();
      await page.waitForFunction(() => document.getElementById("drawer-title")?.textContent === "Dependency B");
      await page.locator("#drawer-note-input").fill("Draft for B after jump");

      pulseGate.resolve();
      await page.waitForFunction(
        () => (document.body.textContent || "").includes("Late note for A"),
        null,
        { timeout: 15000 }
      );
      // A's late save response cannot change B's draft or B's feedback.
      expect(await page.locator("#drawer-note-input").inputValue()).toBe("Draft for B after jump");
      expect(await page.locator("#drawer-feedback").textContent()).toBe("");

      // The note landed for A, and A (not B) owns the persistent "Saved" feedback and newer draft.
      const savedA = svc.load().features.find((f) => f.id === "jump-a");
      expect(savedA?.updates.some((u) => u.note === "Late note for A")).toBe(true);
      await page.locator("#drawer-close").click();
      await page.locator('.card[data-feature-id="jump-a"]').click();
      await page.waitForFunction(() => document.getElementById("drawer-title")?.textContent === "Feature A");
      expect(await page.locator("#drawer-feedback").textContent()).toContain("Saved");
      expect(await page.locator("#drawer-note-input").inputValue()).toBe("Newer draft for A");

      // Prototype-colliding IDs dispatch and render through null-prototype draft/feedback maps.
      await page.locator("#drawer-close").click();
      await page.locator('.card[data-feature-id="constructor"]').click();
      await page.waitForFunction(
        () => document.getElementById("drawer-title")?.textContent === "Prototype Key Feature"
      );
      // An inherited-key read would leak Function garbage into the input; own-key dispatch keeps it empty.
      expect(await page.locator("#drawer-note-input").inputValue()).toBe("");
      await page.locator("#drawer-note-input").fill("Draft for constructor");
      await page.locator("#drawer-close").click();
      await page.locator('.card[data-feature-id="constructor"]').click();
      await page.waitForFunction(
        () => document.getElementById("drawer-title")?.textContent === "Prototype Key Feature"
      );
      expect(await page.locator("#drawer-note-input").inputValue()).toBe("Draft for constructor");

      // Real dispatch through the feedback map: submit and observe per-feature "Saved".
      await page.locator("#drawer-note-input").fill("Prototype note");
      await page.locator("#drawer-note-submit").click();
      await page.waitForFunction(
        () => (document.getElementById("drawer-feedback")?.textContent || "") === "Saved",
        null,
        { timeout: 15000 }
      );
      const savedCtor = svc.load().features.find((f) => f.id === "constructor");
      expect(savedCtor?.updates.some((u) => u.note === "Prototype note")).toBe(true);
      expect(await page.locator("#drawer-note-input").inputValue()).toBe("");
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  test("drawer survives drag-out to backdrop, closes on genuine backdrop press, and Escape dismisses the foremost surface first", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Modal Drawer App", summary: "Drawer layering and Escape focus restoration." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.addFeature({
      id: "dep-root",
      title: "Dependency Root",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });
    svc.addFeature({
      id: "dep-child",
      title: "Dependent Child",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
      depends_on: ["dep-root"],
    });
    // Persisted invalidity is introduced outside the service (mutations reject invalid
    // candidates): deleting the dependency's feature file yields a MISSING_DEPENDENCY
    // issue whose entityId targets 'dep-child', so the health panel offers an Inspect
    // chip that opens the drawer over the panel.
    rmSync(join(tempDir, ".project-pulse", "features", "dep-root.md"));

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    try {
      const page = await context.newPage();
      await page.goto(handle.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector('.card[data-feature-id="dep-child"]');

      // Open the health panel, then its Inspect chip: the drawer overlays the panel.
      await page.locator("#health-badge").click();
      await page.waitForSelector("#health-panel:not([hidden])");
      const inspectChip = page.locator('[data-health-jump="dep-child"]');
      await inspectChip.click();
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await page.locator("#drawer-title").textContent()).toBe("Dependent Child");

      // Escape dismisses the foremost surface (drawer), keeping the panel open beneath,
      // and restores focus to the trigger that opened the drawer.
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("drawer-backdrop")?.classList.contains("open"));
      expect(await page.locator("#health-panel").isHidden()).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-health-jump") ?? null)).toBe("dep-child");

      // A second Escape dismisses the underlying health panel and focuses the badge.
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.getElementById("health-panel")?.hidden === true);
      expect(await page.evaluate(() => document.activeElement?.id ?? null)).toBe("health-badge");

      // Reopen the stack and drag from inside the drawer out onto the backdrop: the
      // click Chromium fires on the common ancestor must not close the drawer.
      await page.locator("#health-badge").click();
      await page.waitForSelector("#health-panel:not([hidden])");
      await page.locator('[data-health-jump="dep-child"]').click();
      await page.waitForSelector("#drawer-backdrop.open");
      const titleBox = await page.locator("#drawer-title").boundingBox();
      expect(titleBox).not.toBeNull();
      await page.mouse.move(titleBox!.x + titleBox!.width / 2, titleBox!.y + titleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(200, 400, { steps: 8 });
      await page.mouse.up();
      expect(await page.locator("#drawer-backdrop.open").count()).toBe(1);
      expect(await page.locator("#drawer-title").textContent()).toBe("Dependent Child");

      // A genuine press starting and ending on the backdrop closes the drawer.
      await page.mouse.click(200, 400);
      await page.waitForFunction(() => !document.getElementById("drawer-backdrop")?.classList.contains("open"));
      expect(await page.locator("#health-panel").isHidden()).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-health-jump") ?? null)).toBe("dep-child");
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  test("a selected feature vanishing from the data hides the drawer, clears the selection, and restores graph shortcuts", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Vanish App", summary: "Stale selections must not block the graph." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    svc.addFeature({
      id: "vanish-a",
      title: "Vanishing Feature",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });
    svc.addFeature({
      id: "vanish-b",
      title: "Surviving Feature",
      milestone: "v0.1",
      status: "planned",
      area: "Core",
    });

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    try {
      const page = await context.newPage();
      await page.goto(handle.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector('.card[data-feature-id="vanish-a"]');
      await page.locator("#tab-graph").click();
      await page.waitForSelector('.graph-node[data-feature-id="vanish-a"]');

      await page.locator('.graph-node[data-feature-id="vanish-a"]').click();
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await page.locator("#drawer-title").textContent()).toBe("Vanishing Feature");

      // Delete the open feature on disk; the watcher-driven reload is the same live
      // update path an offline edit takes on SSE reconnect.
      svc.removeFeature("vanish-a");
      await page.waitForFunction(
        () => !document.getElementById("drawer-backdrop")?.classList.contains("open"),
        null,
        { timeout: 15000 }
      );

      // The stale selection must be gone: graph zoom shortcuts work again. The reload
      // re-fit the camera to 100%, so a working "+" visibly raises the scale.
      await page.keyboard.press("+");
      await page.waitForFunction(
        () => Number(document.getElementById("graph-canvas")?.getAttribute("data-scale")) > 1.05,
        null,
        { timeout: 15000 }
      );
      expect(await page.locator("#drawer-backdrop.open").count()).toBe(0);
      expect(await page.locator('.graph-node[data-feature-id="vanish-a"]').count()).toBe(0);
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);

  test("fit-to-view shows all nodes of a wide 24-feature layer at 1280px while interactive zoom stays floored", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Wide Fit App", summary: "Fit must reach every node in one wide layer." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Core", status: "active", order: 10 });
    for (let i = 1; i <= 24; i++) {
      const id = `fit-${String(i).padStart(2, "0")}`;
      svc.addFeature({
        id,
        title: `Wide Layer Feature ${i}`,
        milestone: "v0.1",
        status: "planned",
        area: "Core",
      });
    }

    handle = startViewServer(tempDir, { port: 0 });
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    try {
      const page = await context.newPage();
      await page.goto(handle.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector('.card[data-feature-id="fit-01"]');
      await page.locator("#tab-graph").click();
      await page.waitForSelector('.graph-node[data-feature-id="fit-24"]');
      expect(await page.locator(".graph-node").count()).toBe(24);

      const vpBox = await page.locator("#graph-viewport").boundingBox();
      expect(vpBox).not.toBeNull();

      // Fit must drop below the old 0.25 floor to fit the whole layer.
      await page.locator("#graph-zoom-fit").click();
      const fitScale = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(fitScale).toBeGreaterThan(0);
      expect(fitScale).toBeLessThan(0.25);
      const fittedNodes = await page.locator(".graph-node").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        })
      );
      for (const n of fittedNodes) {
        expect(n.left).toBeGreaterThanOrEqual(vpBox!.x - 1);
        expect(n.right).toBeLessThanOrEqual(vpBox!.x + vpBox!.width + 1);
        expect(n.top).toBeGreaterThanOrEqual(vpBox!.y - 1);
        expect(n.bottom).toBeLessThanOrEqual(vpBox!.y + vpBox!.height + 1);
      }

      // Zoom-in stays usable below the interactive floor.
      await page.locator("#graph-zoom-in").click();
      const afterZoomIn = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(afterZoomIn).toBeGreaterThan(fitScale);

      // Wheeling out while below the floor is a no-op, never a zoom-in jump.
      await page.mouse.move(vpBox!.x + vpBox!.width / 2, vpBox!.y + vpBox!.height / 2);
      await page.mouse.wheel(0, 240);
      const afterWheelOut = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(Math.abs(afterWheelOut - afterZoomIn)).toBeLessThan(0.0001);

      // Wheeling in still works and raises the scale.
      await page.mouse.wheel(0, -240);
      const afterWheelIn = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(afterWheelIn).toBeGreaterThan(afterWheelOut);

      // From the normal range the 0.25 interactive floor still applies to wheel zoom.
      await page.locator("#graph-zoom-reset").click();
      expect(Number(await page.locator("#graph-canvas").getAttribute("data-scale"))).toBe(1);
      await page.mouse.move(vpBox!.x + vpBox!.width / 2, vpBox!.y + vpBox!.height / 2);
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 240);
      }
      const flooredScale = Number(await page.locator("#graph-canvas").getAttribute("data-scale"));
      expect(flooredScale).toBeGreaterThanOrEqual(0.25);
      expect(flooredScale).toBeLessThan(1);
    } finally {
      await context.close();
    }
  }, BROWSER_TEST_TIMEOUT_MS);
});
