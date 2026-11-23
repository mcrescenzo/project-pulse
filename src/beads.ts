import type { BeadStatusInfo, Feature, ValidationIssue } from "./types";

export interface BeadsClient {
  resolveRefs(refs: string[], cwd: string): Promise<BeadStatusInfo[]>;
}

export interface CliBeadsClientOptions {
  bdBin?: string;
  timeoutMs?: number;
  batchSize?: number;
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
 * Read-only Beads (`bd`) resolver invoking batched `bd --readonly show <ids...> --json`.
 * Degrades cleanly if `bd` is absent, times out, or no `.beads` database is present.
 */
export class CliBeadsClient implements BeadsClient {
  private readonly bdBin: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;

  constructor(options: CliBeadsClientOptions = {}) {
    this.bdBin = options.bdBin ?? "bd";
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.batchSize = Math.max(1, options.batchSize ?? 50);
  }

  async resolveRefs(refs: string[], cwd: string): Promise<BeadStatusInfo[]> {
    const bdRefs = extractBeadRefs(refs);
    if (bdRefs.length === 0) return [];

    const uniqueIds = [...new Set(bdRefs.map((r) => r.id))];
    const resolvedById = new Map<string, Omit<BeadStatusInfo, "ref">>();

    for (let i = 0; i < uniqueIds.length; i += this.batchSize) {
      const chunk = uniqueIds.slice(i, i + this.batchSize);
      const batchResults = await this.fetchBatch(chunk, cwd);
      for (const [id, info] of batchResults) {
        resolvedById.set(id, info);
      }
    }

    return bdRefs.map(({ ref, id }) => {
      const info = resolvedById.get(id) ?? {
        id,
        available: false,
        found: false,
        error: `Missing Beads resolution result for '${id}'`,
      };
      return { ref, ...info };
    });
  }

  private markAll(
    ids: string[],
    factory: (id: string) => Omit<BeadStatusInfo, "ref">
  ): Map<string, Omit<BeadStatusInfo, "ref">> {
    const out = new Map<string, Omit<BeadStatusInfo, "ref">>();
    for (const id of ids) {
      out.set(id, factory(id));
    }
    return out;
  }

  private async fetchBatch(
    ids: string[],
    cwd: string
  ): Promise<Map<string, Omit<BeadStatusInfo, "ref">>> {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      // `--` ends option parsing so a ref like `bd:--foo` can never be interpreted as a bd flag.
      proc = Bun.spawn([this.bdBin, "--readonly", "show", "--json", "--", ...ids], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      return this.markAll(ids, (id) => ({
        id,
        available: false,
        found: false,
        error: `Failed to spawn ${this.bdBin}: ${(error as Error).message}`,
      }));
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
        return this.markAll(ids, (id) => ({
          id,
          available: false,
          found: false,
          error: `Timed out invoking ${this.bdBin} after ${this.timeoutMs}ms`,
        }));
      }

      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout.trim());
          const items = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object"
            ? [parsed]
            : null;
          if (!items) {
            return this.markAll(ids, (id) => ({
              id,
              available: true,
              found: false,
              error: `Empty JSON payload for '${id}'`,
            }));
          }

          const out = new Map<string, Omit<BeadStatusInfo, "ref">>();
          for (const raw of items) {
            if (!raw || typeof raw !== "object") continue;
            const obj = raw as Record<string, unknown>;
            const resolvedId =
              typeof obj.id === "string" && obj.id.trim()
                ? obj.id
                : ids.length === 1
                ? ids[0]!
                : "";
            if (!resolvedId) continue;
            out.set(resolvedId, {
              id: resolvedId,
              available: true,
              found: true,
              status: typeof obj.status === "string" ? obj.status : undefined,
              title: typeof obj.title === "string" ? obj.title : undefined,
            });
          }

          for (const id of ids) {
            if (!out.has(id)) {
              out.set(id, {
                id,
                available: true,
                found: false,
                error: `Beads issue '${id}' not found`,
              });
            }
          }
          return out;
        } catch (error) {
          return this.markAll(ids, (id) => ({
            id,
            available: false,
            found: false,
            error: `Invalid JSON from ${this.bdBin}: ${(error as Error).message}`,
          }));
        }
      }

      const combined = `${stdout}\n${stderr}`.trim();
      if (/no issues? found|not found/i.test(combined)) {
        return this.markAll(ids, (id) => ({
          id,
          available: true,
          found: false,
          error: `Beads issue '${id}' not found`,
        }));
      }

      return this.markAll(ids, (id) => ({
        id,
        available: false,
        found: false,
        error: combined || `${this.bdBin} exited with code ${code}`,
      }));
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
    // Own-key lookup (pp-f7m.29): a plain-object index keyed by feature id must never resolve a
    // legal id like 'constructor' or 'toString' to an inherited Object.prototype member.
    const infos = Object.hasOwn(resolvedMap, feature.id) ? resolvedMap[feature.id] : [];
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
