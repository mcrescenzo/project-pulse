import { existsSync, watch, type FSWatcher } from "node:fs";
import { CliBeadsClient, type BeadsClient } from "./beads";
import { buildDashboardHtml, FAVICON_SVG, type RoadmapViewPayload } from "./dashboard-html";
import { RoadmapService } from "./store";
import type { BeadStatusInfo, FeatureStatus } from "./types";

export interface ViewServerOptions {
  port?: number;
  hostname?: string;
  beadsClient?: BeadsClient;
}

export interface ViewServerHandle {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  url: string;
  stop: () => void;
}

export interface ProjectSlot {
  service: RoadmapService;
  rootDir: string;
  broadcastReload: (reason?: string) => void;
  getPayload: () => Promise<RoadmapViewPayload>;
  handleRoadmap: () => Promise<Response>;
  handleEvents: () => Response;
  handlePulse: (
    req: Request,
    featureIdRaw: string,
    boundPort: number,
    hostname: string
  ) => Promise<Response>;
  close: () => void;
}

export function buildAllowedHosts(boundPort: number, hostname: string): Set<string> {
  const hosts = new Set<string>([
    `127.0.0.1:${boundPort}`,
    `localhost:${boundPort}`,
    `[::1]:${boundPort}`,
    `${hostname.toLowerCase()}:${boundPort}`,
  ]);
  if (boundPort === 80) {
    hosts.add("127.0.0.1");
    hosts.add("localhost");
    hosts.add("[::1]");
    hosts.add(hostname.toLowerCase());
  }
  return hosts;
}

/**
 * Validates localhost Origin/Host/Sec-Fetch-Site/Content-Type headers on state-mutating endpoints.
 */
export function validateMutationRequest(
  req: Request,
  boundPort: number,
  hostname: string
): { status: number; error: string } | null {
  const contentType = (req.headers.get("content-type") ?? "").trim().toLowerCase();
  if (!(contentType === "application/json" || contentType.startsWith("application/json;"))) {
    return { status: 415, error: "Content-Type must be application/json" };
  }

  const allowedHosts = buildAllowedHosts(boundPort, hostname);

  const hostHeader = req.headers.get("host");
  if (hostHeader !== null && !allowedHosts.has(hostHeader.trim().toLowerCase())) {
    return { status: 403, error: "Forbidden host header for local dashboard mutation" };
  }

  const originHeader = req.headers.get("origin");
  if (originHeader !== null) {
    const trimmed = originHeader.trim();
    if (trimmed.toLowerCase() === "null") {
      return { status: 403, error: "Forbidden null origin" };
    }
    try {
      const originUrl = new URL(trimmed);
      if (originUrl.protocol !== "http:" || !allowedHosts.has(originUrl.host.toLowerCase())) {
        return { status: 403, error: "Forbidden cross-origin request" };
      }
    } catch {
      return { status: 403, error: "Invalid Origin header" };
    }
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    const site = secFetchSite.trim().toLowerCase();
    if (site !== "same-origin" && site !== "none") {
      return { status: 403, error: `Forbidden cross-site request (${secFetchSite})` };
    }
  }

  return null;
}

/**
 * Builds the JSON payload shared between `/api/roadmap` and static HTML export.
 */
export async function buildRoadmapViewPayload(
  service: RoadmapService,
  options: { beads?: boolean; beadsClient?: BeadsClient } = {}
): Promise<RoadmapViewPayload> {
  const loaded = service.load();
  const beads = options.beads ?? loaded.config.integrations.beads.enabled;
  const check = await service.checkWithBeads({
    beads,
    beadsClient: options.beadsClient,
    loaded,
  });

  const knownIds = new Set(loaded.milestones.map((m) => m.id));
  const defaultId = loaded.config.defaults.milestone;
  const milestones = [...loaded.milestones];
  if (
    !knownIds.has(defaultId) &&
    loaded.features.some((f) => f.milestone === defaultId)
  ) {
    milestones.push({
      id: defaultId,
      title: "Backlog",
      order: 9999,
      status: "planned",
      description: "Features queued without a specific release milestone.",
    });
  }

  return {
    config: loaded.config,
    milestones,
    features: loaded.features,
    check: {
      ok: check.ok,
      errors: check.errors,
      warnings: check.warnings,
    },
    beads: check.beads ?? {},
  };
}

/**
 * Creates an isolated watcher + SSE + API handler slot for a single Project Pulse repository.
 */
