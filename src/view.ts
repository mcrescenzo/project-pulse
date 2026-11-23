import { readdirSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CliBeadsClient, type BeadsClient } from "./beads";
import { buildDashboardHtml, FAVICON_SVG, type RoadmapViewPayload } from "./dashboard-html";
import { buildAllowedHosts, buildOpenUrl, forbiddenHostResponse, generateAccessToken, handleTokenLanding, isAccessAuthorized, isAllowedHost, redactPaths, unauthorizedResponse, withSecurityHeaders } from "./http-security";
import { startHttpServer } from "./http-server";
import { RoadmapService } from "./store";
import type { BeadStatusInfo, FeatureStatus } from "./types";

export interface ViewServerOptions {
  port?: number;
  hostname?: string;
  beadsClient?: BeadsClient;
  /** Access token required by the dashboard and API. Defaults to a fresh random token per server. */
  accessToken?: string;
}

export interface ViewServerHandle {
  port: number;
  /** Base URL (no token); requests to it require the access cookie or X-PP-Access-Token header. */
  url: string;
  /** URL to open in a browser: carries `?t=<token>` and is exchanged for an HttpOnly session cookie. */
  openUrl: string;
  accessToken: string;
  /** Closes the listener and all project slots; resolves once sockets are torn down. Idempotent. */
  stop: () => Promise<void>;
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

export { buildAllowedHosts };

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
    // Null prototype (pp-f7m.29): dashboard lookups like `beads[f.id]` must yield undefined —
    // not an inherited Object.prototype member — for legal feature ids such as 'constructor'.
    beads: check.beads ?? Object.create(null),
  };
}

/** A filesystem path a live client wants change notifications for. */
export interface LiveWatchPath {
  /** Absolute path; may reference a directory or a file. Symlinks are resolved for watching. */
  path: string;
  /** "dir" reports changes to the directory's direct children; "file" reports changes to the file. */
  type: "dir" | "file";
}

export interface LiveWatcherOptions {
  paths: LiveWatchPath[];
  /** Invoked synchronously for every relevant (non-ignored) change across `paths`. */
  onEvent: () => void;
  /** Directory-event filter. Defaults to skipping atomic-write staging files. */
  ignoreFilename?: (filename: string) => boolean;
}

export interface LiveWatcherHandle {
  close(): void;
}

/**
 * Atomic writes stage content in a sibling `.tmp.<pid>.<ts>.<rand>` file before renaming it over
 * the target. Staging files always START with ".tmp."; legal entity ids may merely CONTAIN it.
 */
export function isAtomicWriteStagingFile(filename: string): boolean {
  return filename.startsWith(".tmp.");
}

interface LiveDirWatch {
  watcher: FSWatcher;
  dev: number;
  ino: number;
  reactAll: boolean;
  names: Set<string>;
}

/**
 * Shared non-recursive live-change watcher for the dashboard server and the TUI.
 *
 * Only directories are watched; every project write is an atomic rename, which the parent
 * directory's watch reports. This keeps the helper correct when the filesystem moves under it:
 * - Paths that do not exist at startup are armed automatically once created, via a watch on
 *   their parent directory.
 * - Replaced directories (delete + recreate, or atomic rename-over producing a new inode)
 *   re-arm by comparing device/inode numbers on every rename event.
 * - Symlinked paths (and symlinked children of watched dirs, e.g. linked feature `.md` files or
 *   `config.yaml`) watch their resolved targets' parents, so an atomic write through the link
 *   that lands in another directory still raises events; name sets are re-derived on every
 *   reconcile pass, so repointed links re-arm against the new target and abandoned watchers
 *   are closed.
 */
