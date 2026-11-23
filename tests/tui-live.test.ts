import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeTerminalSession, type InputEvent, type TerminalSession } from "../src/tui/input";
import { writeFileAtomic } from "../src/frontmatter";
import type { BeadStatusInfo } from "../src/types";
import { createProjectSlot, type ProjectSlot } from "../src/view";
import { RoadmapService } from "../src/store";
import { runTui, TuiController } from "../src/tui/app";
import type { BeadsClient } from "../src/beads";
import type { ColorMode } from "../src/tui/screen";
import { waitFor } from "./helpers/wait";

class VirtualSession implements TerminalSession {
  width: number;
  height: number;
  colorMode: ColorMode = "truecolor";
  entered = false;
  writes: string[] = [];
  /** writes.length captured when leave() restored the terminal. */
  writesAtLeave = -1;
  private inputCbs = new Set<(ev: InputEvent) => void>();
  private resizeCbs = new Set<(w: number, h: number) => void>();
  private signalCbs = new Set<() => void>();

  constructor(width = 140, height = 40) {
    this.width = width;
    this.height = height;
  }

  enter(): void {
    this.entered = true;
  }

  leave(): void {
    this.entered = false;
    this.writesAtLeave = this.writes.length;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  setMouseMode(): void {}
  copyToClipboard(): void {}

  onInput(cb: (ev: InputEvent) => void): () => void {
    this.inputCbs.add(cb);
    return () => this.inputCbs.delete(cb);
  }

  onResize(cb: (w: number, h: number) => void): () => void {
    this.resizeCbs.add(cb);
    return () => this.resizeCbs.delete(cb);
  }

  onSignal(cb: () => void): () => void {
    this.signalCbs.add(cb);
    return () => this.signalCbs.delete(cb);
  }

  /** Mirrors NodeTerminalSession.handleSignal: restore terminal first, then notify. */
  emitSignal(): void {
    this.leave();
    for (const cb of Array.from(this.signalCbs)) cb();
  }

  pressKey(controller: TuiController, key: string): void {
    controller.handleEvent({ type: "key", key, raw: key });
  }

  openHealth(controller: TuiController): string {
    controller.state.healthPanelOpen = true;
    controller.render();
    return controller.getBuffer().toPlainLines().join("\n");
  }
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pp-tui-live-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function seedRoadmap(dir: string): RoadmapService {
  const svc = new RoadmapService(dir);
  svc.init({ name: "Live Project", summary: "Live update verification." });
  svc.upsertMilestone({
    id: "v0.1",
    title: "v0.1 Core",
    status: "planned",
    order: 10,
    description: "Foundation.",
  });
  svc.addFeature({
    id: "core-store",
    title: "Core Store Engine",
    milestone: "v0.1",
    status: "planned",
    area: "Core",
    refs: ["bd:pp-101"],
    ship_criteria: ["Atomic writes"],
  });
  return svc;
}

function writeFeatureFile(featuresDir: string, id: string, title = "External Feature"): void {
  const content = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "milestone: v0.1",
    "status: planned",
    "---",
    "",
    "Hand-written externally.",
    "",
  ].join("\n");
  writeFileSync(join(featuresDir, `${id}.md`), content);
}

function configText(dir: string): string {
  return readFileSync(join(dir, ".project-pulse", "config.yaml"), "utf8");
}

function deferredBeadsClient(): { client: BeadsClient; pending: Array<(v: BeadStatusInfo[]) => void> } {
  const pending: Array<(v: BeadStatusInfo[]) => void> = [];
  const client: BeadsClient = {
    async resolveRefs(): Promise<BeadStatusInfo[]> {
      return await new Promise<BeadStatusInfo[]>((resolve) => {
        pending.push(resolve);
      });
    },
  };
  return { client, pending };
}

async function nextSseReload(slot: ProjectSlot, timeoutMs = 5000): Promise<string> {
  const res = slot.handleEvents();
  const reader = res.body!.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for SSE reload")), timeoutMs);
    });
    let buffered = "";
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      buffered += new TextDecoder().decode(chunk.value ?? new Uint8Array());
      if (buffered.includes("event: reload")) return buffered;
    }
  } finally {
    if (timer) clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}

