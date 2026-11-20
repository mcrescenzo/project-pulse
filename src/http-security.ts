import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./frontmatter";

/** Query parameter carrying the access token on the URL printed/opened by `pp view`. */
export const ACCESS_TOKEN_QUERY_PARAM = "t";
/** Header accepted in place of the session cookie for programmatic API access. */
export const ACCESS_TOKEN_HEADER = "x-pp-access-token";
/** File (inside the Project Pulse state dir) holding the persistent dashboard access token. */
export const ACCESS_TOKEN_FILE = "access-token";

const ACCESS_TOKEN_RE = /^[0-9a-f]{64}$/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Headers applied to every dashboard/hub response (anti-framing, MIME sniffing, token-leak hardening). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function generateAccessToken(): string {
  return randomBytes(32).toString("hex");
}

/** Constant-time string comparison that tolerates length mismatch. */
export function tokensEqual(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Creates `dir` (and parents) restricted to the current user. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best-effort on platforms without POSIX modes
  }
}

/** Atomically writes a file that is created 0600 from the start (no world-readable window). */
export function writePrivateFile(filePath: string, content: string): void {
  writeFileAtomic(filePath, content, { mode: 0o600 });
}

/**
 * Loads the persistent dashboard access token from `<stateDir>/access-token`, creating it (0600) if absent.
 * A persistent token keeps bookmarked dashboard tabs working across `pp view` restarts.
 */
export function loadOrCreateAccessToken(stateDir: string): string {
  ensurePrivateDir(stateDir);
  const tokenPath = join(stateDir, ACCESS_TOKEN_FILE);
  if (existsSync(tokenPath)) {
    try {
      const existing = readFileSync(tokenPath, "utf8").trim();
      if (ACCESS_TOKEN_RE.test(existing)) return existing;
    } catch {
      // Fall through and regenerate an unreadable/corrupt token
    }
  }
  const token = generateAccessToken();
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    // Best-effort on platforms without POSIX modes
  }
  return token;
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

/** Rejects requests whose Host header is not a loopback name for this server (DNS-rebinding defense). */
export function isAllowedHost(req: Request, boundPort: number, hostname: string): boolean {
  const hostHeader = req.headers.get("host");
  if (hostHeader === null) return true;
  return buildAllowedHosts(boundPort, hostname).has(hostHeader.trim().toLowerCase());
}

export function accessCookieName(boundPort: number): string {
  return `pp_access_${boundPort}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** True when the request carries the access token via session cookie or `X-PP-Access-Token`. */
export function isAccessAuthorized(req: Request, accessToken: string, boundPort: number): boolean {
  return (
    tokensEqual(req.headers.get(ACCESS_TOKEN_HEADER), accessToken) ||
    tokensEqual(readCookie(req, accessCookieName(boundPort)), accessToken)
  );
}

/**
 * Handles `?t=<token>` landing URLs: on a valid token, sets the HttpOnly session cookie and redirects to the
 * same path without the token. Returns null when the URL carries no token parameter.
 */
export function handleTokenLanding(
  req: Request,
  url: URL,
  accessToken: string,
  boundPort: number
): Response | null {
  if (req.method !== "GET" || !url.searchParams.has(ACCESS_TOKEN_QUERY_PARAM)) return null;
  if (!tokensEqual(url.searchParams.get(ACCESS_TOKEN_QUERY_PARAM), accessToken)) {
    return unauthorizedResponse("html", "Invalid access token");
  }
  const clean = new URL(url.href);
  clean.searchParams.delete(ACCESS_TOKEN_QUERY_PARAM);
  const location = `${clean.pathname}${clean.search}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": `${accessCookieName(boundPort)}=${accessToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
      "Cache-Control": "no-store",
    },
  });
}

export function unauthorizedResponse(kind: "html" | "json", reason = "Unauthorized"): Response {
  if (kind === "json") {
    return Response.json({ ok: false, error: `${reason}: open the URL printed by 'pp view'` }, { status: 401 });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Project Pulse — access required</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Access required</h1>
<p>${reason}. This local dashboard requires an access token. Open the URL printed by <code>pp view</code>
(it ends in <code>?t=…</code>), or re-run <code>pp view</code> to open it automatically.</p>
</body></html>`;
  return new Response(html, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function forbiddenHostResponse(): Response {
  return Response.json({ ok: false, error: "Forbidden host header" }, { status: 403 });
}

/** Applies SECURITY_HEADERS to a response in place (or to a copy when headers are immutable). */
export function withSecurityHeaders(res: Response): Response {
  try {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(key, value);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

/** Builds a browser-openable URL that carries the access token for first-visit cookie exchange. */
export function buildOpenUrl(baseUrl: string, path: string, accessToken: string): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set(ACCESS_TOKEN_QUERY_PARAM, accessToken);
  return url.href;
}

/** True only for plain-http loopback URLs; used before handing a URL to the OS browser opener. */
export function isSafeLocalUrl(target: string): boolean {
  try {
    const url = new URL(target);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

/** Removes the user's home directory from error messages returned over HTTP. */
export function redactPaths(message: string): string {
  const home = homedir();
  if (!home || home === "/") return message;
  return message.split(home).join("~");
}
