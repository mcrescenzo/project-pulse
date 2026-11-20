import type { BeadsClient } from "../beads";
import { RoadmapService } from "../store";
import { NodeTerminalSession, type InputEvent, type TerminalSession } from "./input";
import { diffBuffers, ScreenBuffer, TUI_PALETTE } from "./screen";

export interface RunTuiOptions {
  noBeads?: boolean;
  beadsClient?: BeadsClient;
  session?: TerminalSession;
}

/**
 * Runs the Project Pulse interactive terminal dashboard (minimal T1 runtime stub).
 */
export async function runTui(rootDir: string, options: RunTuiOptions = {}): Promise<void> {
  const service = new RoadmapService(rootDir);
  service.requireInitialized();
  const loaded = service.load();

  const session = options.session ?? new NodeTerminalSession();
  let prevBuf: ScreenBuffer | null = null;

  const paint = () => {
    const buf = new ScreenBuffer(session.width, session.height);
    buf.clear({ bg: TUI_PALETTE.bg, fg: TUI_PALETTE.text });
    buf.drawBox(0, 0, buf.width, buf.height, {
      borderStyle: { fg: TUI_PALETTE.border },
      fillStyle: { bg: TUI_PALETTE.surface },
      title: `${loaded.config.project.name} — Project Pulse TUI`,
      titleStyle: { fg: TUI_PALETTE.accent, bold: true },
    });
    buf.writeText(
      2,
      2,
      `Loaded ${loaded.milestones.length} milestone(s) and ${loaded.features.length} feature(s). Press q to quit.`,
      buf.width - 4,
      { fg: TUI_PALETTE.text }
    );
    session.write(diffBuffers(prevBuf, buf, session.colorMode));
    prevBuf = buf;
  };

  await new Promise<void>((resolveDone) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      offInput();
      offResize();
      session.leave();
      resolveDone();
    };

    const offInput = session.onInput((ev: InputEvent) => {
      if (ev.type === "key" && (ev.key === "q" || (ev.ctrl && ev.key === "c"))) {
        finish();
      }
    });
    const offResize = session.onResize(() => {
      paint();
    });

    try {
      session.enter({ mouse: true, hover: false });
      paint();
    } catch (error) {
      finish();
      throw error;
    }
  });
}
