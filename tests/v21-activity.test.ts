import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activityCacheKey, buildActivity, type ActivityEvent } from "../src/activity";
import { exportStaticHtml } from "../src/export";
import { RoadmapService } from "../src/store";
import { startViewServer, type ViewServerHandle } from "../src/view";
import { authFetch } from "./helpers/auth";
import { sleep } from "./helpers/cli";
import { buildActivityRepo } from "./fixtures/dashboard-fixtures";

let tempDir: string;
let handle: ViewServerHandle | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-v21-activity-"));
});

afterEach(async () => {
  await handle?.stop();
  handle = null;
  rmSync(tempDir, { recursive: true, force: true });
});

const brief = (e: ActivityEvent) => `${e.at ?? "uncommitted"} ${e.kind} ${e.featureId} ${e.detail}`;

describe("Activity event builder", () => {
  test("dates committed status, criteria, added and shipped events by their commits, with notes, newest first", () => {
    const { svc, now } = buildActivityRepo(tempDir);
    const result = buildActivity(svc, { since: "7d", now });
    expect(result.noGit).toBe(false);
    expect(result.branch).toBe("main");
    expect(result.uncommittedCount).toBe(0);
    expect(result.events.map(brief)).toEqual([
      "2026-11-22T15:00:00.000Z status-change gamma paused → planned",
      "2026-11-22T09:00:00.000Z status-change gamma planned → paused",
      "2026-11-21T12:00:00.000Z shipped beta in-progress → shipped",
      "2026-11-21T07:00:00.000Z note beta Ready to ship.",
      "2026-11-20T12:00:00.000Z feature-added delta added to m1",
      "2026-11-19T12:00:00.000Z criterion-done alpha First",
      "2026-11-19T08:00:00.000Z note alpha First criterion landed.",
      "2026-11-18T12:00:00.000Z status-change alpha planned → in-progress",
    ]);
    // the baseline commit is the state before the window, never an event itself
    expect(result.events.some((e) => e.featureId === "gamma" && e.kind === "feature-added")).toBe(false);
    const shipped = result.events.find((e) => e.kind === "shipped")!;
    expect(shipped).toMatchObject({ from: "in-progress", to: "shipped", uncommitted: false, title: "Beta", area: "UI" });
    expect(shipped.commit).toMatch(/^[0-9a-f]{7}$/);
  });

  test("narrower and wider windows", () => {
    const { svc, now } = buildActivityRepo(tempDir);
    const two = buildActivity(svc, { since: "2d", now });
    expect(two.events.every((e) => Date.parse(e.at!) >= Date.parse("2026-11-21T12:00:00Z"))).toBe(true);
    expect(two.events.map((e) => e.kind)).toEqual(["status-change", "status-change", "shipped"]);
    const month = buildActivity(svc, { since: "30d", now });
    // the whole history is inside a 30-day window, so the baseline is empty and everything was "added"
    expect(month.events.filter((e) => e.kind === "feature-added").map((e) => e.featureId).sort()).toEqual([
      "alpha",
      "beta",
      "delta",
      "gamma",
    ]);
    const byDate = buildActivity(svc, { since: "2026-11-20", now });
    expect(byDate.events.map((e) => e.featureId)).not.toContain("alpha");
  });

  test("uncommitted edits appear first, undated, and only status/criteria differences from HEAD", () => {
    const { svc, now } = buildActivityRepo(tempDir);
    svc.updateFeature("delta", { status: "in-progress" });
    svc.checkFeatureCriterion("alpha", "2", true);
    const result = buildActivity(svc, { since: "7d", now });
    expect(result.uncommittedCount).toBe(2);
    expect(result.events.slice(0, 2).map(brief).sort()).toEqual([
      "uncommitted criterion-done alpha Second",
      "uncommitted status-change delta planned → in-progress",
    ]);
    expect(result.events.slice(2).every((e) => !e.uncommitted)).toBe(true);
  });

  test("without git: notes only, with the noGit flag", () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "No git", summary: "" });
    svc.upsertMilestone({ id: "m1", title: "M1", status: "active", order: 10 });
    svc.addFeature({ id: "a", title: "A", milestone: "m1", status: "in-progress" });
    svc.logFeaturePulse({ id: "a", note: "recent", at: "2026-11-22T10:00:00.000Z" });
    svc.logFeaturePulse({ id: "a", note: "old", at: "2026-10-01T10:00:00.000Z" });
    const result = buildActivity(svc, { since: "7d", now: new Date("2026-11-23T12:00:00Z") });
    expect(result.noGit).toBe(true);
    expect(result.branch).toBeNull();
    expect(result.events.map(brief)).toEqual(["2026-11-22T10:00:00.000Z note a recent"]);
  });

  test("cache key changes with HEAD, the working tree and the window", () => {
    const { svc, now } = buildActivityRepo(tempDir);
    const k1 = activityCacheKey(svc, "7d", now);
    expect(activityCacheKey(svc, "7d", now)).toBe(k1);
    expect(activityCacheKey(svc, "30d", now)).not.toBe(k1);
    expect(activityCacheKey(svc, "7d", new Date(now.getTime() + 5 * 60_000))).not.toBe(k1);
    svc.logFeaturePulse({ id: "alpha", note: "working tree change" });
    expect(activityCacheKey(svc, "7d", now)).not.toBe(k1);
  });

  test("an unknown since value is rejected", () => {
    const { svc, now } = buildActivityRepo(tempDir);
    expect(() => buildActivity(svc, { since: "not-a-ref", now })).toThrow(/Unknown --since value/);
  });
});

describe("/api/activity", () => {
  test("requires the project token, honours since, and rejects bad input", async () => {
    buildActivityRepo(tempDir);
    handle = await startViewServer(tempDir, { port: 0, beadsClient: { resolveRefs: async () => [] } });
    const anon = await fetch(`${handle.url}/api/activity`);
    expect(anon.status).toBe(401);

    const get = authFetch(handle.accessToken);
    const res = await get(`${handle.url}/api/activity?since=2026-11-20`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.branch).toBe("main");
    expect(body.events.map((e: ActivityEvent) => e.featureId)).toContain("delta");
    expect(body.events.map((e: ActivityEvent) => e.featureId)).not.toContain("alpha");

    const again = await (await get(`${handle.url}/api/activity?since=2026-11-20`)).json();
    expect(again).toEqual(body);

    expect((await get(`${handle.url}/api/activity?since=${encodeURIComponent("<script>")}`)).status).toBe(400);
    expect((await get(`${handle.url}/api/activity?since=nope-ref`)).status).toBe(400);
  });
});

describe("static export activity", () => {
  test("embeds committed activity anchored to the history, so exports at different times are identical", async () => {
    buildActivityRepo(tempDir);
    const first = await exportStaticHtml(tempDir, { outPath: "-" });
    await sleep(1100);
    const second = await exportStaticHtml(tempDir, { outPath: "-" });
    expect(second.html).toBe(first.html);
    const json = first.html.match(/<script id="pp-embedded-data" type="application\/json">(.*?)<\/script>/s)![1]!;
    const data = JSON.parse(json);
    expect(data.activity.branch).toBe("main");
    expect(data.activity.events.some((e: ActivityEvent) => e.kind === "shipped" && e.featureId === "beta")).toBe(true);
    expect(data.activity.events.every((e: ActivityEvent) => !e.uncommitted)).toBe(true);
  });
});