describe("TUI live updates: watchers, reloads, and health scope", () => {
  test("external edits and an external atomic render clear ROADMAP_OUT_OF_SYNC without manual R", async () => {
    const svc = seedRoadmap(tempDir);
    const session = new VirtualSession();
    const ctrl = new TuiController({ rootDir: tempDir, session });
    ctrl.start();
    try {
      // External (non-atomic-style) feature file drop lands via the features-dir watch.
      writeFeatureFile(join(tempDir, ".project-pulse", "features"), "live-probe", "Live Probe");
      await waitFor(
        () => ctrl.getState().payload.features.some((f) => f.id === "live-probe"),
        "TUI sees external feature edit"
      );

      const healthWhileOutOfSync = session.openHealth(ctrl);
      expect(healthWhileOutOfSync).toContain("ROADMAP_OUT_OF_SYNC");
      ctrl.state.healthPanelOpen = false;
      ctrl.render();

      // External `pp render` atomically replaces ROADMAP.md (rename-over); the TUI must clear
      // the diagnostic without a manual R.
      svc.render();
      await waitFor(
        () => !ctrl.getState().payload.check.errors.some((i) => i.code === "ROADMAP_OUT_OF_SYNC"),
        "TUI clears ROADMAP_OUT_OF_SYNC after external render"
      );
      const healthAfter = session.openHealth(ctrl);
      expect(healthAfter).not.toContain("ROADMAP_OUT_OF_SYNC");
    } finally {
      ctrl.stop();
    }
  });

  test("atomic update through a symlink outside the watched dir reloads, and link repointing keeps working", async () => {
    const svc = seedRoadmap(tempDir);
    const pulseDir = join(tempDir, ".project-pulse");
    const extDir = join(tempDir, "ext-roadmap-home");
    mkdirSync(extDir);
    const realRoadmap = join(extDir, "ROADMAP.md");
    writeFileSync(realRoadmap, readFileSync(join(tempDir, "ROADMAP.md"), "utf8"));
    unlinkSync(join(tempDir, "ROADMAP.md"));
    symlinkSync(realRoadmap, join(tempDir, "ROADMAP.md"));

    const session = new VirtualSession();
    const ctrl = new TuiController({ rootDir: tempDir, session });
    ctrl.start();
    try {
      writeFeatureFile(join(pulseDir, "features"), "via-symlink");
      await waitFor(
        () => ctrl.getState().payload.features.some((f) => f.id === "via-symlink"),
        "TUI sees external feature edit"
      );
      expect(session.openHealth(ctrl)).toContain("ROADMAP_OUT_OF_SYNC");
      ctrl.state.healthPanelOpen = false;
      ctrl.render();

      // render() writes through the symlink: staging + rename land in extDir, not the repo.
      svc.render();
      await waitFor(
        () => !ctrl.getState().payload.check.errors.some((i) => i.code === "ROADMAP_OUT_OF_SYNC"),
        "render through symlink detected"
      );

      // Repoint the symlink to a second external dir; watchers on the abandoned resolved
      // parent are cleaned up and the new target is armed.
      const extDir2 = join(tempDir, "ext-roadmap-home-2");
      mkdirSync(extDir2);
      const realRoadmap2 = join(extDir2, "ROADMAP.md");
      writeFileSync(realRoadmap2, "stale content\n");
      unlinkSync(join(tempDir, "ROADMAP.md"));
      symlinkSync(realRoadmap2, join(tempDir, "ROADMAP.md"));

      writeFeatureFile(join(pulseDir, "features"), "after-repoint");
      await waitFor(
        () => ctrl.getState().payload.features.some((f) => f.id === "after-repoint"),
        "TUI sees edit after symlink repoint"
      );
      svc.render();
      await waitFor(
        () => !ctrl.getState().payload.check.errors.some((i) => i.code === "ROADMAP_OUT_OF_SYNC"),
        "render through repointed symlink detected"
      );
    } finally {
      ctrl.stop();
    }
  });

  test("edits through symlinked entity files (feature md and config) reload from external target dirs", async () => {
    seedRoadmap(tempDir);
    const pulseDir = join(tempDir, ".project-pulse");
    const featuresDir = join(pulseDir, "features");
    const featureBody = (title: string) =>
      [
        "---",
        "id: linked-feature",
        `title: ${title}`,
        "milestone: v0.1",
        "status: planned",
        "---",
        "",
        "Linked from the store.",
        "",
      ].join("\n");
    const extDir = join(tempDir, "ext-linked");
    mkdirSync(extDir);
    const realFeature = join(extDir, "linked-target.md");
    writeFileSync(realFeature, featureBody("Linked Feature v1"));
    symlinkSync(realFeature, join(featuresDir, "linked-feature.md"));

    const session = new VirtualSession();
    const ctrl = new TuiController({ rootDir: tempDir, session });
    ctrl.start();
    try {
      await waitFor(
        () => ctrl.getState().payload.features.some((f) => f.id === "linked-feature"),
        "linked feature loaded"
      );

      // Atomic write THROUGH the link: staging + rename land in extDir, not featuresDir.
      writeFileAtomic(join(featuresDir, "linked-feature.md"), featureBody("Linked Feature v2"));
      await waitFor(
        () =>
          ctrl.getState().payload.features.some(
            (f) => f.id === "linked-feature" && f.title === "Linked Feature v2"
          ),
        "edit through linked feature md reloads"
      );

      // Repoint the link to a different target basename: the parent watch name sets must be
      // re-derived by reconcile, or this write (under the new resolved basename) is missed.
      const extDir2 = join(tempDir, "ext-linked-2");
      mkdirSync(extDir2);
      const realFeature2 = join(extDir2, "renamed-target.md");
      writeFileSync(realFeature2, featureBody("Linked Feature v3"));
      unlinkSync(join(featuresDir, "linked-feature.md"));
      symlinkSync(realFeature2, join(featuresDir, "linked-feature.md"));
      // Reconcile arms new resolved-parent watches ~50ms behind the relink rename events;
      // fake timers cannot drive kernel fs.watch event delivery, so wall time is required.
      await new Promise((r) => setTimeout(r, 120));
      writeFileAtomic(join(featuresDir, "linked-feature.md"), featureBody("Linked Feature v4"));
      await waitFor(
        () =>
          ctrl.getState().payload.features.some(
            (f) => f.id === "linked-feature" && f.title === "Linked Feature v4"
          ),
        "edit through repointed linked feature md reloads"
      );

      // config.yaml as a symlink: disabling Beads through the link must reach the reload.
      const extDir3 = join(tempDir, "ext-linked-config");
      mkdirSync(extDir3);
      const realConfig = join(extDir3, "config.yaml");
      const goodConfig = configText(tempDir);
      writeFileSync(realConfig, goodConfig);
      unlinkSync(join(pulseDir, "config.yaml"));
      symlinkSync(realConfig, join(pulseDir, "config.yaml"));
      writeFileAtomic(
        join(pulseDir, "config.yaml"),
        goodConfig.replace("enabled: true", "enabled: false")
      );
      await waitFor(
        () => ctrl.getState().payload.config.integrations.beads.enabled === false,
        "beads disabled through linked config reloads"
      );
      expect(ctrl.getState().payload.beads).toEqual({});
      expect(ctrl.getState().beadsLoading).toBe(false);
    } finally {
      ctrl.stop();
    }
  });

  test("a missing features dir is picked up once created: TUI reloads and view slot broadcasts", async () => {
    const svc = seedRoadmap(tempDir);
    const slot = createProjectSlot(tempDir);
    rmSync(join(tempDir, ".project-pulse", "features"), { recursive: true, force: true });

    const session = new VirtualSession();
    const ctrl = new TuiController({ rootDir: tempDir, session });
    ctrl.start();
    expect(ctrl.getState().payload.features).toHaveLength(0);

    const sseDone = nextSseReload(slot);
    try {
      // Recreates the dir (writeFileAtomic mkdirs) and adds a feature: two fs changes.
      svc.addFeature({
        id: "reborn-feature",
        title: "Reborn Feature",
        milestone: "v0.1",
        status: "planned",
      });
      await waitFor(
        () => ctrl.getState().payload.features.some((f) => f.id === "reborn-feature"),
        "TUI sees change after missing dir is created"
      );
      await sseDone;
    } finally {
      ctrl.stop();
      slot.close();
    }
  });

  test("legal feature ids containing '.tmp.' reload; real staging files are ignored", async () => {
    seedRoadmap(tempDir);
    const featuresDir = join(tempDir, ".project-pulse", "features");
    const session = new VirtualSession();
    // Watcher-only case: noBeads keeps the async Beads lookup out of the picture so the
    // payload object identity below is driven purely by watcher reloads.
    const ctrl = new TuiController({ rootDir: tempDir, noBeads: true, session });
    ctrl.start();
    try {
      writeFeatureFile(featuresDir, "tmp-probe-.tmp.-case", "Tmp Named Feature");
      await waitFor(
        () => ctrl.getState().payload.features.some((f) => f.id === "tmp-probe-.tmp.-case"),
        "legal id containing .tmp. reloads"
      );

      const before = ctrl.getState().payload;
      writeFileSync(join(featuresDir, ".tmp.999.888.abcd"), "atomic write staging junk");
      // Negative assertion over a real OS fs.watch + 150ms debounce: fake timers cannot drive
      // kernel event delivery, so wall time is the only way to prove "no reload happened".
      await new Promise((r) => setTimeout(r, 450));
      expect(ctrl.getState().payload).toBe(before);
    } finally {
      ctrl.stop();
    }
  });

  test("malformed config on watch and manual reload shows error, preserves state, recovers on repair", async () => {
    seedRoadmap(tempDir);
    const configPath = join(tempDir, ".project-pulse", "config.yaml");
    const goodConfig = configText(tempDir);
    const session = new VirtualSession();
    const ctrl = new TuiController({ rootDir: tempDir, session });
    ctrl.start();
    try {
      // Watch-triggered reload while config is broken.
      writeFileSync(configPath, ":::{{{ not yaml [[[");
      writeFeatureFile(join(tempDir, ".project-pulse", "features"), "watch-trigger");
      await waitFor(() => ctrl.getState().loadError !== null, "watch reload reports failure");
      expect(ctrl.getState().payload.features.some((f) => f.id === "core-store")).toBe(true);
      expect(ctrl.getState().toast?.kind).toBe("err");
      expect(session.openHealth(ctrl)).toContain("Last reload failed");
      ctrl.state.healthPanelOpen = false;
      ctrl.render();

      // Manual reload while still broken keeps the error and the last good snapshot.
      session.pressKey(ctrl, "R");
      expect(ctrl.getState().loadError).not.toBeNull();
      expect(ctrl.getState().payload.features.some((f) => f.id === "core-store")).toBe(true);

      // Repair recovers without a manual step on the next watch reload.
      writeFileAtomic(configPath, goodConfig);
      await waitFor(() => ctrl.getState().loadError === null, "recovers after config repair");
      expect(ctrl.getState().toast?.kind).toBe("ok");
      expect(
        ctrl.getState().payload.features.some((f) => f.id === "watch-trigger")
      ).toBe(true);
      expect(session.openHealth(ctrl)).not.toContain("Last reload failed");
    } finally {
      ctrl.stop();
    }
  });

  test("SIGTERM during a pending reload resolves runTui and never writes another frame", async () => {
    seedRoadmap(tempDir);
    const session = new VirtualSession();
    const runPromise = runTui(tempDir, { session });
    const exited = await Promise.race([
      (async () => {
        // Sequencing a real fs.watch event against the live 150ms debounce and a signal:
        // kernel event delivery cannot be driven by fake timers, so wall-clock spacing is
        // required to land the signal mid-debounce.
        await new Promise((r) => setTimeout(r, 80));
        writeFeatureFile(join(tempDir, ".project-pulse", "features"), "pending-signal");
        await new Promise((r) => setTimeout(r, 60));
        session.emitSignal();
        await runPromise;
        return "exited";
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("runTui did not resolve after SIGTERM")), 3000)
      ),
    ]);
    expect(exited).toBe("exited");
    expect(session.entered).toBe(false);
    const writesAfterRestore = session.writesAtLeave;
    expect(writesAfterRestore).toBeGreaterThanOrEqual(0);
    // Any post-restore frame would arrive via the (now cancelled) reload debounce; wall time
    // is the only way to prove its absence.
    await new Promise((r) => setTimeout(r, 400));
    expect(session.writes.length).toBe(writesAfterRestore);
  });

  test("NodeTerminalSession notifies onSignal listeners after restoring the terminal", () => {
    const session = new NodeTerminalSession();
    let fired = 0;
    const off = session.onSignal(() => {
      fired += 1;
    });
    // handleSignal is process-signal plumbing; firing it directly is the only deterministic
    // signal injection available to tests (the process cannot receive real signals here).
    const fireSignal = (session as unknown as { handleSignal: () => void }).handleSignal.bind(
      session
    );
    fireSignal();
    expect(fired).toBe(1);
    off();
    fireSignal();
    expect(fired).toBe(1);
  });

  test("disabling Beads during a held lookup discards the stale result and Health reports skipped", async () => {
    seedRoadmap(tempDir);
    const configPath = join(tempDir, ".project-pulse", "config.yaml");
    const goodConfig = configText(tempDir);
    const { client, pending } = deferredBeadsClient();
    const session = new VirtualSession();
    const ctrl = new TuiController({ rootDir: tempDir, beadsClient: client, session });
    ctrl.start();
    try {
      expect(pending.length).toBe(1);
      pending[0]!([
        { ref: "bd:pp-101", id: "pp-101", available: true, found: true, status: "open", title: "B1" },
      ]);
      await waitFor(() => !ctrl.getState().beadsLoading, "first beads lookup resolves");
      expect(Object.keys(ctrl.getState().payload.beads).length).toBeGreaterThan(0);

      // Manual reload starts a second lookup; disable Beads while it is held.
      session.pressKey(ctrl, "R");
      await waitFor(() => pending.length === 2, "second beads lookup starts");
      writeFileAtomic(configPath, goodConfig.replace("enabled: true", "enabled: false"));
      await waitFor(() => !ctrl.getState().beadsLoading, "loading clears when beads disabled");
      await waitFor(
        () => Object.keys(ctrl.getState().payload.beads).length === 0,
        "stale beads data dropped from snapshot"
      );

      // The held lookup resolves late: it must not replace the new snapshot. Negative
      // assertion over a live async lookup; wall time is the only way to prove nothing lands.
      pending[1]!([
        { ref: "bd:pp-101", id: "pp-101", available: true, found: true, status: "closed", title: "B1" },
      ]);
      await new Promise((r) => setTimeout(r, 300));
      expect(Object.keys(ctrl.getState().payload.beads)).toHaveLength(0);
      expect(ctrl.getState().beadsLoading).toBe(false);

      const health = session.openHealth(ctrl);
      expect(health).toContain("Beads checks skipped");
      expect(health).not.toContain("All schema, DAG, ROADMAP.md sync, and Beads checks passed");
      ctrl.state.healthPanelOpen = false;
      ctrl.render();

      // Re-enabling Beads resumes lookups and Health reports the full pass again.
      writeFileAtomic(configPath, goodConfig);
      await waitFor(() => pending.length === 3, "beads lookup resumes when re-enabled");
      pending[2]!([
        { ref: "bd:pp-101", id: "pp-101", available: true, found: true, status: "open", title: "B1" },
      ]);
      await waitFor(() => !ctrl.getState().beadsLoading, "re-enabled lookup resolves");
      expect(Object.keys(ctrl.getState().payload.beads).length).toBeGreaterThan(0);
      const healthReenabled = session.openHealth(ctrl);
      expect(healthReenabled).toContain(
        "All schema, DAG, ROADMAP.md sync, and Beads checks passed (0 errors, 0 warnings)."
      );
    } finally {
      ctrl.stop();
    }
  });

  test("Health distinguishes skipped (--no-beads) and pending lookups from passed", async () => {
    seedRoadmap(tempDir);
    const { client, pending } = deferredBeadsClient();

    const noBeadsSession = new VirtualSession();
    const noBeadsCtrl = new TuiController({ rootDir: tempDir, noBeads: true, session: noBeadsSession });
    noBeadsCtrl.start();
    try {
      const health = noBeadsSession.openHealth(noBeadsCtrl);
      expect(health).toContain("Beads checks skipped (--no-beads or integrations.beads.enabled=false).");
      expect(health).toContain(
        "Schema, DAG, and ROADMAP.md sync checks passed (0 errors, 0 warnings)."
      );
      expect(health).not.toContain("All schema, DAG, ROADMAP.md sync, and Beads checks passed");
    } finally {
      noBeadsCtrl.stop();
    }

    const pendingSession = new VirtualSession();
    const pendingCtrl = new TuiController({ rootDir: tempDir, beadsClient: client, session: pendingSession });
    pendingCtrl.start();
    try {
      await waitFor(() => pendingCtrl.getState().beadsLoading, "lookup pending");
      const health = pendingSession.openHealth(pendingCtrl);
      expect(health).toContain("Beads checks pending…");
      expect(health).not.toContain("All schema, DAG, ROADMAP.md sync, and Beads checks passed");

      pending[0]!([]);
      await waitFor(() => !pendingCtrl.getState().beadsLoading, "lookup resolves");
      const healthAfter = pendingSession.openHealth(pendingCtrl);
      expect(healthAfter).toContain(
        "All schema, DAG, ROADMAP.md sync, and Beads checks passed (0 errors, 0 warnings)."
      );
      expect(healthAfter).not.toContain("Beads checks pending");
    } finally {
      pendingCtrl.stop();
    }
  });
});
