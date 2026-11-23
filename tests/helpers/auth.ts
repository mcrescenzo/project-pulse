/** Returns a fetch wrapper that authenticates to a Project Pulse dashboard/hub with its access token. */
export function authFetch(accessToken: string) {
  return async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("X-PP-Access-Token", accessToken);
    try {
      return await fetch(input, { ...init, headers });
    } catch {
      // A hub restart on this origin can leave a dead keep-alive socket in undici's pool
      // (UND_ERR_SOCKET); one fresh-connection retry distinguishes that transient from a real
      // failure. Streaming responses (SSE) are unaffected by the retry path.
      return await fetch(input, { ...init, headers });
    }
  };
}
