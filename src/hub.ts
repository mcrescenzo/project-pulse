import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import pkg from "../package.json";
import type { BeadsClient } from "./beads";
import { buildDashboardHtml, buildPortfolioHtml, FAVICON_SVG } from "./dashboard-html";
import { writeFileAtomic } from "./frontmatter";
import { CONFIG_FILE_NAME, PULSE_DIR_NAME, RoadmapService } from "./store";
import { createProjectSlot, validateMutationRequest, type ProjectSlot } from "./view";

export interface RegisteredProjectRecord {
  slug: string;
  rootDir: string;
  name: string;
  registeredAt: string;
  lastSeenAt: string;
}

export interface ProjectsRegistryFile {
  version: 1;
  projects: RegisteredProjectRecord[];
}

export interface HubLockFile {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

export interface HubProjectSummary {
  slug: string;
  rootDir: string;
  name: string;
  summary: string;
  url: string;
  registeredAt: string;
  lastSeenAt: string;
  totals: {
    milestones: number;
    features: number;
    shipped: number;
    inProgress: number;
    planned: number;
    paused: number;
    cut: number;
  };
  check: {
    ok: boolean;
    errorCount: number;
    warningCount: number;
  };
}

export interface HubServerOptions {
  port?: number;
  hostname?: string;
  beadsClient?: BeadsClient;
  stateDir?: string;
  token?: string;
}

export interface HubServerHandle {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  url: string;
  stateDir: string;
  token: string;
  registerProject: (rootDir: string) => RegisteredProjectRecord;
  removeProject: (slug: string) => boolean;
  listProjects: () => HubProjectSummary[];
  stop: () => void;
}

export interface JoinOrStartHubOptions {
  port?: number;
  hostname?: string;
  beadsClient?: BeadsClient;
  stateDir?: string;
}

export type JoinOrStartHubResult =
  | {
      mode: "started";
      slug: string;
      port: number;
      url: string;
      handle: HubServerHandle;
    }
  | {
      mode: "joined";
      slug: string;
      port: number;
      url: string;
    };

export function resolveHubStateDir(stateDir?: string): string {
  return resolve(
    stateDir ?? process.env.PROJECT_PULSE_HOME ?? join(homedir(), ".config", "project-pulse")
  );
}

function canonicalRoot(rootDir: string): string {
  const abs = resolve(rootDir);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

function isRepoInitialized(rootDir: string): boolean {
  return existsSync(join(rootDir, PULSE_DIR_NAME, CONFIG_FILE_NAME));
}

function slugifyRepoName(rootDir: string, projectName?: string): string {
  const base = basename(rootDir) || projectName || "project";
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Starts the shared local multi-project hub server serving `/` portfolio and `/p/<slug>` dashboards.
 */
export function startHubServer(options: HubServerOptions = {}): HubServerHandle {
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? 4310;
  const stateDir = resolveHubStateDir(options.stateDir);
  const token = options.token ?? randomBytes(32).toString("hex");
  const hubJsonPath = join(stateDir, "hub.json");
  const projectsJsonPath = join(stateDir, "projects.json");

  const recordsBySlug = new Map<string, RegisteredProjectRecord>();
  const slotsBySlug = new Map<string, ProjectSlot>();

  const saveRegistry = () => {
    const file: ProjectsRegistryFile = {
      version: 1,
      projects: [...recordsBySlug.values()],
    };
    writeFileAtomic(projectsJsonPath, `${JSON.stringify(file, null, 2)}\n`);
  };

  const pruneStaleProjects = (): boolean => {
    let changed = false;
    for (const [slug, rec] of [...recordsBySlug.entries()]) {
      if (!isRepoInitialized(rec.rootDir)) {
        slotsBySlug.get(slug)?.close();
        slotsBySlug.delete(slug);
        recordsBySlug.delete(slug);
        changed = true;
      }
    }
    if (changed) {
      saveRegistry();
    }
    return changed;
  };

  const registerProject = (rootDir: string): RegisteredProjectRecord => {
    const canonical = canonicalRoot(rootDir);
    const service = new RoadmapService(canonical);
    service.requireInitialized();
    const config = service.loadConfig();
    const now = new Date().toISOString();

    pruneStaleProjects();

    // Return existing registration when canonical root matches
    for (const rec of recordsBySlug.values()) {
      if (canonicalRoot(rec.rootDir) === canonical) {
        rec.name = config.project.name || rec.name;
        rec.lastSeenAt = now;
        if (!slotsBySlug.has(rec.slug)) {
          slotsBySlug.set(
            rec.slug,
            createProjectSlot(canonical, { beadsClient: options.beadsClient })
          );
        }
        saveRegistry();
        return rec;
      }
    }

    const baseSlug = slugifyRepoName(canonical, config.project.name);
    let slug = baseSlug;
    let suffix = 2;
    while (recordsBySlug.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const slot = createProjectSlot(canonical, { beadsClient: options.beadsClient });
    const record: RegisteredProjectRecord = {
      slug,
      rootDir: canonical,
      name: config.project.name || basename(canonical),
      registeredAt: now,
      lastSeenAt: now,
    };

    recordsBySlug.set(slug, record);
    slotsBySlug.set(slug, slot);
    saveRegistry();
    return record;
  };

  const removeProject = (slug: string): boolean => {
    if (!recordsBySlug.has(slug)) return false;
    slotsBySlug.get(slug)?.close();
    slotsBySlug.delete(slug);
    recordsBySlug.delete(slug);
    saveRegistry();
    return true;
  };

  const listProjects = (): HubProjectSummary[] => {
    pruneStaleProjects();
    const items: HubProjectSummary[] = [];

    for (const [slug, rec] of [...recordsBySlug.entries()]) {
      const slot = slotsBySlug.get(slug);
      if (!slot) continue;
      try {
        const summary = slot.service.summary();
        const check = slot.service.check();
        items.push({
          slug,
          rootDir: rec.rootDir,
          name: summary.project.name || rec.name,
          summary: summary.project.summary,
          url: `/p/${encodeURIComponent(slug)}`,
          registeredAt: rec.registeredAt,
          lastSeenAt: rec.lastSeenAt,
          totals: summary.totals,
          check: {
            ok: check.ok,
            errorCount: check.errors.length,
            warningCount: check.warnings.length,
          },
        });
      } catch {
        // Degrade cleanly if config/files inside a registered repo are temporarily malformed
        const check = slot.service.check();
        items.push({
          slug,
          rootDir: rec.rootDir,
          name: rec.name,
          summary: "",
          url: `/p/${encodeURIComponent(slug)}`,
          registeredAt: rec.registeredAt,
          lastSeenAt: rec.lastSeenAt,
          totals: {
            milestones: 0,
            features: 0,
            shipped: 0,
            inProgress: 0,
            planned: 0,
            paused: 0,
            cut: 0,
          },
          check: {
            ok: check.ok,
            errorCount: check.errors.length,
            warningCount: check.warnings.length,
          },
        });
      }
    }

    return items.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  };

  // Rehydrate still-valid projects from projects.json
  const existingRegistry = readJsonFile<ProjectsRegistryFile>(projectsJsonPath);
  if (existingRegistry && Array.isArray(existingRegistry.projects)) {
    for (const entry of existingRegistry.projects) {
      if (!entry?.rootDir || !isRepoInitialized(entry.rootDir)) continue;
      const canonical = canonicalRoot(entry.rootDir);
      if ([...recordsBySlug.values()].some((r) => canonicalRoot(r.rootDir) === canonical)) continue;
      const slot = createProjectSlot(canonical, { beadsClient: options.beadsClient });
      let slug = entry.slug || slugifyRepoName(canonical, entry.name);
      let suffix = 2;
      while (recordsBySlug.has(slug)) {
        slug = `${slugifyRepoName(canonical, entry.name)}-${suffix}`;
        suffix++;
      }
      recordsBySlug.set(slug, {
        slug,
        rootDir: canonical,
        name: entry.name || basename(canonical),
        registeredAt: entry.registeredAt || new Date().toISOString(),
        lastSeenAt: entry.lastSeenAt || new Date().toISOString(),
      });
      slotsBySlug.set(slug, slot);
    }
    saveRegistry();
  }

  const portfolioHtml = buildPortfolioHtml();
  let boundPort = requestedPort;
  let stopped = false;

  const isTokenAuthorized = (req: Request): boolean | null => {
    const provided = req.headers.get("x-pp-hub-token");
    if (provided === null) return null;
    return provided === token;
  };

  const server = Bun.serve({
    hostname,
    port: requestedPort,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(portfolioHtml, {
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

      if (req.method === "GET" && url.pathname === "/api/hub/health") {
        pruneStaleProjects();
        return Response.json({
          ok: true,
          service: "project-pulse-hub",
          version: pkg.version,
          pid: process.pid,
          projectCount: slotsBySlug.size,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/hub/projects") {
        return Response.json({ projects: listProjects() });
      }

      if (req.method === "POST" && url.pathname === "/api/hub/register") {
        const tokenCheck = isTokenAuthorized(req);
        if (tokenCheck === null) {
          return Response.json(
            { ok: false, error: "Missing X-PP-Hub-Token header" },
            { status: 401 }
          );
        }
        if (!tokenCheck) {
          return Response.json(
            { ok: false, error: "Invalid X-PP-Hub-Token header" },
            { status: 403 }
          );
        }
        const securityFailure = validateMutationRequest(req, boundPort, hostname);
        if (securityFailure) {
          return Response.json(
            { ok: false, error: securityFailure.error },
            { status: securityFailure.status }
          );
        }
        try {
          const body = (await req.json()) as { rootDir?: string };
          if (!body?.rootDir || typeof body.rootDir !== "string") {
            return Response.json(
              { ok: false, error: "Missing string 'rootDir' in body" },
              { status: 400 }
            );
          }
          const rec = registerProject(body.rootDir);
          return Response.json({
            ok: true,
            slug: rec.slug,
            path: `/p/${encodeURIComponent(rec.slug)}`,
            url: `http://${hostname}:${boundPort}/p/${encodeURIComponent(rec.slug)}`,
          });
        } catch (error) {
          return Response.json({ ok: false, error: (error as Error).message }, { status: 400 });
        }
      }

      const removeMatch = url.pathname.match(/^\/api\/hub\/projects\/([^/]+)\/remove$/);
      if (req.method === "POST" && removeMatch) {
        const tokenCheck = isTokenAuthorized(req);
        if (tokenCheck === false) {
          return Response.json({ ok: false, error: "Invalid X-PP-Hub-Token" }, { status: 403 });
        }
        if (tokenCheck === null) {
          const securityFailure = validateMutationRequest(req, boundPort, hostname);
          if (securityFailure) {
            return Response.json(
              { ok: false, error: securityFailure.error },
              { status: securityFailure.status }
            );
          }
        }
        let slug: string;
        try {
          slug = decodeURIComponent(removeMatch[1]!);
        } catch {
          return Response.json({ ok: false, error: "Invalid slug encoding" }, { status: 400 });
        }
        const removed = removeProject(slug);
        if (!removed) {
          return Response.json({ ok: false, error: `Project '${slug}' not found` }, { status: 404 });
        }
        return Response.json({ ok: true, slug });
      }

      const projectMatch = url.pathname.match(/^\/p\/([^/]+)(\/.*)?$/);
      if (projectMatch) {
        let slug: string;
        try {
          slug = decodeURIComponent(projectMatch[1]!);
        } catch {
          return new Response("Bad Request", { status: 400 });
        }
        const subpath = projectMatch[2] ?? "/";
        const rec = recordsBySlug.get(slug);
        const slot = slotsBySlug.get(slug);
        if (!rec || !slot) {
          return new Response("Project not found in hub", { status: 404 });
        }
        if (!isRepoInitialized(rec.rootDir)) {
          pruneStaleProjects();
          return new Response("Project directory no longer exists", { status: 404 });
        }

        if (req.method === "GET" && (subpath === "" || subpath === "/")) {
          const html = buildDashboardHtml({
            mode: "live",
            apiBasePath: `/p/${encodeURIComponent(slug)}`,
            projectSwitcher: {
              currentSlug: slug,
              portfolioUrl: "/",
            },
          });
          return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        if (req.method === "GET" && subpath === "/api/roadmap") {
          return slot.handleRoadmap();
        }

        if (req.method === "GET" && subpath === "/api/events") {
          return slot.handleEvents();
        }

        const pulseMatch = subpath.match(/^\/api\/features\/([^/]+)\/pulse$/);
        if (req.method === "POST" && pulseMatch) {
          return slot.handlePulse(req, pulseMatch[1]!, boundPort, hostname);
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  boundPort = server.port ?? requestedPort;
  const hubLock: HubLockFile = {
    pid: process.pid,
    port: boundPort,
    token,
    startedAt: new Date().toISOString(),
  };
  writeFileAtomic(hubJsonPath, `${JSON.stringify(hubLock, null, 2)}\n`);
  try {
    chmodSync(hubJsonPath, 0o600);
  } catch {
    // Best-effort permission lock on platforms without POSIX modes
  }

  const hubUrl = `http://${hostname}:${boundPort}`;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const slot of slotsBySlug.values()) {
      slot.close();
    }
    slotsBySlug.clear();
    server.stop(true);
    const currentLock = readJsonFile<HubLockFile>(hubJsonPath);
    if (currentLock && currentLock.pid === process.pid && currentLock.token === token) {
      try {
        rmSync(hubJsonPath, { force: true });
      } catch {
        // Ignore cleanup failure
      }
    }
  };

  return {
    server,
    port: boundPort,
    url: hubUrl,
    stateDir,
    token,
    registerProject,
    removeProject,
    listProjects,
    stop,
  };
}

/**
 * Joins an existing local Project Pulse hub on `port` if running, or starts a new hub server.
 */
export async function joinOrStartHub(
  rootDir: string,
  options: JoinOrStartHubOptions = {}
): Promise<JoinOrStartHubResult> {
  const service = new RoadmapService(rootDir);
  service.requireInitialized();

  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 4310;
  const stateDir = resolveHubStateDir(options.stateDir);
  const hubBase = `http://${hostname}:${port}`;

  let healthRes: Response | null = null;
  try {
    healthRes = await fetch(`${hubBase}/api/hub/health`, {
      signal: AbortSignal.timeout(400),
    });
  } catch {
    healthRes = null;
  }

  if (healthRes) {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = (await healthRes.json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }

    if (!healthRes.ok || !payload || payload.service !== "project-pulse-hub") {
      throw new Error(
        `Port ${port} on ${hostname} is occupied by another service. Re-run with '--port <n>' or '--standalone --port <n>'.`
      );
    }

    const lockFile = readJsonFile<HubLockFile>(join(stateDir, "hub.json"));
    if (!lockFile?.token) {
      throw new Error(
        `Detected a running Project Pulse hub on ${hubBase}, but found no matching hub token in ${join(
          stateDir,
          "hub.json"
        )}. Re-run with '--standalone' or '--port <n>'.`
      );
    }

    const regRes = await fetch(`${hubBase}/api/hub/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PP-Hub-Token": lockFile.token,
      },
      body: JSON.stringify({ rootDir: service.rootDir }),
    });
    const regJson = (await regRes.json().catch(() => ({}))) as {
      ok?: boolean;
      slug?: string;
      url?: string;
      error?: string;
    };
    if (!regRes.ok || !regJson.slug || !regJson.url) {
      throw new Error(
        `Failed to register with running hub at ${hubBase}: ${regJson.error ?? `HTTP ${regRes.status}`}`
      );
    }

    return {
      mode: "joined",
      slug: regJson.slug,
      port,
      url: regJson.url,
    };
  }

  let handle: HubServerHandle;
  try {
    handle = startHubServer({
      port,
      hostname,
      beadsClient: options.beadsClient,
      stateDir,
    });
  } catch (error) {
    throw new Error(
      `Unable to start Project Pulse hub on ${hubBase}: ${(error as Error).message}. Try '--port <n>' or '--standalone'.`
    );
  }

  const record = handle.registerProject(service.rootDir);
  return {
    mode: "started",
    slug: record.slug,
    port: handle.port,
    url: `${handle.url}/p/${encodeURIComponent(record.slug)}`,
    handle,
  };
}
