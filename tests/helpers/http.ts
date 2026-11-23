import { request, type IncomingHttpHeaders } from "node:http";

export interface RawHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface RawRequestOptions {
  method?: string;
  body?: string;
}

/**
 * Sends a request through `node:http` instead of `fetch`: undici silently drops `Host` (a
 * forbidden header name in the Fetch spec), but the DNS-rebinding probes must send an attacker
 * Host verbatim. Works identically under Bun and Node.
 */
export function requestWithHeaders(
  url: string,
  options: RawRequestOptions & { headers: Record<string, string> }
): Promise<RawHttpResponse> {
  const { promise, resolve, reject } = Promise.withResolvers<RawHttpResponse>();
  const req = request(url, { method: options.method, headers: options.headers }, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () =>
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      })
    );
  });
  req.on("error", reject);
  req.end(options.body);
  return promise;
}
