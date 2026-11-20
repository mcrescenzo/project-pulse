import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeadsClient } from "../src/beads";
import { RoadmapService } from "../src/store";
import { startViewServer, type ViewServerHandle } from "../src/view";

let tempDir: string;
let handle: ViewServerHandle | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-s4-"));
});

afterEach(() => {
  if (handle) {
    handle.stop();
    handle = null;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

async function readSseUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedEvent: string,
  timeoutMs = 3000
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
      setTimeout(() => resolve({ done: true }), Math.max(50, deadline - Date.now()))
    );
    const chunk = await Promise.race([reader.read(), timeoutPromise]);
    if (chunk.done || !chunk.value) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    if (buffer.includes(`event: ${expectedEvent}`)) {
      return buffer;
    }
  }
  return buffer;
}

describe("Slice 4: Live-Reloading Local Browser Dashboard (pp view)", () => {
  test("serves HTML dashboard and /api/roadmap JSON matching .project-pulse/", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Dashboard App", summary: "Interactive viewer test." });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1 Launch", status: "active", order: 10 });
    svc.addFeature({
      id: "web-ui",
      title: "Web UI",
      milestone: "v0.1",
      status: "in-progress",
      area: "UI",
      refs: ["bd:pp-99"],
      ship_criteria: ["Cards render", "Drawer toggles criteria"],
    });

    const beadsClient: BeadsClient = {
      async resolveRefs(refs) {
        return refs.map((ref) => ({
          ref,
          id: ref.slice(3),
          available: true,
          found: true,
          status: "in_progress",
          title: "Build dashboard",
        }));
      },
    };

    handle = startViewServer(tempDir, { port: 0, beadsClient });

    const htmlRes = await fetch(handle.url);
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("content-type")).toContain("text/html");
    const html = await htmlRes.text();
    expect(html).toContain("Project Pulse");
    expect(html).toContain("/api/roadmap");
    expect(html).toContain("/api/events");

    const apiRes = await fetch(`${handle.url}/api/roadmap`);
    expect(apiRes.status).toBe(200);
    const data = (await apiRes.json()) as {
      config: { project: { name: string } };
      milestones: Array<{ id: string }>;
      features: Array<{ id: string }>;
      beads: Record<string, Array<{ status: string }>>;
    };
    expect(data.config.project.name).toBe("Dashboard App");
    expect(data.milestones.map((m) => m.id)).toEqual(["v0.1"]);
    expect(data.features.map((f) => f.id)).toEqual(["web-ui"]);
    expect(data.beads["web-ui"]?.[0]?.status).toBe("in_progress");
  });

  test("quick-actions persist to .project-pulse/ and ROADMAP.md, and file changes broadcast SSE reload", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Quick Action App" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active" });
    svc.addFeature({
      id: "quick-edit",
      title: "Quick Edit",
      milestone: "v0.1",
      status: "planned",
      ship_criteria: ["Status changes", "Criteria toggle"],
    });

    handle = startViewServer(tempDir, { port: 0 });

    const sseRes = await fetch(`${handle.url}/api/events`);
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();

    // Quick-action 1: POST /api/features/:id/pulse updates status, criterion checkbox, and note
    const pulseRes = await fetch(`${handle.url}/api/features/quick-edit/pulse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "in-progress",
        toggleCriterionId: "1",
        done: true,
        note: "Updated from browser drawer",
      }),
    });
    expect(pulseRes.status).toBe(200);
    const pulseJson = (await pulseRes.json()) as {
      ok: boolean;
      feature: {
        status: string;
        ship_criteria: Array<{ done: boolean }>;
        updates: Array<{ note: string }>;
      };
    };
    expect(pulseJson.ok).toBe(true);
    expect(pulseJson.feature.status).toBe("in-progress");
    expect(pulseJson.feature.ship_criteria[0]!.done).toBe(true);
    expect(pulseJson.feature.updates[0]!.note).toBe("Updated from browser drawer");

    const sseOutput1 = await readSseUntilEvent(reader, "reload");
    expect(sseOutput1).toContain("event: reload");

    const roadmapMd = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(roadmapMd).toContain("**Status:** `in-progress`");
    expect(roadmapMd).toContain("- [x] Status changes");
    expect(roadmapMd).toContain("Updated from browser drawer");

    // External disk mutation inside .project-pulse/ triggers watcher SSE reload
    svc.addFeatureNote("quick-edit", "External CLI pulse update");
    const sseOutput2 = await readSseUntilEvent(reader, "reload");
    expect(sseOutput2).toContain("event: reload");

    await reader.cancel();
  });

  test("enforces localhost CSRF checks, rejects non-JSON / bad origins, and handles 404 and favicon", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "Security Demo" });
    svc.upsertMilestone({ id: "v0.1", title: "v0.1", status: "active" });
    svc.addFeature({ id: "safe-feat", title: "Safe Feature", milestone: "v0.1", status: "planned" });

    handle = startViewServer(tempDir, { port: 0 });
    const endpoint = `${handle.url}/api/features/safe-feat/pulse`;

    // Favicon returns 200 SVG without 404
    const faviconRes = await fetch(`${handle.url}/favicon.ico`);
    expect(faviconRes.status).toBe(200);
    expect(faviconRes.headers.get("content-type")).toContain("image/svg+xml");

    // Non-JSON Content-Type -> 415
    const textRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ status: "in-progress" }),
    });
    expect(textRes.status).toBe(415);

    // Cross-origin -> 403
    const crossOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ status: "in-progress" }),
    });
    expect(crossOrigin.status).toBe(403);

    // Null Origin -> 403
    const nullOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "null" },
      body: JSON.stringify({ status: "in-progress" }),
    });
    expect(nullOrigin.status).toBe(403);

    // Cross-site Sec-Fetch-Site -> 403
    const crossSite = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ status: "in-progress" }),
    });
    expect(crossSite.status).toBe(403);

    // Spoofed Host -> 403
    const badHost = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "evil.example:4310" },
      body: JSON.stringify({ status: "in-progress" }),
    });
    expect(badHost.status).toBe(403);

    // Same-origin localhost mutation succeeds
    const validRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${handle.port}`,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ status: "in-progress" }),
    });
    expect(validRes.status).toBe(200);

    // Unknown feature returns 404
    const notFoundRes = await fetch(`${handle.url}/api/features/does-not-exist/pulse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "shipped" }),
    });
    expect(notFoundRes.status).toBe(404);
  });
});
