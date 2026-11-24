import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHandler } from "../src/mcp";
import { RoadmapService } from "../src/store";
import { expectQuietStderr, runCliCaptured } from "./helpers/cli";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-pulse-s3-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Slice 3: Stdio MCP Server (pp mcp) & Agent Onboarding Snippet", () => {
  test("pp init --agents-snippet prints agent onboarding guidance", async () => {
    const { code, stdout } = await runCliCaptured([
      "init",
      "--root",
      tempDir,
      "--name",
      "MCP Repo",
      "--agents-snippet",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Never edit `ROADMAP.md`");
    expect(stdout).toContain("pp summary");
    expect(existsSync(join(tempDir, "AGENTS.md"))).toBe(false);
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
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "roadmap_nonexistent",
          arguments: {},
        },
      },
    ];

    const stdinPayload = `${requests.map((r) => JSON.stringify(r)).join("\n")}\n`;
    const { stdout, stderr, code } = await runCliCaptured(["mcp", "--root", tempDir], {
      stdin: stdinPayload,
    });

    expectQuietStderr(stderr, "pp mcp");
    expect(code).toBe(0);

    const responses = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    // Notification id-less message must produce no response -> 10 responses for ids 1..10
    expect(responses.length).toBe(10);
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

    // Unknown tool name is protocol-level invalid params: JSON-RPC error, no result
    expect(responses[9].error).toBeDefined();
    expect(responses[9].error.code).toBe(-32602);
    expect(responses[9].error.message).toContain("roadmap_nonexistent");
    expect(responses[9].result).toBeUndefined();

    const roadmap = readFileSync(join(tempDir, "ROADMAP.md"), "utf8");
    expect(roadmap).toContain("## v0.1 Foundation (`v0.1`)");
    expect(roadmap).toContain("### MCP API (`mcp-api`)");
    expect(roadmap).toContain("All 6 MCP tools verified");

    // Updating an existing feature via roadmap_upsert_feature preserves prior pulse updates
    const handler = createMcpHandler(tempDir);
    const upsertResp = await handler({
      jsonrpc: "2.0",
      id: 20,
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
    const upsertResult = upsertResp?.result;
    if (!upsertResult || typeof upsertResult !== "object" || !("content" in upsertResult)) {
      throw new Error("roadmap_upsert_feature must return result.content");
    }
    const upsertContent = upsertResult.content as Array<{ text: string }>; // guarded above
    const upsertPayload = JSON.parse(upsertContent[0]!.text);
    expect(upsertPayload.feature.title).toBe("MCP API v2");
    expect(upsertPayload.feature.updates.length).toBe(1);
    expect(upsertPayload.feature.updates[0].note).toBe("All 6 MCP tools verified");

    // Handler-level: unknown tool name -> JSON-RPC invalid params, no result
    const unknownToolResp = await handler({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "roadmap_nonexistent", arguments: {} },
    });
    expect(unknownToolResp?.error).toBeDefined();
    expect(unknownToolResp?.error?.code).toBe(-32602);
    expect(unknownToolResp?.error?.message).toContain("roadmap_nonexistent");
    expect(unknownToolResp?.result).toBeUndefined();

    // Handler-level: missing tool name in params stays invalid params without a result
    const missingNameResp = await handler({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: { arguments: {} },
    });
    expect(missingNameResp?.error?.code).toBe(-32602);
    expect(missingNameResp?.result).toBeUndefined();

    // Handler-level: domain failure inside a known tool -> tool error, no JSON-RPC error
    const knownToolFailResp = await handler({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: { name: "roadmap_show_feature", arguments: { id: "does-not-exist" } },
    });
    expect(knownToolFailResp?.error).toBeUndefined();
    const failResult = knownToolFailResp?.result;
    if (!failResult || typeof failResult !== "object" || !("isError" in failResult)) {
      throw new Error("known-tool failure must return result.isError");
    }
    expect(failResult.isError).toBe(true);
  });
});
