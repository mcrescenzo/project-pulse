/**
 * Browser acceptance for the read-first web dashboard (pp-t80.20): Roadmap ledger, distribution
 * filter, drawer feedback / freeze / ship confirm / a11y, Activity, Graph fit and pin, load-error
 * state and the hub page.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { startHubServer, type HubServerHandle } from "../src/hub";
import { formatDay } from "../src/present";
import { RoadmapService } from "../src/store";
import { startViewServer, type ViewServerHandle } from "../src/view";
import { BROWSER_TEST_TIMEOUT_MS, resolveChromiumExecutable } from "./helpers/chromium";
import { buildActivityRepo, buildAurora } from "./fixtures/dashboard-fixtures";

const CHROMIUM_PATH = resolveChromiumExecutable();
const describeUi = CHROMIUM_PATH ? describe : describe.skip;
const noBeads = { resolveRefs: async () => [] };

let tempDir: string;
let handle: ViewServerHandle | null = null;
let hub: HubServerHandle | null = null;
let browser: Browser | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-v21-web-"));
});

afterEach(async () => {
  await browser?.close();
  browser = null;
  await handle?.stop();
  handle = null;
  await hub?.stop();
  hub = null;
  rmSync(tempDir, { recursive: true, force: true });
});

async function open(root: string, width = 1440, height = 900, opts: { noLiveReload?: boolean; init?: string } = {}): Promise<Page> {
  handle ??= await startViewServer(root, { port: 0, beadsClient: noBeads });
  browser ??= await chromium.launch({ executablePath: CHROMIUM_PATH! });
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  if (opts.noLiveReload) await page.route("**/api/events", (r) => r.abort());
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(handle.openUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".row-open[data-feature-id], [data-empty], [data-state='load-error']");
  return page;
}

const box = (page: Page, sel: string) => page.locator(sel).first().boundingBox();

async function inViewport(page: Page, sel: string): Promise<boolean> {
  return page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
  });
}

