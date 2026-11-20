/** Polls `predicate` until it returns true or `timeoutMs` elapses; throws with `label` on timeout. */
export async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5000,
  intervalMs = 20
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (predicate()) return;
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}
