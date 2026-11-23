import pkg from "../package.json";
import { CliBeadsClient, type BeadsClient } from "./beads";
import { formatFeatureText, formatSummaryText, RoadmapService } from "./store";
import type { FeatureStatus, MilestoneStatus } from "./types";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export const MCP_TOOLS = [
  {
    name: "roadmap_summary",
    description:
      "Get a compact, token-budgeted overview of project milestones, feature statuses, ship criteria progress, and latest pulse notes.",
    inputSchema: {
      type: "object",
      properties: {
        milestone: { type: "string", description: "Optional milestone ID filter" },
        status: { type: "string", description: "Optional feature status filter" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "roadmap_show_feature",
    description:
      "Inspect full details of a single roadmap feature including description, ship criteria, dependencies, update log, and optional Beads statuses.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Feature ID" },
        beads: { type: "boolean", description: "Resolve live bd:* references (defaults to config)" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "roadmap_upsert_milestone",
    description:
      "Create or update a release milestone in .project-pulse/ and regenerate root ROADMAP.md.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Milestone slug ID (e.g. v0.1)" },
        title: { type: "string", description: "Human-readable milestone title" },
        order: { type: "number", description: "Sort order" },
        status: { type: "string", enum: ["planned", "active", "shipped", "archived"] },
        target: { type: "string", description: "Optional target date or label" },
        description: { type: "string", description: "Markdown description" },
      },
      required: ["id", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "roadmap_upsert_feature",
    description:
      "Create or update a high-level feature in .project-pulse/ and regenerate root ROADMAP.md.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Feature slug ID" },
        title: { type: "string", description: "Feature title" },
        milestone: { type: "string", description: "Target milestone ID" },
        status: {
          type: "string",
          enum: ["planned", "in-progress", "shipped", "paused", "cut"],
        },
        area: { type: "string", description: "Optional area/pillar tag" },
        order: { type: "number", description: "Sort order within milestone" },
        depends_on: {
          type: "array",
          items: { type: "string" },
          description: "Prerequisite feature IDs",
        },
        refs: {
          type: "array",
          items: { type: "string" },
          description: "External tracker refs (e.g. bd:pp-12, gh:#4)",
        },
        ship_criteria: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                  done: { type: "boolean" },
                },
                required: ["text"],
              },
            ],
          },
          description: "2-5 outcome-level ship criteria",
        },
        description: { type: "string", description: "Markdown description" },
      },
      required: ["id", "title", "milestone"],
      additionalProperties: false,
    },
  },
  {
    name: "roadmap_log_pulse",
    description:
      "Update a feature's status, check/uncheck ship criteria, and/or append a timestamped update note, regenerating ROADMAP.md.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Feature ID" },
        status: {
          type: "string",
          enum: ["planned", "in-progress", "shipped", "paused", "cut"],
        },
        check_criteria: {
          type: "array",
          items: { type: "string" },
          description: "Criterion IDs or 1-based indices to mark done",
        },
        uncheck_criteria: {
          type: "array",
          items: { type: "string" },
          description: "Criterion IDs or 1-based indices to mark undone",
        },
        note: { type: "string", description: "Timestamped progress note to append" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "roadmap_check",
    description:
      "Validate .project-pulse/ schema integrity, dependency DAG, ROADMAP.md freshness, and optional Beads drift.",
    inputSchema: {
      type: "object",
      properties: {
        beads: { type: "boolean", description: "Enable live read-only Beads drift checks" },
      },
      additionalProperties: false,
    },
  },
] as const;

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((v) => String(v)) : undefined;
}

/**
 * Thrown when tools/call names a tool the server does not advertise.
 * This is a protocol-level invalid-params condition (JSON-RPC error, no result),
 * unlike failures inside a known tool, which surface as tool errors (isError).
 */