describeUi("web Roadmap ledger", () => {
  test(
    "first row in the top 300px, no horizontal overflow, grouped rows with columns, Issues column iff bd refs",
    async () => {
      buildAurora(tempDir);
      for (const [w, h] of [
        [1440, 900],
        [720, 900],
      ] as const) {
        const page = await open(tempDir, w, h);
        const first = await box(page, "tr.row");
        expect(first!.y).toBeLessThanOrEqual(300);
        await page.context().close();
      }
      for (const w of [1440, 720, 360]) {
        const page = await open(tempDir, w, 800);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.context().close();
      }

      const page = await open(tempDir, 1440, 900);
      const headers = await page.locator(".ledger thead th").allTextContents();
      expect(headers).toEqual(["Status", "Feature", "ID", "Criteria", "Area", "Needs", "Issues", "Latest update"]);
      // every feature is a row under its milestone group, in milestone order
      const layout = await page.evaluate(() =>
        [...document.querySelectorAll(".ledger tbody tr")].map((tr) =>
          tr.classList.contains("group") ? "G:" + tr.getAttribute("data-milestone-id") : tr.classList.contains("row") ? tr.getAttribute("data-row-id") : "empty"
        )
      );
      expect(layout).toEqual([
        "G:v1.0", "crdt-core", "websocket-gateway", "audit-log", "legacy-exporter",
        "G:v1.1", "auth-sso", "realtime-collab", "billing", "broken-dep",
        "G:v1.2", "offline-mode", "mobile-app", "notification-center",
        "G:v2.0", "empty",
        "G:backlog", "search-index",
      ]);
      const collab = page.locator('tr.row[data-row-id="realtime-collab"]');
      expect(await collab.locator("td").allTextContents()).toEqual([
        "in progress",
        "Real-time collaborative editing with live presence, inline comment threads, and conflict-free merging across many simultaneous editors",
        "realtime-collab",
        "2/6",
        "Editor",
        "crdt-core, websocket-gateway, auth-sso",
        "aur-101aur-102+1",
        "Load run 1: 50 writers held, p95 grew to 240ms after 10 minutes.",
      ]);
      expect(await collab.locator(".row-open").getAttribute("title")).toContain("conflict-free merging");
      // status words never wrap
      const multiLine = await page.evaluate(() =>
        [...document.querySelectorAll(".ledger .status-word")].filter((el) => el.getClientRects().length > 1 || el.getBoundingClientRect().height > 24).length
      );
      expect(multiLine).toBe(0);
      await page.context().close();
      await handle!.stop();
      handle = null;

      const plain = join(tempDir, "plain");
      mkdirSync(plain);
      const svc = new RoadmapService(plain);
      svc.init({ name: "Plain", summary: "" });
      svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
      svc.addFeature({ id: "a", title: "A", milestone: "m1" });
      const p2 = await open(plain);
      expect(await p2.locator(".ledger thead th").allTextContents()).not.toContain("Issues");
    },
    BROWSER_TEST_TIMEOUT_MS
  );

  test(
    "distribution segments filter by status and clear on a second click; empty states name the filter",
    async () => {
      buildAurora(tempDir);
      const page = await open(tempDir);
      const legend = await page.locator(".dist-item").allTextContents();
      expect(legend).toEqual(["5 planned", "2 in progress", "3 shipped", "1 paused", "1 cut"]);
      await page.locator('.dist-seg[data-status="paused"]').click();
      expect(await page.locator("tr.row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-row-id")))).toEqual(["auth-sso"]);
      expect(await page.locator("#filter-status").inputValue()).toBe("paused");
      await page.locator('.dist-item[data-status="paused"]').click();
      expect(await page.locator("tr.row").count()).toBe(12);

      // Unfiltered empty milestone
      expect(await page.locator('tr.group[data-milestone-id="v2.0"] + tr.empty-row').textContent()).toBe("No features yet.");
      // Filtered to nothing: names the filter and offers a working reset
      await page.locator("#filter-search").fill("zzz-nothing");
      expect(await page.locator('[data-empty="filtered"] h2').textContent()).toBe('No features match search: "zzz-nothing".');
      await page.locator('[data-empty="filtered"] [data-action="reset-filters"]').click();
      expect(await page.locator("tr.row").count()).toBe(12);
      await page.context().close();
      await handle!.stop();
      handle = null;

      const empty = join(tempDir, "empty");
      mkdirSync(empty);
      new RoadmapService(empty).init({ name: "Empty", summary: "" });
      const p2 = await open(empty);
      expect(await p2.locator('[data-empty="none"] h2').textContent()).toBe("No features yet.");
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});

