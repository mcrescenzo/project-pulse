import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { withSecurityHeaders } from "./http-security";

/**
 * Runtime-agnostic HTTP transport for the dashboard/hub servers: adapts `node:http` (Node 24 and
 * Bun both implement it) to the Fetch `Request → Response` model the routing code already uses.
 * Replaces the Bun-only `Bun.serve` while preserving its observable behavior: idle socket timeout,
 * the 128 MiB request-body ceiling (declared or actual, including chunked bodies), streamed
 * request/response bodies with backpressure (SSE included), and `stop(true)` semantics where
 * lingering sockets cannot hold shutdown open.
 */

/** Default per-request body ceiling (bytes) — matches Bun.serve's default maxRequestBodySize. */
const DEFAULT_MAX_BODY_BYTES = 128 * 1024 * 1024;
/** Default socket idle timeout in seconds — matches Bun.serve `idleTimeout: 255` used by both servers. */
const DEFAULT_IDLE_TIMEOUT_SECONDS = 255;

export interface HttpServerOptions {
  hostname?: string;
  port?: number;
  handler: (req: Request) => Response | Promise<Response>;
  /** Per-request body ceiling (declared Content-Length or streamed bytes). */
  maxBodyBytes?: number;
  /** Idle socket timeout in seconds; an idle connection is destroyed after this long. */
  idleTimeoutSeconds?: number;
}

export interface HttpServerHandle {
  /** The actual bound port (resolves port 0). Available only after a successful bind. */
  port: number;
  /** Closes the listener, destroys lingering sockets (open SSE streams included), resolves on close. Idempotent. */
  stop(): Promise<void>;
}