export function createProjectSlot(
  rootDir: string,
  options: { beadsClient?: BeadsClient } = {}
): ProjectSlot {
  const service = new RoadmapService(rootDir);
  service.requireInitialized();

  const beadsClient = options.beadsClient ?? new CliBeadsClient();
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const broadcastReload = (reason = "fs") => {
    if (closed) return;
    const payload = encoder.encode(
      `event: reload\ndata: ${JSON.stringify({ at: new Date().toISOString(), reason })}\n\n`
    );
    for (const controller of clients) {
      try {
        controller.enqueue(payload);
      } catch {
        clients.delete(controller);
      }
    }
  };

  const scheduleBroadcast = () => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcastReload("watch");
    }, 60);
  };

  // Watch only .project-pulse/ directories (never ROADMAP.md) to avoid feedback loops
  for (const dir of [service.pulseDir, service.milestonesDir, service.featuresDir]) {
    if (existsSync(dir)) {
      const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
        if (filename && String(filename).includes(".tmp.")) return;
        scheduleBroadcast();
      });
      watchers.push(watcher);
    }
  }

  const keepaliveTimer = setInterval(() => {
    const ping = encoder.encode(": ping\n\n");
    for (const controller of clients) {
      try {
        controller.enqueue(ping);
      } catch {
        clients.delete(controller);
      }
    }
  }, 25_000);

  const getPayload = async (): Promise<RoadmapViewPayload> =>
    buildRoadmapViewPayload(service, { beadsClient });

  const handleRoadmap = async (): Promise<Response> => {
    try {
      return Response.json(await getPayload());
    } catch (error) {
      return Response.json(
        { ok: false, error: (error as Error).message },
        { status: 500 }
      );
    }
  };

  const handleEvents = (): Response => {
    let clientController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        clientController = controller;
        clients.add(controller);
        controller.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel() {
        if (clientController) {
          clients.delete(clientController);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };

  const handlePulse = async (
    req: Request,
    featureIdRaw: string,
    boundPort: number,
    hostname: string
  ): Promise<Response> => {
    const securityFailure = validateMutationRequest(req, boundPort, hostname);
    if (securityFailure) {
      return Response.json(
        { ok: false, error: securityFailure.error },
        { status: securityFailure.status }
      );
    }

    let featureId: string;
    try {
      featureId = decodeURIComponent(featureIdRaw);
    } catch {
      return Response.json({ ok: false, error: "Invalid feature id encoding" }, { status: 400 });
    }

    let body: {
      status?: FeatureStatus;
      toggleCriterionId?: string;
      done?: boolean;
      note?: string;
    };
    try {
      const parsedBody = await req.json();
      if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        return Response.json(
          { ok: false, error: "Request body must be a JSON object" },
          { status: 400 }
        );
      }
      body = parsedBody as typeof body;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
    }

    try {
      const res = service.logFeaturePulse({
        id: featureId,
        status: body.status,
        toggleCriterionId: body.toggleCriterionId,
        done: body.done,
        note: body.note,
      });
      broadcastReload("api");
      return Response.json({
        ok: true,
        feature: res.entity,
        warnings: res.warnings,
      });
    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes("not found") ? 404 : 400;
      return Response.json({ ok: false, error: message }, { status });
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(keepaliveTimer);
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore watcher close failure
      }
    }
    for (const controller of clients) {
      try {
        controller.close();
      } catch {
        // Ignore already-closed stream
      }
    }
    clients.clear();
  };

  return {
    service,
    rootDir: service.rootDir,
    broadcastReload,
    getPayload,
    handleRoadmap,
    handleEvents,
    handlePulse,
    close,
  };
}

/**
 * Starts the live-reloading standalone local browser dashboard server (`pp view --standalone`).
 */
export function startViewServer(
  rootDir: string,
  options: ViewServerOptions = {}
): ViewServerHandle {
  const slot = createProjectSlot(rootDir, { beadsClient: options.beadsClient });
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? 4310;
  let boundPort = requestedPort;

  const dashboardHtml = buildDashboardHtml({ mode: "live" });

  const server = Bun.serve({
    hostname,
    port: requestedPort,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(dashboardHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        return new Response(FAVICON_SVG, {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/roadmap") {
        return slot.handleRoadmap();
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        return slot.handleEvents();
      }

      const pulseMatch = url.pathname.match(/^\/api\/features\/([^/]+)\/pulse$/);
      if (req.method === "POST" && pulseMatch) {
        return slot.handlePulse(req, pulseMatch[1]!, boundPort, hostname);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  boundPort = server.port ?? requestedPort;
  const viewUrl = `http://${hostname}:${boundPort}`;

  const stop = () => {
    slot.close();
    server.stop(true);
  };

  return {
    server,
    port: boundPort,
    url: viewUrl,
    stop,
  };
}