describeUi("web drawer", () => {
  test(
    "acknowledgments appear in the viewport at any scroll depth; failures stay until dismissed",
    async () => {
      const svc = buildAurora(tempDir);
      const page = await open(tempDir, 1440, 700);
      await page.locator('.row-open[data-feature-id="realtime-collab"]').click();
      await page.waitForSelector("#drawer-backdrop.open");
      // scroll the drawer to the bottom, then toggle the last criterion
      await page.locator("#drawer").evaluate((el) => (el.scrollTop = el.scrollHeight));
      const lastId = svc.load().features.find((f) => f.id === "realtime-collab")!.ship_criteria[5]!.id;
      await page.locator(`#drawer input[data-criterion-id="${lastId}"]`).scrollIntoViewIfNeeded();
      await page.locator(`#drawer input[data-criterion-id="${lastId}"]`).check();
      await page.waitForSelector(`#drawer [data-feedback="crit:${lastId}"].is-ok`);
      expect(await inViewport(page, `#drawer [data-feedback="crit:${lastId}"]`)).toBe(true);
      expect(svc.load().features.find((f) => f.id === "realtime-collab")!.ship_criteria[5]!.done).toBe(true);

      await page.locator("#drawer-note-input").scrollIntoViewIfNeeded();
      await page.locator("#drawer-note-input").fill("Logged from a scrolled drawer");
      await page.locator("#drawer-note-submit").click();
      await page.waitForSelector('#drawer [data-feedback="note"].is-ok');
      expect(await inViewport(page, '#drawer [data-feedback="note"]')).toBe(true);
      expect(await page.locator("#drawer").evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

      // A failed save stays next to its control, through re-renders, until dismissed.
      await page.route("**/api/features/realtime-collab/pulse", (r) =>
        r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "disk full" }) })
      );
      const firstId = svc.load().features.find((f) => f.id === "realtime-collab")!.ship_criteria[2]!.id;
      await page.locator(`#drawer input[data-criterion-id="${firstId}"]`).click();
      const err = `#drawer [data-feedback="crit:${firstId}"].is-err`;
      await page.waitForSelector(err);
      expect(await page.locator(err).textContent()).toContain("Couldn't save: disk full");
      expect(await inViewport(page, err)).toBe(true);
      svc.addFeatureNote("billing", "unrelated change triggers a live re-render");
      await page.waitForTimeout(2500);
      expect(await page.locator(err).count()).toBe(1);
      await page.locator(`${err} [data-dismiss]`).click();
      expect(await page.locator(err).count()).toBe(0);
    },
    BROWSER_TEST_TIMEOUT_MS
  );

  test(
    "edit freeze: notice, disabled controls, diagnostics link, recheck re-enables; a stale ROADMAP.md keeps editing on",
    async () => {
      const svc = buildAurora(tempDir, { withErrors: true });
      const page = await open(tempDir, 1440, 900, { noLiveReload: true });
      await page.locator('.row-open[data-feature-id="billing"]').click();
      const freeze = page.locator('#drawer [data-state="frozen"]');
      await freeze.waitFor();
      expect(await freeze.textContent()).toContain("Editing paused — 1 error");
      expect(await inViewport(page, '#drawer [data-state="frozen"]')).toBe(true);
      expect(await page.locator("#drawer [data-status-pill]").first().isDisabled()).toBe(true);
      expect(await page.locator("#drawer input[data-criterion-id]").first().isDisabled()).toBe(true);
      expect(await page.locator("#drawer-note-input").isDisabled()).toBe(true);

      await page.locator("#drawer-show-diagnostics").click();
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("drawer-diagnostics");
      expect(await page.locator("#drawer-diagnostics").textContent()).toContain("[MISSING_DEPENDENCY]");

      // Repair outside the dashboard (a repair write is allowed), then recheck.
      svc.updateFeature("broken-dep", { depends_on: [] });
      await page.locator("#drawer-recheck").click();
      await page.waitForFunction(() => !document.querySelector('#drawer [data-state="frozen"]'));
      expect(await page.locator("#drawer [data-status-pill]").first().isDisabled()).toBe(false);
      await page.context().close();

      writeFileSync(join(tempDir, "ROADMAP.md"), "# stale\n");
      const p2 = await open(tempDir);
      await p2.locator('.row-open[data-feature-id="billing"]').click();
      await p2.locator('#drawer [data-state="stale"]').waitFor();
      expect(await p2.locator('#drawer [data-state="frozen"]').count()).toBe(0);
      expect(await p2.locator("#drawer [data-status-pill]").first().isDisabled()).toBe(false);
    },
    BROWSER_TEST_TIMEOUT_MS
  );

  test(
    "ship confirm: also-mark, ship-anyway and cancel, each verified on disk",
    async () => {
      const svc = new RoadmapService(tempDir);
      svc.init({ name: "Ship", summary: "" });
      svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
      svc.addFeature({ id: "f", title: "Feature", milestone: "m1", status: "in-progress", ship_criteria: ["one", "two", "three"] });
      svc.checkFeatureCriterion("f", "1", true);
      const page = await open(tempDir, 1440, 900, { noLiveReload: true });
      const posts: string[] = [];
      page.on("request", (r) => { if (r.method() === "POST") posts.push(r.postData() ?? ""); });
      const feature = () => svc.load().features.find((x) => x.id === "f")!;
      await page.locator('.row-open[data-feature-id="f"]').click();

      // Cancel writes nothing
      await page.locator('#drawer [data-status-pill="shipped"]').click();
      expect(await page.locator('#drawer [data-state="ship-confirm"]').textContent()).toContain("2 criteria still open");
      expect(await page.locator("#ship-also").textContent()).toBe("Also mark 2 criteria done");
      await page.locator("#ship-cancel").click();
      expect(posts).toEqual([]);
      expect(feature().status).toBe("in-progress");

      // Ship anyway: shipped, criteria unchanged, warning present
      await page.locator('#drawer [data-status-pill="shipped"]').click();
      await page.locator("#ship-anyway").click();
      await page.waitForSelector('#drawer [data-feedback="status"].is-ok');
      expect(feature().status).toBe("shipped");
      expect(feature().ship_criteria.map((c) => c.done)).toEqual([true, false, false]);
      expect(svc.check().warnings.map((w) => w.code)).toContain("SHIPPED_WITH_OPEN_CRITERIA");

      // Also mark N done: one write sets shipped and every open criterion
      svc.updateFeature("f", { status: "in-progress" });
      await page.reload({ waitUntil: "domcontentloaded" });
      posts.length = 0;
      await page.locator('.row-open[data-feature-id="f"]').click();
      await page.locator('#drawer [data-status-pill="shipped"]').click();
      await page.locator("#ship-also").click();
      await page.waitForSelector('#drawer [data-feedback="status"].is-ok');
      expect(posts.length).toBe(1);
      expect(JSON.parse(posts[0]!)).toMatchObject({ status: "shipped" });
      expect(feature().status).toBe("shipped");
      expect(feature().ship_criteria.every((c) => c.done)).toBe(true);
    },
    BROWSER_TEST_TIMEOUT_MS
  );

  test(
    "Unblocks jumps; focus stays trapped, background inert and scroll-locked; focus returns; removal restores the page",
    async () => {
      const svc = buildAurora(tempDir);
      const page = await open(tempDir, 1440, 700);
      await page.locator('.row-open[data-feature-id="crdt-core"]').focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("#drawer-backdrop.open");
      const unblocks = await page.locator('#drawer [data-jump]').evaluateAll((els) => els.map((e) => e.getAttribute("data-jump")));
      expect(unblocks.sort()).toEqual(["audit-log", "auth-sso", "realtime-collab"]);
      expect(await page.evaluate(() => (document.getElementById("page") as HTMLElement & { inert: boolean }).inert)).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.getElementById("drawer")!.contains(document.activeElement))).toBe(true);
      }
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Shift+Tab");
        expect(await page.evaluate(() => document.getElementById("drawer")!.contains(document.activeElement))).toBe(true);
      }
      const before = await page.evaluate(() => window.scrollY);
      await page.mouse.move(100, 400);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);

      await page.locator('#drawer [data-jump="auth-sso"]').click();
      expect(await page.locator("#drawer-title").textContent()).toBe("Single Sign-On");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("drawer-backdrop")!.classList.contains("open"));
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-feature-id"))).toBe("crdt-core");
      expect(await page.evaluate(() => (document.getElementById("page") as HTMLElement & { inert: boolean }).inert)).toBe(false);

      // The open feature disappears: the drawer closes and the page is usable again.
      await page.locator('.row-open[data-feature-id="mobile-app"]').click();
      await page.waitForSelector("#drawer-backdrop.open");
      svc.removeFeature("mobile-app");
      await page.waitForFunction(() => !document.getElementById("drawer-backdrop")!.classList.contains("open"), null, { timeout: 15000 });
      expect(await page.evaluate(() => (document.getElementById("page") as HTMLElement & { inert: boolean }).inert)).toBe(false);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});