class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Unknown MCP tool '${name}'`);
    this.name = "UnknownToolError";
  }
}

/**
 * Creates a pure JSON-RPC request handler for Project Pulse MCP tools.
 */
export function createMcpHandler(
  rootDir: string,
  beadsClient: BeadsClient = new CliBeadsClient()
): (req: JsonRpcRequest) => Promise<JsonRpcResponse | null> {
  const service = new RoadmapService(rootDir);

  async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "roadmap_summary": {
        const result = service.summary({
          milestone: asOptionalString(args.milestone),
          status: asOptionalString(args.status),
        });
        return {
          text: formatSummaryText(result),
          summary: result,
        };
      }

      case "roadmap_show_feature": {
        const id = asOptionalString(args.id);
        if (!id) throw new Error("Missing required argument 'id'");
        const result = await service.showFeature(id, {
          beads: asOptionalBoolean(args.beads),
          beadsClient,
        });
        return {
          text: formatFeatureText(result),
          ...result,
        };
      }

      case "roadmap_upsert_milestone": {
        const id = asOptionalString(args.id);
        const title = asOptionalString(args.title);
        if (!id || !title) throw new Error("Missing required arguments 'id' and 'title'");
        const res = service.upsertMilestone({
          id,
          title,
          order: asOptionalNumber(args.order),
          status: asOptionalString(args.status) as MilestoneStatus | undefined,
          target: asOptionalString(args.target),
          description: asOptionalString(args.description),
        });
        return {
          ok: true,
          milestone: res.entity,
          warnings: res.warnings,
          roadmapPath: res.roadmapPath,
        };
      }

      case "roadmap_upsert_feature": {
        const id = asOptionalString(args.id);
        const title = asOptionalString(args.title);
        const milestone = asOptionalString(args.milestone);
        if (!id || !title || !milestone) {
          throw new Error("Missing required arguments 'id', 'title', and 'milestone'");
        }
        const shipCriteria = Array.isArray(args.ship_criteria)
          ? (args.ship_criteria as Array<string | { id?: string; text: string; done?: boolean }>)
          : undefined;
        const res = service.upsertFeature({
          id,
          title,
          milestone,
          status: asOptionalString(args.status) as FeatureStatus | undefined,
          area: asOptionalString(args.area),
          order: asOptionalNumber(args.order),
          depends_on: asOptionalStringArray(args.depends_on),
          refs: asOptionalStringArray(args.refs),
          ship_criteria: shipCriteria,
          description: asOptionalString(args.description),
        });
        return {
          ok: true,
          feature: res.entity,
          warnings: res.warnings,
          roadmapPath: res.roadmapPath,
        };
      }

      case "roadmap_log_pulse": {
        const id = asOptionalString(args.id);
        if (!id) throw new Error("Missing required argument 'id'");
        const res = service.logFeaturePulse({
          id,
          status: asOptionalString(args.status) as FeatureStatus | undefined,
          check_criteria: asOptionalStringArray(args.check_criteria),
          uncheck_criteria: asOptionalStringArray(args.uncheck_criteria),
          note: asOptionalString(args.note),
        });
        return {
          ok: true,
          feature: res.entity,
          warnings: res.warnings,
          roadmapPath: res.roadmapPath,
        };
      }

      case "roadmap_check": {
        return await service.checkWithBeads({
          beads: asOptionalBoolean(args.beads) ?? false,
          beadsClient,
        });
      }

      default:
        throw new UnknownToolError(name);
    }
  }

  return async (req: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const isNotification = req.id === undefined || req.method.startsWith("notifications/");
    const reqId = req.id ?? null;

    if (isNotification && req.id === undefined) {
      return null;
    }

    try {
      switch (req.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id: reqId,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "project-pulse",
                version: pkg.version,
              },
            },
          };

        case "notifications/initialized":
          return null;

        case "ping":
          return {
            jsonrpc: "2.0",
            id: reqId,
            result: {},
          };

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id: reqId,
            result: {
              tools: MCP_TOOLS,
            },
          };

        case "tools/call": {
          const params = req.params ?? {};
          const toolName = asOptionalString(params.name);
          const toolArgs =
            params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
              ? (params.arguments as Record<string, unknown>)
              : {};

          if (!toolName) {
            return {
              jsonrpc: "2.0",
              id: reqId,
              error: {
                code: -32602,
                message: "Missing tool name in tools/call params",
              },
            };
          }

          try {
            const payload = await executeTool(toolName, toolArgs);
            return {
              jsonrpc: "2.0",
              id: reqId,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(payload, null, 2),
                  },
                ],
              },
            };
          } catch (toolError) {
            if (toolError instanceof UnknownToolError) {
              // Unknown tool name is a protocol-level invalid-params error:
              // JSON-RPC error response, no result (2024-11-05 contract).
              return {
                jsonrpc: "2.0",
                id: reqId,
                error: {
                  code: -32602,
                  message: toolError.message,
                },
              };
            }
            return {
              jsonrpc: "2.0",
              id: reqId,
              result: {
                content: [
                  {
                    type: "text",
                    text: (toolError as Error).message,
                  },
                ],
                isError: true,
              },
            };
          }
        }

        default:
          return {
            jsonrpc: "2.0",
            id: reqId,
            error: {
              code: -32601,
              message: `Method not found: ${req.method}`,
            },
          };
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: reqId,
        error: {
          code: -32603,
          message: (err as Error).message,
        },
      };
    }
  };
}

/**
 * Runs the newline-delimited JSON-RPC 2.0 MCP server over stdio until stdin closes.
 */
/** True when a parsed JSON-RPC message is an object with a string `method` and a valid optional id. */
export function isJsonRpcRequestShape(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const msg = value as { method?: unknown; id?: unknown };
  if (typeof msg.method !== "string") return false;
  return msg.id === undefined || msg.id === null || typeof msg.id === "string" || typeof msg.id === "number";
}

export async function runMcpServer(
  rootDir: string,
  beadsClient: BeadsClient = new CliBeadsClient()
): Promise<void> {
  const handle = createMcpHandler(rootDir, beadsClient);
  const decoder = new TextDecoder();
  let buffer = "";

  async function processLine(rawLine: string): Promise<void> {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (error) {
      const errorResp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${(error as Error).message}`,
        },
      };
      process.stdout.write(`${JSON.stringify(errorResp)}\n`);
      return;
    }

    if (!isJsonRpcRequestShape(parsed)) {
      const rawId = (parsed as { id?: unknown } | null)?.id;
      const errorResp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: typeof rawId === "string" || typeof rawId === "number" ? rawId : null,
        error: { code: -32600, message: "Invalid Request: expected a JSON-RPC object with a string 'method'" },
      };
      process.stdout.write(`${JSON.stringify(errorResp)}\n`);
      return;
    }

    let response: JsonRpcResponse | null;
    try {
      response = await handle(parsed);
    } catch (error) {
      response = {
        jsonrpc: "2.0",
        id: parsed.id ?? null,
        error: { code: -32603, message: `Internal error: ${(error as Error).message}` },
      };
    }
    if (response !== null) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      await processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processLine(buffer);
  }
}