export function startLiveWatcher(options: LiveWatcherOptions): LiveWatcherHandle {
  const ignoreFilename = options.ignoreFilename ?? isAtomicWriteStagingFile;
  const dirWatches = new Map<string, LiveDirWatch>();
  let closed = false;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  const safeStat = (p: string) => {
    try {
      return statSync(p);
    } catch {
      return null;
    }
  };
  const safeRealpath = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  const safeReadDir = (p: string) => {
    try {
      return readdirSync(p, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const closeWatcher = (watcher: FSWatcher) => {
    try {
      watcher.close();
    } catch {
      // Ignore watcher teardown errors (already closed, ENOENT, quota recovery).
    }
  };

  const scheduleReconcile = () => {
    if (closed || reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      reconcile();
    }, 50);
  };

  const handleDirEvent = (watchedPath: string, eventType: string, filename: unknown): void => {
    if (closed) return;
    const entry = dirWatches.get(watchedPath);
    if (!entry) return;
    const name = typeof filename === "string" && filename !== "" ? filename : null;
    let relevant: boolean;
    if (name === null) {
      // Coalesced/unnamed event: cannot rule the change out, so treat it as relevant.
      relevant = true;
    } else if (entry.reactAll) {
      relevant = !ignoreFilename(name);
    } else {
      relevant = entry.names.has(name);
    }
    if (eventType === "rename") scheduleReconcile();
    if (relevant) options.onEvent();
  };

  function reconcile(): void {
    if (closed) return;
    const desiredDirs = new Map<string, { reactAll: boolean; names: Set<string> }>();
    const addDir = (p: string, name?: string) => {
      const existing = desiredDirs.get(p);
      if (!existing) {
        desiredDirs.set(p, {
          reactAll: name === undefined,
          names: name === undefined ? new Set<string>() : new Set([name]),
        });
      } else if (name === undefined) {
        existing.reactAll = true;
      } else {
        existing.names.add(name);
      }
    };
    // A symlinked child file (linked .md, config.yaml) is written through its resolved target,
    // so its real parent directory must be watched for the resolved basename.
    const addDirSymlinkChildTargets = (dir: string) => {
      for (const child of safeReadDir(dir)) {
        if (!child.isSymbolicLink()) continue;
        const childPath = join(dir, child.name);
        const real = safeRealpath(childPath);
        if (!real || !safeStat(real)?.isFile()) continue;
        addDir(dirname(real), basename(real));
      }
    };

    for (const entry of options.paths) {
      // Watch the logical parent so creation, replacement, and symlink repointing of the path
      // itself are observed even before the path exists.
      addDir(dirname(entry.path), basename(entry.path));
      const real = safeRealpath(entry.path);
      if (!real) continue;
      const st = safeStat(real);
      if (entry.type === "dir" && st?.isDirectory()) {
        addDir(real); // direct children of the resolved dir (covers symlinked dirs)
        addDir(dirname(real), basename(real)); // replacement of the resolved dir itself
        addDirSymlinkChildTargets(real);
      } else if (entry.type === "file" && st?.isFile()) {
        addDir(dirname(real), basename(real)); // atomic replacement of the resolved file
      }
    }

    // Close watchers whose target vanished or was replaced by a different inode.
    for (const [p, w] of [...dirWatches]) {
      const st = desiredDirs.has(p) ? safeStat(p) : null;
      if (!st || st.dev !== w.dev || st.ino !== w.ino) {
        closeWatcher(w.watcher);
        dirWatches.delete(p);
      }
    }

    for (const [p, want] of desiredDirs) {
      const existing = dirWatches.get(p);
      if (existing) {
        // Same inode, but symlink children may have moved: refresh the name filter in place.
        existing.reactAll = want.reactAll;
        existing.names = want.names;
        continue;
      }
      const st = safeStat(p);
      if (!st?.isDirectory()) continue;
      try {
        const watcher = watch(p, { persistent: false }, (eventType, filename) => {
          handleDirEvent(p, eventType, filename);
        });
        watcher.on("error", () => {
          closeWatcher(watcher);
          dirWatches.delete(p);
          scheduleReconcile();
        });
        dirWatches.set(p, {
          watcher,
          dev: st.dev,
          ino: st.ino,
          reactAll: want.reactAll,
          names: want.names,
        });
      } catch {
        // Non-fatal if the OS watcher quota is exhausted; a later event re-arms it.
      }
    }
  }

  reconcile();

  return {
    close() {
      if (closed) return;
      closed = true;
      if (reconcileTimer) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      for (const w of dirWatches.values()) closeWatcher(w.watcher);
      dirWatches.clear();
    },
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

  // Watch only .project-pulse/ paths. (The TUI additionally watches the root ROADMAP.md file
  // so external renders clear ROADMAP_OUT_OF_SYNC without a manual refresh; reloads never
  // write these paths, so watching them creates no feedback loop.)
  const liveWatch = startLiveWatcher({
    paths: [
      { path: service.pulseDir, type: "dir" },
      { path: service.milestonesDir, type: "dir" },
      { path: service.featuresDir, type: "dir" },
    ],
    onEvent: scheduleBroadcast,
  });

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
        { ok: false, error: redactPaths((error as Error).message) },
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
      return Response.json({ ok: false, error: redactPaths(message) }, { status });
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    clearInterval(keepaliveTimer);
    liveWatch.close();
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
 * Resolves only once the listener is bound (dynamic port 0 resolved); a bind failure rejects.
 */
export async function startViewServer(
  rootDir: string,
  options: ViewServerOptions = {}
): Promise<ViewServerHandle> {
  const slot = createProjectSlot(rootDir, { beadsClient: options.beadsClient });
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? 4310;
  let boundPort = requestedPort;

  const dashboardHtml = buildDashboardHtml({ mode: "live" });
  const accessToken = options.accessToken ?? generateAccessToken();

  const route = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // DNS-rebinding defense: every route (reads included) must be addressed to a loopback host name.
    if (!isAllowedHost(req, boundPort, hostname)) {
      return forbiddenHostResponse();
    }

    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      return new Response(FAVICON_SVG, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const landing = handleTokenLanding(req, url, accessToken, boundPort);
    if (landing) return landing;

    if (!isAccessAuthorized(req, accessToken, boundPort)) {
      return unauthorizedResponse(url.pathname.startsWith("/api/") ? "json" : "html");
    }

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(dashboardHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
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
  };

  const http = await startHttpServer({
    hostname,
    port: requestedPort,
    handler: async (req) => withSecurityHeaders(await route(req)),
  });

  boundPort = http.port;
  const viewUrl = `http://${hostname}:${boundPort}`;

  const stop = async () => {
    slot.close();
    await http.stop();
  };

  return {
    port: boundPort,
    url: viewUrl,
    openUrl: buildOpenUrl(viewUrl, "/", accessToken),
    accessToken,
    stop,
  };
}