describeUi("web Activity", () => {
  test(
    "committed events on their days in order, Uncommitted first, windows, since last visit, entries open the drawer",
    async () => {
      const now = new Date();
      const { svc } = buildActivityRepo(tempDir, { anchor: now });
      svc.updateFeature("delta", { status: "in-progress" });
      const lastVisit = new Date(now.getTime() - 36 * 3_600_000).toISOString();
      const page = await open(tempDir, 1440, 900, { init: `try { localStorage.setItem("pp-last-visit:/", "${lastVisit}"); } catch {}` });
      await page.locator("#tab-activity").click();
      await page.waitForSelector(".day");

      const days = await page.locator(".day").evaluateAll((els) => els.map((e) => e.getAttribute("data-day")));
      const expectDay = (daysAgo: number, hours = 0) => formatDay(new Date(now.getTime() - daysAgo * 86_400_000 + hours * 3_600_000).toISOString());
      expect(days[0]).toBe("uncommitted");
      expect(await page.locator('.day[data-day="uncommitted"] .event').count()).toBe(1);
      expect(await page.locator('.day[data-day="uncommitted"] .event').textContent()).toContain("planned → in progress");
      const shippedDay = expectDay(2);
      expect(await page.locator(`.day[data-day="${shippedDay}"]`).textContent()).toContain("Beta");
      expect(await page.locator(`.day[data-day="${shippedDay}"]`).textContent()).toContain("in progress → shipped");
      // newest first, and the same-day change and its reversal both appear in order
      const gammaEvents = await page.locator('.event[data-event-feature="gamma"] .event-detail').allTextContents();
      expect(gammaEvents).toEqual(["paused → planned", "planned → paused"]);
      expect(await page.locator(".activity-head").textContent()).toContain("main");

      // Entries open the feature's drawer
      await page.locator('.event[data-event-feature="beta"]').first().click({ position: { x: 10, y: 8 } });
      await page.waitForSelector("#drawer-backdrop.open");
      expect(await page.locator("#drawer-title").textContent()).toBe("Beta");
      await page.keyboard.press("Escape");

      // 30 days reaches back past the baseline commit: every feature shows as added
      await page.locator('[data-window="30d"]').click();
      await page.waitForFunction(() => document.querySelectorAll(".event .event-kind").length > 0 && [...document.querySelectorAll(".event-kind")].some((e) => e.textContent === "added"));
      expect(await page.locator('.event-kind:text-is("added")').count()).toBe(4);

      // Since last visit uses the stored timestamp (36 hours ago): only the gamma flip-flop and uncommitted
      await page.locator('[data-window="last"]').click();
      await page.waitForFunction(
        () => ![...document.querySelectorAll(".event-kind")].some((e) => e.textContent === "added") && document.querySelectorAll(".event").length > 0
      );
      const lastFeatures = await page.locator(".event").evaluateAll((els) => els.map((e) => e.getAttribute("data-event-feature")));
      expect(lastFeatures.sort()).toEqual(["delta", "gamma", "gamma"]);
      expect(await page.locator(".activity-head").textContent()).toContain("since your last visit");

      // Filtered to nothing: names the filter with a reset
      await page.locator("#filter-search").fill("zzz");
      expect(await page.locator('[data-empty="filtered"] h2').textContent()).toBe('No changes match search: "zzz".');
    },
    BROWSER_TEST_TIMEOUT_MS
  );

  test(
    "no-git notes state, empty state and error state with Retry",
    async () => {
      buildAurora(tempDir);
      const page = await open(tempDir);
      await page.locator("#tab-activity").click();
      await page.locator('[data-state="no-git"]').waitFor();
      expect(await page.locator('[data-state="no-git"]').textContent()).toBe("Status and criteria changes need git history; showing notes.");
      expect(await page.locator('.event-kind:text-is("note")').count()).toBeGreaterThan(0);
      await page.context().close();

      const quiet = join(tempDir, "quiet");
      mkdirSync(quiet);
      const svc = new RoadmapService(quiet);
      svc.init({ name: "Quiet", summary: "" });
      svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
      svc.addFeature({ id: "a", title: "A", milestone: "m1" });
      await handle!.stop();
      handle = null;
      const p2 = await open(quiet);
      await p2.locator("#tab-activity").click();
      await p2.locator('[data-empty="none"]').waitFor();
      expect(await p2.locator('[data-empty="none"] h2').textContent()).toBe("No changes in the last 7 days.");

      await p2.route("**/api/activity**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"git exploded"}' }));
      await p2.locator('[data-window="30d"]').click();
      await p2.locator('[data-state="activity-error"]').waitFor();
      expect(await p2.locator('[data-state="activity-error"]').textContent()).toContain("git exploded");
      await p2.unroute("**/api/activity**");
      await p2.locator('[data-action="retry-activity"]').click();
      await p2.locator('[data-empty="none"]').waitFor();
      expect(await p2.locator('[data-empty="none"] h2').textContent()).toBe("No changes in the last 30 days.");
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});

describeUi("web Graph", () => {
  test(
    "fits on open and after filter changes at 1440 and 720 (30 features); nodes never wrap mid-word; click pins, second click opens, Esc releases",
    async () => {
      const svc = new RoadmapService(tempDir);
      svc.init({ name: "Graph", summary: "" });
      svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
      for (let i = 1; i <= 30; i++) {
        const id = `g${String(i).padStart(2, "0")}`;
        svc.addFeature({
          id,
          title: `Graph feature ${i} with a fairly descriptive title that needs clamping`,
          milestone: "m1",
          status: i % 3 === 0 ? "in-progress" : "planned",
          depends_on: i > 5 ? [`g${String(i - 5).padStart(2, "0")}`] : [],
        });
      }
      for (const [w, h] of [
        [1440, 900],
        [720, 900],
      ] as const) {
        const page = await open(tempDir, w, h);
        await page.locator("#tab-graph").click();
        await page.waitForSelector(".graph-node");
        const check = async () => {
          const vp = (await page.locator("#graph-viewport").boundingBox())!;
          const nodes = await page.locator(".graph-node").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
          for (const n of nodes) {
            expect(n.left).toBeGreaterThanOrEqual(vp.x - 1);
            expect(n.right).toBeLessThanOrEqual(vp.x + vp.width + 1);
            expect(n.top).toBeGreaterThanOrEqual(vp.y - 1);
            expect(n.bottom).toBeLessThanOrEqual(vp.y + vp.height + 1);
          }
          return nodes.length;
        };
        expect(await check()).toBe(30);
        await page.locator("#filter-status").selectOption("planned");
        await page.waitForFunction(() => document.querySelectorAll(".graph-node").length === 20);
        expect(await check()).toBe(20);
        await page.locator("#filter-status").selectOption("");
        await page.waitForFunction(() => document.querySelectorAll(".graph-node").length === 30);
        await page.context().close();
      }

      const page = await open(tempDir, 1440, 900);
      await page.locator("#tab-graph").click();
      await page.waitForSelector(".graph-node");
      const wraps = await page.evaluate(() =>
        [...document.querySelectorAll(".graph-node .status-word")].filter((el) => el.getClientRects().length > 1).length
      );
      expect(wraps).toBe(0);
      expect(await page.locator(".graph-node:not([title])").count()).toBe(0);

      const g06 = page.locator('.graph-node[data-feature-id="g06"]');
      await g06.click();
      expect(await g06.getAttribute("class")).toContain("is-pinned");
      await page.locator('.graph-node[data-feature-id="g30"]').hover();
      expect(await g06.getAttribute("class")).toContain("is-active");
      expect(await page.locator('.graph-node[data-feature-id="g01"]').getAttribute("class")).toContain("is-upstream");
      await g06.click();
      await page.waitForSelector("#drawer-backdrop.open");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("drawer-backdrop")!.classList.contains("open"));
      await page.keyboard.press("Escape");
      expect(await g06.getAttribute("class")).not.toContain("is-pinned");
      expect(await g06.getAttribute("class")).not.toContain("is-active");

      await page.locator("#filter-search").fill("nothing-matches");
      expect(await page.locator('[data-empty="filtered"] h2').textContent()).toBe('No features match search: "nothing-matches".');
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});

describeUi("web states and hub page", () => {
  test(
    "first-load failure shows the reason and Retry (no Loading/Checking text); the tab title names the project; theme toggle exposes aria-pressed",
    async () => {
      buildAurora(tempDir);
      handle = await startViewServer(tempDir, { port: 0, beadsClient: noBeads });
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
      const page = await (await browser.newContext()).newPage();
      await page.route("**/api/roadmap", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"store unreadable"}' }));
      await page.goto(handle.openUrl, { waitUntil: "domcontentloaded" });
      await page.locator('[data-state="load-error"]').waitFor();
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).toContain("store unreadable");
      expect(text).not.toMatch(/Loading|Checking/);
      expect(await page.locator("#health-badge").isHidden()).toBe(true);
      await page.unroute("**/api/roadmap");
      await page.locator("#retry-load").click();
      await page.waitForSelector("tr.row");
      expect(await page.title()).toBe("Aurora · Project Pulse");

      const before = await page.locator("#theme-toggle").getAttribute("aria-pressed");
      await page.locator("#theme-toggle").click();
      expect(await page.locator("#theme-toggle").getAttribute("aria-pressed")).not.toBe(before);
    },
    BROWSER_TEST_TIMEOUT_MS
  );

  test(
    "hub cards show warnings, tell same-name projects apart by path, bottom-align actions, and confirm Remove",
    async () => {
      const stateDir = join(tempDir, "hub-state");
      mkdirSync(stateDir);
      const mk = (dir: string, name: string, warn: boolean, summary: string) => {
        mkdirSync(dir, { recursive: true });
        const svc = new RoadmapService(dir);
        svc.init({ name, summary });
        svc.upsertMilestone({ id: "m1", title: "M1", status: "active" });
        svc.addFeature({ id: "a", title: "A", milestone: "m1", status: warn ? "shipped" : "planned", ship_criteria: ["x"] });
        return dir;
      };
      const one = mk(join(tempDir, "work", "app"), "App", true, "Short.");
      const two = mk(join(tempDir, "personal", "app"), "App", false, "A much longer summary that wraps onto several lines in the card so the action rows would not line up unless they are pinned to the bottom of each card.");
      hub = await startHubServer({ port: 0, stateDir });
      hub.registerProject(one);
      hub.registerProject(two);
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
      const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
      const posts: string[] = [];
      page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });
      await page.goto(hub.openUrl, { waitUntil: "networkidle" });
      await page.waitForSelector(".project-card");
      const cards = page.locator(".project-card");
      expect(await cards.count()).toBe(2);
      const pills = await page.locator(".project-card .pill").allTextContents();
      expect(pills.sort()).toEqual(["1 warning", "Check OK"]);
      const paths = await page.locator(".project-path").allTextContents();
      expect(new Set(paths).size).toBe(2);
      expect(paths.some((p) => p.includes("work"))).toBe(true);
      const bottoms = await page.locator(".project-actions").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
      expect(Math.abs(bottoms[0]! - bottoms[1]!)).toBeLessThanOrEqual(1);

      const first = cards.first();
      await first.locator(".btn-remove").click();
      expect(await first.locator(".remove-confirm").textContent()).toContain("only unregisters it from the hub");
      await first.locator("[data-cancel-remove]").click();
      expect(posts).toEqual([]);
      expect(await cards.count()).toBe(2);
      await first.locator(".btn-remove").click();
      await first.locator("[data-confirm-remove]").click();
      await page.waitForFunction(() => document.querySelectorAll(".project-card").length === 1);
      expect(posts.length).toBe(1);
      expect(existsSync(join(one, ".project-pulse", "config.yaml"))).toBe(true);
      expect(existsSync(join(two, ".project-pulse", "config.yaml"))).toBe(true);
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});
