import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

/**
 * Cross-process coordination for `.project-pulse/` mutations.
 *
 * The mutex is a `BEGIN IMMEDIATE` write transaction held open on a stable per-repo SQLite file
 * (`.project-pulse/.store-lock.sqlite`). SQLite enforces it with kernel file locks (POSIX fcntl /
 * LockFileEx), so a killed or crashed holder releases the lock automatically — there is no stale
 * lock to reclaim and the coordinate file is never unlinked or rewritten while held.
 *
 * The database file is a persistent, non-source coordination sidecar: it stores no user data,
 * `pp check`/`pp load` never scan it (they only read `milestones/`, `features/`, `ROADMAP.md`),
 * and repos should gitignore it alongside any other local tool state.
 */

export const STORE_LOCK_FILE_NAME = ".store-lock.sqlite";

/**
 * Default max time to wait for another process's write lock before failing with a retryable
 * conflict. Mutations hold the lock for milliseconds, so this only trips under heavy contention
 * or a wedged holder — it never blocks a command forever.
 */
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;

/**
 * Operational override for the wait bound (e.g. automation that prefers failing fast to
 * waiting); falls back to the default when unset or invalid. Clamped to a bounded integer
 * as required by `PRAGMA busy_timeout`.
 */
function lockTimeoutMs(): number {
  const raw = process.env.PP_LOCK_TIMEOUT_MS;
  const parsed = raw === undefined || raw === "" ? DEFAULT_LOCK_TIMEOUT_MS : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LOCK_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(parsed), 0), 2147483647);
}

/**
 * Thrown when a mutation could not take the store write lock in time. The on-disk store is
 * untouched, so callers may simply retry the whole operation.
 */
export class StoreConflictError extends Error {
  readonly code = "STORE_CONFLICT";
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "StoreConflictError";
  }
}

/** Active lock database paths held by this process, mapped to their open connection. */
const heldLocks = new Map<string, Database>();

function isBusyError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  return /database is locked/i.test((error as Error)?.message ?? "");
}

function openLockDb(dbPath: string, busyTimeoutMs: number): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  return db;
}

/**
 * Runs `fn` while holding the store write transaction for `pulseDir`: one bounded
 * `PRAGMA busy_timeout` plus `BEGIN IMMEDIATE`; a busy database maps to `StoreConflictError`.
 * Re-entrant within a process — nested synchronous callers just run `fn()` and the outermost
 * frame owns rollback and close.
 */
export function withStoreLock<T>(pulseDir: string, fn: () => T): T {
  const dbPath = join(pulseDir, STORE_LOCK_FILE_NAME);
  if (heldLocks.has(dbPath)) {
    return fn();
  }

  const busyTimeoutMs = lockTimeoutMs();
  const db = openLockDb(dbPath, busyTimeoutMs);
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    db.close();
    if (isBusyError(error)) {
      throw new StoreConflictError(
        `Another project-pulse process holds the project-pulse store write lock in ${dbPath} ` +
          `(waited ${busyTimeoutMs}ms). Retry the command (conflicts are safe to retry).`
      );
    }
    throw error;
  }

  heldLocks.set(dbPath, db);
  try {
    return fn();
  } finally {
    heldLocks.delete(dbPath);
    try {
      db.exec("ROLLBACK");
    } catch {
      // No writes were made under the lock; closing below releases the OS file lock regardless.
    }
    try {
      db.close();
    } catch {
      // Already closed.
    }
  }
}