export function startHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const idleTimeoutMs = (options.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS) * 1000;

  // The port reported in request URLs and the handle is the real bound port; it is only known
  // after `listening`, before which no request can arrive.
  let boundPort = requestedPort;

  const server = createServer((nodeReq, nodeRes) => {
    void handleFetch(nodeReq, nodeRes);
  });

  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    // Bun.serve(idleTimeout: 255) closed connections idle for 255s (the SSE keepalive ping at
    // 25s keeps live dashboards open); Node needs an explicit per-socket idle timeout.
    socket.setTimeout(idleTimeoutMs);
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });

  // Sockets with an in-flight response (SSE streams included). Idle keep-alive sockets are
  // closed with a clean FIN at shutdown so clients (undici pools) drop them gracefully;
  // only these active ones are aborted.
  const activeSockets = new Set<Socket>();
  server.on("request", (req, res) => {
    const socket = req.socket;
    activeSockets.add(socket);
    res.once("close", () => activeSockets.delete(socket));
    socket.on("close", () => activeSockets.delete(socket));
  });

  const { promise: listening, resolve: onListening, reject: onListenError } = Promise.withResolvers<void>();
  // Startup failures (EADDRINUSE above all) reject the returned promise; the caller never sees a
  // half-bound handle.
  server.once("error", onListenError);
  server.listen(requestedPort, hostname, onListening);

  return listening.then(() => {
    server.off("error", onListenError);
    boundPort = (server.address() as AddressInfo).port;

    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.once("close", onClosed);
    let stopCalled = false;

    return {
      port: boundPort,
      stop: async (): Promise<void> => {
        if (!stopCalled) {
          stopCalled = true;
          if (server.listening) {
            server.close();
            // Idle keep-alive sockets get a clean FIN (a client's next request transparently
            // opens a new connection); active responses (SSE included) are aborted so nothing
            // can hold shutdown open (Bun.serve stop(true) semantics).
            server.closeIdleConnections();
            for (const socket of activeSockets) socket.destroy();
          } else {
            onClosed();
          }
        }
        await closed;
      },
    };
  });

  /** Rewrites origin-form/absolute-form targets to a path+query under the trusted bound address. */
  function requestTargetPath(target: string | undefined): string | null {
    if (!target) return null;
    try {
      // Absolute-form (proxied) targets are reduced to their path so the server never follows an
      // off-host absolute request URI; the real incoming Host header stays in `headers` and is
      // what the app-level loopback host check inspects.
      const url = new URL(target, "http://project-pulse.invalid");
      return url.pathname + url.search;
    } catch {
      return null;
    }
  }

  function respondError(nodeRes: ServerResponse, status: number, message: string): void {
    if (nodeRes.headersSent || nodeRes.destroyed) return;
    const res = withSecurityHeaders(
      Response.json({ ok: false, error: message }, { status })
    );
    void sendFetchResponse(nodeRes, res);
  }

  async function sendFetchResponse(nodeRes: ServerResponse, response: Response): Promise<void> {
    if (nodeRes.destroyed) {
      response.body?.cancel();
      return;
    }
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of response.headers.entries()) {
      // Node manages framing itself; passing these through can throw or desync the stream.
      if (key === "transfer-encoding" || key === "connection" || key === "keep-alive") continue;
      if (key === "set-cookie") continue;
      headers[key] = value;
    }
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) headers["set-cookie"] = setCookies;

    const bodyless = response.body === null || response.status === 204 || response.status === 304;
    if (bodyless) {
      nodeRes.writeHead(response.status, response.statusText, headers);
      nodeRes.end();
      return;
    }
    nodeRes.writeHead(response.status, response.statusText, headers);
    nodeRes.flushHeaders();
    // Stream the response body with backpressure; a premature client close (e.g. an SSE
    // subscriber aborting) tears down the source and cancels the Fetch stream's reader.
    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>),
        nodeRes
      );
    } catch {
      // Client disconnected or socket errored mid-body; the socket close handler cleans up.
      nodeRes.destroy();
    }
  }

  async function handleFetch(nodeReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {
    // Declared-size gate: reject an over-limit Content-Length before the handler (and therefore
    // before any store mutation) ever runs.
    const declaredLength = Number.parseInt(String(nodeReq.headers["content-length"] ?? ""), 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      respondError(nodeRes, 413, "Request body too large");
      nodeReq.destroy();
      return;
    }

    const targetPath = requestTargetPath(nodeReq.url);
    if (targetPath === null) {
      respondError(nodeRes, 400, "Malformed request target");
      return;
    }

    const method = nodeReq.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";

    // Actual-size accounting for chunked/undeclared bodies: count bytes while relaying the
    // stream to the handler; a mid-stream violation surfaces as 413 after the handler settles.
    let actualBytes = 0;
    let bodyTooLarge = false;
    let reqBody: ReadableStream<Uint8Array> | undefined;
    if (hasBody) {
      reqBody = new ReadableStream<Uint8Array>({
        start(controller) {
          nodeReq.on("data", (chunk: Buffer) => {
            actualBytes += chunk.length;
            if (actualBytes > maxBodyBytes) {
              bodyTooLarge = true;
              nodeReq.pause();
              controller.error(new Error("request body too large"));
              return;
            }
            controller.enqueue(new Uint8Array(chunk));
          });
          nodeReq.on("end", () => controller.close());
          nodeReq.on("error", (error) => controller.error(error));
        },
        cancel() {
          nodeReq.destroy();
        },
      });
    }

    let request: Request;
    try {
      const headerInit: Record<string, string> = {};
      for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (value === undefined) continue;
        headerInit[key] = Array.isArray(value) ? value.join(", ") : value;
      }
      request = new Request(new URL(targetPath, `http://${hostname}:${boundPort}`), {
        method,
        headers: headerInit,
        body: reqBody,
        // Required by Fetch when a request carries a stream body (absent from RequestInit types).
        ...({ duplex: "half" } as RequestInit),
      });
    } catch {
      respondError(nodeRes, 400, "Bad request");
      return;
    }

    let handlerResponse: Response;
    try {
      handlerResponse = await options.handler(request);
    } catch {
      // Unexpected handler failure: sanitized status only — never tokens, paths, or stack traces.
      handlerResponse = withSecurityHeaders(
        new Response("Internal Server Error", { status: 500 })
      );
    }

    if (bodyTooLarge) {
      respondError(nodeRes, 413, "Request body too large");
      nodeReq.destroy();
      return;
    }

    await sendFetchResponse(nodeRes, handlerResponse);
  }
}
