/** Returns a fetch wrapper that authenticates to a Project Pulse dashboard/hub with its access token. */
export function authFetch(accessToken: string) {
  return (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("X-PP-Access-Token", accessToken);
    return fetch(input, { ...init, headers });
  };
}
