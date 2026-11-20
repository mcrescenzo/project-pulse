import { join, resolve } from "node:path";
import type { BeadsClient } from "./beads";
import { buildDashboardHtml } from "./dashboard-html";
import { writeFileAtomic } from "./frontmatter";
import { RoadmapService } from "./store";
import { buildRoadmapViewPayload } from "./view";

export interface ExportHtmlOptions {
  outPath?: string;
  beads?: boolean;
  beadsClient?: BeadsClient;
}

export interface ExportHtmlResult {
  html: string;
  outPath: string | null;
  bytes: number;
}

/**
 * Exports a deterministic, zero-network self-contained HTML roadmap snapshot from `.project-pulse/`.
 */
export async function exportStaticHtml(
  rootDir: string,
  options: ExportHtmlOptions = {}
): Promise<ExportHtmlResult> {
  const service = new RoadmapService(rootDir);
  service.requireInitialized();

  const payload = await buildRoadmapViewPayload(service, {
    beads: options.beads ?? false,
    beadsClient: options.beadsClient,
  });

  const html = buildDashboardHtml({
    mode: "static",
    embeddedData: payload,
  });
  const bytes = Buffer.byteLength(html, "utf8");

  if (options.outPath === "-") {
    return { html, outPath: null, bytes };
  }

  const targetPath = options.outPath
    ? resolve(service.rootDir, options.outPath)
    : join(service.rootDir, "roadmap.html");

  writeFileAtomic(targetPath, html);
  return { html, outPath: targetPath, bytes };
}
