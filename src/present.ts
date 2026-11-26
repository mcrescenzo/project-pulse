/**
 * Presentation vocabulary shared by the web dashboard and the TUI: view names, display labels for
 * statuses, the criteria count, the short local timestamp and the health badge text.
 *
 * The formatters are self-contained (no references outside their own bodies) so the web dashboard
 * can embed their source verbatim via `PRESENT_CLIENT_JS` and both surfaces print identical text.
 */

export type ViewId = "roadmap" | "graph" | "activity";

export const VIEW_IDS: readonly ViewId[] = ["roadmap", "graph", "activity"];

export const VIEW_LABELS: Readonly<Record<ViewId, string>> = {
  roadmap: "Roadmap",
  graph: "Graph",
  activity: "Activity",
};

/** Display label for a feature or milestone status. The stored enum keeps its spelling (`in-progress`). */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    planned: "planned",
    "in-progress": "in progress",
    in_progress: "in progress",
    shipped: "shipped",
    paused: "paused",
    cut: "cut",
    active: "active",
    archived: "archived",
    backlog: "backlog",
    open: "open",
    closed: "closed",
    blocked: "blocked",
    deferred: "deferred",
  };
  const key = String(status ?? "");
  return labels[key] ?? key.replace(/[-_]+/g, " ");
}

/** "3/5 criteria", or "no criteria" when a feature has none. */
export function formatCriteria(done: number, total: number): string {
  if (!total) return "no criteria";
  return done + "/" + total + " criteria";
}

/**
 * Short local timestamp: "Nov 25, 18:32". The year is added ("Nov 25 2025, 18:32") when it differs
 * from `now`'s year. Unparseable input is returned unchanged.
 */
export function formatTimestamp(iso: string | null | undefined, now?: Date): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ref = now ?? new Date();
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  const year = date.getFullYear() === ref.getFullYear() ? "" : " " + date.getFullYear();
  return months[date.getMonth()] + " " + date.getDate() + year + ", " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/** Day heading for grouped lists: "Today", "Yesterday", or "Mon, Nov 24" (plus the year if not current). */
export function formatDay(iso: string, now?: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const ref = now ?? new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(ref) - startOf(date)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const year = date.getFullYear() === ref.getFullYear() ? "" : " " + date.getFullYear();
  return days[date.getDay()] + ", " + months[date.getMonth()] + " " + date.getDate() + year;
}

/** Health badge: errors take precedence over warnings. "Check OK", "1 warning", "2 errors". */
export function healthText(errorCount: number, warningCount: number): string {
  if (errorCount > 0) return errorCount + (errorCount === 1 ? " error" : " errors");
  if (warningCount > 0) return warningCount + (warningCount === 1 ? " warning" : " warnings");
  return "Check OK";
}

/** "1 feature" / "3 features". */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count + " " + (count === 1 ? singular : pluralForm ?? singular + "s");
}

/**
 * Browser source for the formatters above, embedded in the dashboard script so the web and TUI
 * share one implementation. Exposes `PP_PRESENT` with the same function names.
 */
export const PRESENT_CLIENT_JS = `
    const PP_PRESENT = {
      VIEW_LABELS: ${JSON.stringify(VIEW_LABELS)},
      statusLabel: ${statusLabel.toString()},
      formatCriteria: ${formatCriteria.toString()},
      formatTimestamp: ${formatTimestamp.toString()},
      formatDay: ${formatDay.toString()},
      healthText: ${healthText.toString()},
      plural: ${plural.toString()},
    };
`;
