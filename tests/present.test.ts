import { describe, expect, test } from "bun:test";
import {
  formatCriteria,
  formatDay,
  formatTimestamp,
  healthText,
  plural,
  PRESENT_CLIENT_JS,
  statusLabel,
  VIEW_LABELS,
} from "../src/present";

describe("present: shared labels and formats", () => {
  test("view labels", () => {
    expect(VIEW_LABELS).toEqual({ roadmap: "Roadmap", graph: "Graph", activity: "Activity" });
  });

  test("status labels keep the stored enum but display words", () => {
    expect(statusLabel("planned")).toBe("planned");
    expect(statusLabel("in-progress")).toBe("in progress");
    expect(statusLabel("in_progress")).toBe("in progress");
    expect(statusLabel("shipped")).toBe("shipped");
    expect(statusLabel("paused")).toBe("paused");
    expect(statusLabel("cut")).toBe("cut");
    expect(statusLabel("active")).toBe("active");
    expect(statusLabel("some-new_state")).toBe("some new state");
  });

  test("criteria count", () => {
    expect(formatCriteria(0, 3)).toBe("0/3 criteria");
    expect(formatCriteria(2, 2)).toBe("2/2 criteria");
    expect(formatCriteria(0, 0)).toBe("no criteria");
  });

  test("short local timestamp", () => {
    const now = new Date(2026, 10, 26, 9, 0);
    expect(formatTimestamp(new Date(2026, 10, 25, 18, 32).toISOString(), now)).toBe("Nov 25, 18:32");
    expect(formatTimestamp(new Date(2026, 0, 3, 7, 5).toISOString(), now)).toBe("Jan 3, 07:05");
    expect(formatTimestamp(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe("Dec 31 2025, 23:59");
    expect(formatTimestamp("", now)).toBe("");
    expect(formatTimestamp("not a date", now)).toBe("not a date");
  });

  test("day headings", () => {
    const now = new Date(2026, 10, 26, 9, 0);
    expect(formatDay(new Date(2026, 10, 26, 1, 0).toISOString(), now)).toBe("Today");
    expect(formatDay(new Date(2026, 10, 25, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(formatDay(new Date(2026, 10, 23, 12, 0).toISOString(), now)).toBe("Mon, Nov 23");
    expect(formatDay(new Date(2025, 10, 23, 12, 0).toISOString(), now)).toBe("Sun, Nov 23 2025");
  });

  test("health badge text", () => {
    expect(healthText(0, 0)).toBe("Check OK");
    expect(healthText(0, 1)).toBe("1 warning");
    expect(healthText(0, 3)).toBe("3 warnings");
    expect(healthText(1, 4)).toBe("1 error");
    expect(healthText(2, 0)).toBe("2 errors");
  });

  test("plural", () => {
    expect(plural(1, "feature")).toBe("1 feature");
    expect(plural(2, "feature")).toBe("2 features");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });

  test("the browser copy behaves exactly like the module", () => {
    const client = new Function(`${PRESENT_CLIENT_JS}; return PP_PRESENT;`)() as Record<string, any>;
    const now = new Date(2026, 10, 26, 9, 0);
    const iso = new Date(2026, 10, 25, 18, 32).toISOString();
    expect(client.VIEW_LABELS).toEqual(VIEW_LABELS);
    for (const s of ["planned", "in-progress", "shipped", "paused", "cut", "in_progress", "x-y"]) {
      expect(client.statusLabel(s)).toBe(statusLabel(s));
    }
    expect(client.formatCriteria(1, 4)).toBe(formatCriteria(1, 4));
    expect(client.formatCriteria(0, 0)).toBe(formatCriteria(0, 0));
    expect(client.formatTimestamp(iso, now)).toBe(formatTimestamp(iso, now));
    expect(client.formatDay(iso, now)).toBe(formatDay(iso, now));
    expect(client.healthText(2, 1)).toBe(healthText(2, 1));
    expect(client.plural(3, "entry", "entries")).toBe("3 entries");
  });
});
