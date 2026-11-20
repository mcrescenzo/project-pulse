import type { BeadStatusInfo, Feature, ValidationIssue } from "./types";

export interface BeadsClient {
  resolveRefs(refs: string[], cwd: string): Promise<BeadStatusInfo[]>;
}

export interface CliBeadsClientOptions {
  bdBin?: string;
  timeoutMs?: number;
}

/**
 * Extracts `bd:<id>` references from a feature's `refs` list.
 */
export function extractBeadRefs(refs: string[]): Array<{ ref: string; id: string }> {
  const result: Array<{ ref: string; id: string }> = [];
  for (const ref of refs) {
    if (ref.startsWith("bd:")) {
      const id = ref.slice(3).trim();
      if (id) {
        result.push({ ref, id });
      }
    }
  }
  return result;
}

/**
 * Read-only Beads (`bd`) resolver invoking `bd --readonly show <id> --json`.
 * Degrades cleanly if `bd` is absent, times out, or no `.beads` database is present.
 */
export class CliBeadsClient implements BeadsClient {
  private readonly bdBin: string;
  private readonly timeoutMs: number;

  constructor(options: CliBeadsClientOptions = {}) {
    this.bdBin = options.bdBin ?? "bd";
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async resolveRefs(refs: string[], cwd: string): Promise<BeadStatusInfo[]> {
    const bdRefs = extractBeadRefs(refs);
    if (bdRefs.length === 0) return [];

    const cache = new Map<string, Omit<BeadStatusInfo, "ref">>();
    const results: BeadStatusInfo[] = [];

    for (const { ref, id } of bdRefs) {
      let cached = cache.get(id);
      if (!cached) {
        cached = await this.fetchSingle(id, cwd);
        cache.set(id, cached);
      }
      results.push({ ref, ...cached });
    }

    return results;
  }

  private async fetchSingle(id: string, cwd: string): Promise<Omit<BeadStatusInfo, "ref">> {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([this.bdBin, "--readonly", "show", id, "--json"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      return {
        id,
        available: false,
        found: false,
        error: `Failed to spawn ${this.bdBin}: ${(error as Error).message}`,
      };
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        // Ignore kill error if already exited
      }
    }, this.timeoutMs);

    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
        proc.exited,
      ]);

      if (timedOut) {
        return {
          id,
          available: false,
          found: false,
          error: `Timed out invoking ${this.bdBin} after ${this.timeoutMs}ms`,
        };
      }

      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout.trim());
          const item = Array.isArray(parsed) ? parsed[0] : parsed;
          if (!item || typeof item !== "object") {
            return {
              id,
              available: true,
              found: false,
              error: `Empty JSON payload for '${id}'`,
            };
          }
          const obj = item as Record<string, unknown>;
          return {
            id: typeof obj.id === "string" ? obj.id : id,
            available: true,
            found: true,
            status: typeof obj.status === "string" ? obj.status : undefined,
            title: typeof obj.title === "string" ? obj.title : undefined,
          };
        } catch (error) {
          return {
            id,
            available: false,
            found: false,
            error: `Invalid JSON from ${this.bdBin}: ${(error as Error).message}`,
          };
        }
      }

      const combined = `${stdout}\n${stderr}`.trim();
      if (/no issues? found|not found/i.test(combined)) {
        return {
          id,
          available: true,
          found: false,
          error: `Beads issue '${id}' not found`,
        };
      }

      return {
        id,
        available: false,
        found: false,
        error: combined || `${this.bdBin} exited with code ${code}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Evaluates drift between roadmap feature status and linked `bd:*` issue states.
 */
export function evaluateBeadsDrift(
  features: Feature[],
  resolvedMap: Record<string, BeadStatusInfo[]>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let unavailableNoted = false;

  for (const feature of features) {
    const infos = resolvedMap[feature.id] ?? [];
    if (infos.length === 0) continue;

    for (const info of infos) {
      if (!info.available) {
        if (!unavailableNoted) {
          unavailableNoted = true;
          issues.push({
            level: "warning",
            code: "BEADS_UNAVAILABLE",
            entityId: feature.id,
            message: `Beads resolution unavailable (${info.error ?? "bd unreachable"}); skipping live drift checks`,
          });
        }
        continue;
      }

      if (!info.found) {
        issues.push({
          level: "error",
          code: "BEADS_REF_NOT_FOUND",
          entityId: feature.id,
          message: `Feature '${feature.id}' references '${info.ref}', which was not found in Beads`,
        });
      }
    }

    const foundInfos = infos.filter((i) => i.available && i.found);
    if (foundInfos.length === 0) continue;

    const allClosed = foundInfos.every((i) => i.status === "closed");
    const openRefs = foundInfos.filter((i) => i.status !== "closed");
    const allOpenUntouched = foundInfos.every((i) => i.status === "open");

    if ((feature.status === "planned" || feature.status === "in-progress") && allClosed) {
      issues.push({
        level: "error",
        code: "BEADS_DRIFT_ALL_CLOSED",
        entityId: feature.id,
        message: `Feature '${feature.id}' is '${feature.status}', but all linked Beads issues (${foundInfos
          .map((i) => i.id)
          .join(", ")}) are closed`,
      });
    } else if (feature.status === "shipped" && openRefs.length > 0) {
      issues.push({
        level: "error",
        code: "BEADS_DRIFT_UNCLOSED_SHIPPED",
        entityId: feature.id,
        message: `Feature '${feature.id}' is 'shipped', but linked Beads issues remain non-closed: ${openRefs
          .map((i) => `${i.id} (${i.status ?? "unknown"})`)
          .join(", ")}`,
      });
    } else if (feature.status === "in-progress" && allOpenUntouched) {
      issues.push({
        level: "warning",
        code: "BEADS_DRIFT_UNSTARTED",
        entityId: feature.id,
        message: `Feature '${feature.id}' is 'in-progress', while all linked Beads issues (${foundInfos
          .map((i) => i.id)
          .join(", ")}) are still 'open'`,
      });
    }
  }

  return issues;
}
