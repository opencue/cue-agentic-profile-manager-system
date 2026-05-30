/**
 * `cue tui` — interactive three-pane viewer: profiles, skills, preview.
 *
 * Read-only MVP. Arrow keys move the cursor in the focused pane; tab cycles
 * focus across panes; q / esc / ctrl-c quits and restores the prior screen.
 *
 * Flags:
 *   --help, -h    print usage
 *   --once        render one frame to stdout and exit (smoke test; not interactive)
 */

import { runTui } from "../lib/tui/app";
import { loadInitialState } from "../lib/tui/data";
import { renderFrame } from "../lib/tui/render";
import { getSize } from "../lib/tui/screen";
import type { TuiMode } from "../lib/tui/types";

function helpText(): string {
  return [
    "cue tui — interactive profile/skill viewer",
    "",
    "Usage:",
    "  cue tui              open the three-pane TUI (skills in the middle pane)",
    "  cue tui --mcp        middle pane lists each profile's MCP servers",
    "  cue tui --cli        middle pane lists the CLI tools the skills require",
    "  cue tui --once       render one frame to stdout and exit (smoke test)",
    "  cue tui --help       this help",
    "",
    "Keys:",
    "  ↑ ↓        move cursor in the focused pane",
    "  tab        cycle focus: profiles → skills → preview",
    "  pgup/pgdn  scroll preview by 10 lines",
    "  q / esc    quit",
    "",
  ].join("\n");
}

function pickMode(argv: string[]): TuiMode {
  if (argv.includes("--mcp") || argv.includes("--mcps")) return "mcps";
  if (argv.includes("--cli") || argv.includes("--clis")) return "clis";
  return "skills";
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(helpText());
    return 0;
  }
  const mode = pickMode(argv);
  if (argv.includes("--once")) {
    const state = await loadInitialState(process.cwd(), mode);
    const size = getSize();
    process.stdout.write(renderFrame(state, { cols: size.cols || 100, rows: size.rows || 24 }));
    process.stdout.write("\n");
    return 0;
  }
  return runTui(process.cwd(), mode);
}
