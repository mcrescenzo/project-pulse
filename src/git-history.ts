/**
 * Read-only git helpers shared by `pp digest` and the Activity feed: run git, list the feature files
 * of a commit, and read many historical feature files with a single `git cat-file --batch` process.
 */
import { spawnSync } from "node:child_process";
import { parseMarkdownFile } from "./frontmatter";
import { FEATURES_DIR_NAME, PULSE_DIR_NAME } from "./store";
import type { Feature, FeatureStatus } from "./types";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runGit(args: string[], cwd: string, input?: string): GitResult {
  try {
    const proc = spawnSync("git", args, { cwd, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
    const stdout = (proc.stdout ?? "").trimEnd();
    const stderr = (proc.stderr ?? "").trimEnd();
    return { ok: proc.status === 0, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: "", stderr: (error as Error).message };
  }
}

/** Repository-root-relative path of the features directory, as git prints it for `rootDir`. */
export function featuresRelDir(): string {
  return `${PULSE_DIR_NAME}/${FEATURES_DIR_NAME}`;
}

/**
 * Feature files at `commit`: repository-root-relative path → blob id. `--full-name` matters when
 * `rootDir` is nested inside the repository (see pp digest history).
 */
export function listFeatureBlobs(commit: string, rootDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const tree = runGit(["ls-tree", "-r", "--full-name", commit, "--", featuresRelDir()], rootDir);
  if (!tree.ok || !tree.stdout.trim()) return out;
  for (const line of tree.stdout.split("\n")) {
    // "<mode> blob <sha>\t<path>"
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [, type, sha] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    if (type !== "blob" || !sha || !path.endsWith(".md") || path.includes("/.tmp.")) continue;
    out.set(path, sha);
  }
  return out;
}

/** Reads many blobs with one `git cat-file --batch`. Missing blobs are omitted. */
export function readBlobs(shas: Iterable<string>, rootDir: string): Map<string, string> {
  const unique = [...new Set(shas)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  let proc;
  try {
    proc = spawnSync("git", ["cat-file", "--batch"], {
      cwd: rootDir,
      input: unique.join("\n") + "\n",
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch {
    return out;
  }
  if (proc.status !== 0 || !proc.stdout) return out;
  const buf: Buffer = proc.stdout as Buffer;
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = buf.subarray(pos, nl).toString("utf8");
    pos = nl + 1;
    const parts = header.split(" ");
    if (parts[1] === "missing" || parts.length < 3) continue;
    const size = Number(parts[2]);
    out.set(parts[0]!, buf.subarray(pos, pos + size).toString("utf8"));
    pos += size + 1; // content plus the trailing newline
  }
  return out;
}

/** Parses a historical feature file leniently; returns null for unreadable content. */
export function parseHistoricalFeature(content: string, relPath: string): Feature | null {
  try {
    const parsed = parseMarkdownFile(content.trimEnd());
    const fm = parsed.frontmatter;
    const fallbackId = relPath.split("/").pop()!.slice(0, -3);
    const id = typeof fm.id === "string" && fm.id.trim() ? fm.id : fallbackId;
    const criteria = Array.isArray(fm.ship_criteria)
      ? fm.ship_criteria
          .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
          .map((c, idx) => ({
            id: typeof c.id === "string" ? c.id : `c-${idx + 1}`,
            text: typeof c.text === "string" ? c.text : "",
            done: Boolean(c.done),
          }))
      : [];
    const updates = Array.isArray(fm.updates)
      ? fm.updates
          .filter((u): u is Record<string, unknown> => Boolean(u && typeof u === "object"))
          .map((u) => ({
            at: typeof u.at === "string" ? u.at : "",
            note: typeof u.note === "string" ? u.note : "",
          }))
      : [];
    return {
      id,
      title: typeof fm.title === "string" ? fm.title : id,
      milestone: typeof fm.milestone === "string" ? fm.milestone : "",
      order: typeof fm.order === "number" ? fm.order : Number(fm.order ?? 100),
      status: (typeof fm.status === "string" ? fm.status : "planned") as FeatureStatus,
      area: typeof fm.area === "string" && fm.area ? fm.area : undefined,
      depends_on: Array.isArray(fm.depends_on) ? fm.depends_on.map(String) : [],
      refs: Array.isArray(fm.refs) ? fm.refs.map(String) : [],
      ship_criteria: criteria,
      updates,
      description: parsed.body,
    };
  } catch {
    return null;
  }
}

/** All features stored at `commit` (empty when the commit has none or cannot be read). */
export function loadFeaturesAtCommit(commit: string, rootDir: string): Map<string, Feature> {
  const blobs = listFeatureBlobs(commit, rootDir);
  const contents = readBlobs(blobs.values(), rootDir);
  const out = new Map<string, Feature>();
  for (const [path, sha] of blobs) {
    const content = contents.get(sha);
    if (content === undefined) continue;
    const feature = parseHistoricalFeature(content, path);
    if (feature) out.set(feature.id, feature);
  }
  return out;
}
