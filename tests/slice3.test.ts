import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoadmapService } from "../src/store";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-s3-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Slice 3: Stdio MCP Server (pp mcp) & Agent Onboarding Snippet", () => {
  test("pp init --agents-snippet prints agent onboarding guidance", async () => {
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        join(import.meta.dir, "../src/cli.ts"),
        "init",
        "--root",
        tempDir,
        "--name",
        "MCP Repo",
        "--agents-snippet",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(0);
    expect(stdout).toContain("Never edit `ROADMAP.md`");
    expect(stdout).toContain("pp summary");
  });

  test("pp mcp handles initialize, tools/list, and all 6 tools/call operations over stdio JSON-RPC", async () => {
    const svc = new RoadmapService(tempDir);
    svc.init({ name: "MCP Test Project" });

    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "roadmap_upsert_milestone",
          arguments: { id: "v0.1", title: "v0.1 Foundation", order: 10, status: "active" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "roadmap_upsert_feature",
          arguments: {
            id: "mcp-api",
            title: "MCP API",
            milestone: "v0.1",
            status: "in-progress",
            area: "Agent",
            ship_criteria: ["Tools list works", "Mutations update ROADMAP.md"],
            description: "Stdio MCP server.",
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "roadmap_log_pulse",
          arguments: {
            id: "mcp-api",
            status: "shipped",
            check_criteria: ["1", "2"],
            note: "All 6 MCP tools verified",
          },
        },
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "roadmap_summary",
          arguments: { milestone: "v0.1" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "roadmap_show_feature",
          arguments: { id: "mcp-api", beads: false },
        },
      },
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "roadmap_check",
          arguments: { beads: false },
        },
      },
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "roadmap_show_feature",
          arguments: { id: "does-not-exist" },
        },
      },
    ];

    const stdinPayload = `${requests.map((r) => JSON.stringify(r)).join("\n")}\n`;
    const proc = Bun.spawn(
      [process.execPath, "run", join(import.meta.dir, "../src/cli.ts"), "mcp", "--root", tempDir],
      {
        stdin: new Blob([stdinPayload]),
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const responses = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    // Notification id-less message must produce no response -> 9 responses for ids 1..9
    expect(responses.length).toBe(9);
    expect(responses[0].result.serverInfo.name).toBe("project-pulse");

    const toolNames = responses[1].result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual([
      "roadmap_summary",
      "roadmap_show_feature",
      "roadmap_upsert_milestone",
      "roadmap_upsert_feature",
      "roadmap_log_pulse",
      "roadmap_check",
    ]);

    const logPulsePayload = JSON.parse(responses[4].result.content[0].text);
    expect(logPulsePayload.feature.status).toBe("shipped");
    expect(logPulsePayload.feature.ship_criteria.every((c: { done: boolean }) => c.done)).toBe(true);
    expect(logPulsePayload.feature.updates[0].note).toBe("All 6 MCP tools verified");

    const summaryPayload = JSON.parse(responses[5].result.content[0].text);
    expect(summaryPayload.summary.totals.shipped).toBe(1);

    const showPayload = JSON.parse(responses[6].result.content[0].text);
    expect(showPayload.feature.id).toBe("mcp-api");

    const checkPayload = JSON.parse(responses[7].result.content[0].text);
    expect(checkPayload.ok).toBe(true);

    // Invalid tool argument returns structured MCP isError without crashing server
    expect(responses[8].result.isError).toBe(true);
    expect(responses[8].result.content[0].text).toContain("does-not-exist");

    const roadmap = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(roadmap).toContain("## v0.1 Foundation (`v0.1`)");
    expect(roadmap).toContain("### MCP API (`mcp-api`)");
    expect(roadmap).toContain("All 6 MCP tools verified");

    // Updating an existing feature via roadmap_upsert_feature preserves prior pulse updates
    const { createMcpHandler } = await import("../src/mcp");
    const handler = createMcpHandler(tempDir);
    const upsertResp = await handler({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "roadmap_upsert_feature",
        arguments: {
          id: "mcp-api",
          title: "MCP API v2",
          milestone: "v0.1",
          description: "Updated description.",
        },
      },
    });
    const upsertPayload = JSON.parse(
      ((upsertResp?.result as { content: Array<{ text: string }> }).content[0]!).text
    );
    expect(upsertPayload.feature.title).toBe("MCP API v2");
    expect(upsertPayload.feature.updates.length).toBe(1);
    expect(upsertPayload.feature.updates[0].note).toBe("All 6 MCP tools verified");
  });
});
