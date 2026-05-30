/**
 * Pure TUI renderer.
 *
 * renderFrame(state, dims) returns one string of ANSI moves that, when written
 * to stdout, paints the full frame. No side effects — testable in isolation.
 *
 * Layout (within `dims.cols` x `dims.rows`):
 *
 *   row 0          top header bar (active profile, counts)
 *   row 1          (blank separator)
 *   rows 2..R-2    three panes: profiles | skills | preview
 *   row R-1        bottom keybind bar
 *
 * R = dims.rows. Pane widths split the remaining columns 25 / 30 / rest, with
 * 1 column of vertical border between each pane.
 */

import type { TuiState, Pane } from "./types";
import { kittyPlaceholderLabel } from "../kitty-image";
import { styleMarkdownLines, ansiAwareTruncate } from "./markdown";
import { skillGroupId, skillGroupLabel } from "./data";

export interface Dims {
  cols: number;
  rows: number;
}

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const INVERSE = "\x1b[7m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const ORANGE = "\x1b[38;5;208m";

/**
 * Distinct 256-color palette for stable per-key tinting. A given key (a plugin
 * id, or a skill's category prefix) always hashes to the same color, so related
 * rows group visibly. Colors chosen to read on dark bg and stay distinct from
 * the fixed MCP/CLI dot colors.
 */
const PALETTE = [208, 141, 43, 205, 120, 220, 75, 210, 165, 81, 213, 156, 39, 214];

function paletteColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `\x1b[38;5;${PALETTE[h % PALETTE.length]}m`;
}

/** Category prefix of a skill id (`medusa/db-migrate` → `medusa`). */
function skillCategory(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return s.slice(0, Math.max(0, width - 1)) + "…";
}

function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

interface PaneRect {
  col: number;
  width: number;
}

function clampN(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function paneRects(
  cols: number,
  profileColMin = 16,
  profileDelta = 0,
  skillDelta = 0,
): { profiles: PaneRect; skills: PaneRect; preview: PaneRect } {
  const usable = Math.max(40, cols);
  // Profiles column auto-sizes to the longest profile name (profileColMin),
  // bounded so it never eats more than ~45% of the screen.
  let left = Math.max(16, Math.min(Math.max(28, profileColMin), Math.floor(usable * 0.45)));
  let mid = Math.max(20, Math.min(34, Math.floor(usable * 0.28)));
  // Apply keyboard-resize deltas, then clamp so every pane keeps a usable min
  // (profiles ≥ 12, skills ≥ 12, preview ≥ 10) within the available columns.
  left = clampN(left + profileDelta, 12, usable - 24);
  mid = clampN(mid + skillDelta, 12, usable - left - 12);
  const right = Math.max(10, usable - left - mid - 2);
  return {
    profiles: { col: 1, width: left },
    skills: { col: left + 2, width: mid },
    preview: { col: left + mid + 3, width: right },
  };
}

function header(state: TuiState, cols: number): string {
  const left = state.active
    ? `${BOLD}profile:${RESET} ${CYAN}${state.active.name}${RESET}`
    : `${DIM}profile: (none pinned)${RESET}`;
  const counts = state.active
    ? `${DIM}skills${RESET} ${state.active.skillCount} ${DIM}mcps${RESET} ${state.active.mcpCount} ${DIM}plugins${RESET} ${state.active.pluginCount}`
    : `${DIM}—${RESET}`;
  const sep = "  ";
  const stripped = stripAnsi(left + sep + counts);
  const padding = Math.max(0, cols - stripped.length - 2);
  return ` ${left}${sep}${counts}${" ".repeat(padding)} `;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function footer(state: TuiState, cols: number): string {
  const focusLabel = paneLabel(state.focus);
  const hints = `[up/dn] nav  [tab] pane  [< >] resize  [enter] open  [q] quit`;
  const left = `${DIM}focus:${RESET} ${focusLabel}`;
  const stripped = stripAnsi(left) + "  " + hints;
  const padding = Math.max(0, cols - stripped.length - 2);
  return ` ${left}  ${DIM}${hints}${RESET}${" ".repeat(padding)} `;
}

function paneLabel(p: Pane): string {
  if (p === "profiles") return "profiles";
  if (p === "skills") return "skills";
  return "preview";
}

function paneTitle(name: string, focused: boolean, width: number): string {
  const label = focused ? `${INVERSE} ${name.toUpperCase()} ${RESET}` : `${DIM} ${name.toUpperCase()} ${RESET}`;
  const stripped = stripAnsi(label);
  const padding = Math.max(0, width - stripped.length);
  return label + " ".repeat(padding);
}

function renderProfilesPane(state: TuiState, rect: PaneRect, top: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(moveTo(top, rect.col) + paneTitle("profiles", state.focus === "profiles", rect.width));
  const rows = Math.max(0, height - 1);
  const start = Math.max(0, Math.min(state.profileCursor - Math.floor(rows / 2), state.profiles.length - rows));
  for (let i = 0; i < rows; i++) {
    const idx = start + i;
    const p = state.profiles[idx];
    const r = top + 1 + i;
    if (!p) {
      lines.push(moveTo(r, rect.col) + " ".repeat(rect.width));
      continue;
    }
    const isCursor = idx === state.profileCursor;
    const isActive = state.active?.name === p.name;
    const marker = isActive ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    // Logo via kitty graphics when available, else emoji. The 2x1 placeholder
    // occupies the same visible width as `${emoji} ` so column math is stable.
    let icon: string;
    if (state.kitty && p.imageId) {
      icon = kittyPlaceholderLabel(p.imageId, 2, 1) + " ";
    } else {
      icon = p.icon ? `${p.icon} ` : "  ";
    }
    const nameWidth = Math.max(4, rect.width - 5);
    const name = truncate(p.name, nameWidth);
    const namePainted = isCursor ? `${INVERSE}${pad(name, nameWidth)}${RESET}` : pad(name, nameWidth);
    lines.push(moveTo(r, rect.col) + ` ${marker} ${icon}${namePainted}`);
  }
  return lines;
}

function renderSkillsPane(state: TuiState, rect: PaneRect, top: number, height: number): string[] {
  const lines: string[] = [];
  const label = state.mode === "mcps" ? "mcps" : state.mode === "clis" ? "clis" : "skills";
  const title = state.active ? `${label} (${state.skills.length})` : label;
  lines.push(moveTo(top, rect.col) + paneTitle(title, state.focus === "skills", rect.width));
  const rows = Math.max(0, height - 1);
  if (!state.active || state.skills.length === 0) {
    const empty = state.active ? "(none)" : "(no active profile)";
    lines.push(moveTo(top + 1, rect.col) + ` ${DIM}${truncate(empty, rect.width - 1)}${RESET}`);
    for (let i = 1; i < rows; i++) lines.push(moveTo(top + 1 + i, rect.col) + " ".repeat(rect.width));
    return lines;
  }
  // Assign each local-skill category a distinct palette color by first-appearance
  // order (collision-free up to PALETTE.length categories — beats hashing, which
  // collides with only a handful of categories).
  const catColor = new Map<string, string>();
  for (const s of state.skills) {
    if (s.kind !== "local") continue;
    const cat = skillCategory(s.id);
    if (!catColor.has(cat)) {
      catColor.set(cat, `\x1b[38;5;${PALETTE[catColor.size % PALETTE.length]}m`);
    }
  }

  // Build display rows: in skills mode we interleave a per-source header (local
  // category / npx repo / plugin) whenever the group changes. state.skills is
  // already group-contiguous (see data.skillsFor). Headers aren't navigable —
  // the cursor only ever lands on skill rows — so we keep skillCursor indexing
  // state.skills and map it to its display position here.
  type DisplayRow = { header: string } | { skillIdx: number };
  const grouped = !state.mode || state.mode === "skills";
  const display: DisplayRow[] = [];
  let prevGroup: string | null = null;
  for (let i = 0; i < state.skills.length; i++) {
    if (grouped) {
      const g = skillGroupId(state.skills[i]!);
      if (g !== prevGroup) {
        display.push({ header: skillGroupLabel(state.skills[i]!) });
        prevGroup = g;
      }
    }
    display.push({ skillIdx: i });
  }
  const cursorPos = display.findIndex((d) => "skillIdx" in d && d.skillIdx === state.skillCursor);

  // Overflow handling operates over display rows (headers included). Reserve the
  // bottom row for the scroll indicator when the list doesn't fit.
  const len = display.length;
  const overflow = len > rows;
  const itemRows = overflow ? Math.max(1, rows - 1) : rows;
  const start = Math.max(0, Math.min(Math.max(0, cursorPos) - Math.floor(itemRows / 2), Math.max(0, len - itemRows)));

  const skillDotColor = (s: typeof state.skills[number]): string => {
    if (s.kind === "npx") return YELLOW;
    if (s.kind === "mcp") return s.origin === "builtin" ? CYAN : MAGENTA;
    if (s.kind === "cli") return BLUE;
    if (s.kind === "plugin") return s.pluginId ? paletteColor(s.pluginId) : ORANGE;
    return catColor.get(skillCategory(s.id)) ?? paletteColor(skillCategory(s.id));
  };

  for (let i = 0; i < itemRows; i++) {
    const d = display[start + i];
    const r = top + 1 + i;
    if (!d) {
      lines.push(moveTo(r, rect.col) + " ".repeat(rect.width));
      continue;
    }
    if ("header" in d) {
      // Non-navigable group divider.
      const text = truncate(`── ${d.header} ──`, rect.width - 1);
      lines.push(moveTo(r, rect.col) + ` ${DIM}${text}${RESET}`);
      continue;
    }
    const s = state.skills[d.skillIdx]!;
    const isCursor = d.skillIdx === state.skillCursor;
    const dot = `${skillDotColor(s)}●${RESET}`;
    const nameWidth = Math.max(4, rect.width - 4);
    const name = truncate(s.id, nameWidth);
    const namePainted = isCursor && state.focus === "skills"
      ? `${INVERSE}${pad(name, nameWidth)}${RESET}`
      : pad(name, nameWidth);
    lines.push(moveTo(r, rect.col) + ` ${dot} ${namePainted}`);
  }
  // Fill the remaining rows; the last one carries the scroll indicator when the
  // list overflows the visible window. Counts are over display rows.
  for (let i = itemRows; i < rows; i++) {
    const r = top + 1 + i;
    if (overflow && i === rows - 1) {
      const above = start;
      const below = Math.max(0, len - (start + itemRows));
      // ASCII arrows (^/v) — the terminal font lacks ↑/↓ glyphs (they render
      // blank), so words + ASCII arrows keep the direction unambiguous.
      let txt: string;
      if (above > 0 && below > 0) txt = `^ ${above} more to the top   v ${below} more to the bottom`;
      else if (below > 0) txt = `v ${below} more to the bottom`;
      else if (above > 0) txt = `^ ${above} more to the top`;
      else txt = `${len} total`;
      lines.push(moveTo(r, rect.col) + ` ${DIM}${truncate(txt, rect.width - 1)}${RESET}`);
    } else {
      lines.push(moveTo(r, rect.col) + " ".repeat(rect.width));
    }
  }
  return lines;
}

function renderPreviewPane(state: TuiState, rect: PaneRect, top: number, height: number): string[] {
  const lines: string[] = [];
  const title = state.preview?.title ?? "preview";
  lines.push(moveTo(top, rect.col) + paneTitle(title, state.focus === "preview", rect.width));
  const rows = Math.max(0, height - 1);
  const body = state.preview?.body ?? "";
  if (!body) {
    const msg = state.active ? "(no skill selected)" : "(pick a profile to see skills)";
    lines.push(moveTo(top + 1, rect.col) + ` ${DIM}${truncate(msg, rect.width - 1)}${RESET}`);
    for (let i = 1; i < rows; i++) lines.push(moveTo(top + 1 + i, rect.col) + " ".repeat(rect.width));
    return lines;
  }
  // Style markdown → ANSI once per frame. One source line → one styled line, so
  // the scroll offset (a line index) stays valid. Truncation is ANSI-aware so
  // escape sequences aren't counted as width or sliced mid-sequence.
  const sourceLines = styleMarkdownLines(body);
  const start = Math.max(0, Math.min(state.previewScroll, Math.max(0, sourceLines.length - rows)));
  for (let i = 0; i < rows; i++) {
    const r = top + 1 + i;
    const text = sourceLines[start + i] ?? "";
    lines.push(moveTo(r, rect.col) + ` ${ansiAwareTruncate(text, Math.max(1, rect.width - 1))}`);
  }
  return lines;
}

function renderError(state: TuiState, cols: number, rows: number): string {
  if (!state.error) return "";
  const r = rows - 2;
  const text = ` ${RED}⚠${RESET} ${truncate(state.error, cols - 5)} `;
  return moveTo(r, 1) + text + " ".repeat(Math.max(0, cols - stripAnsi(text).length));
}

export function renderFrame(state: TuiState, dims: Dims): string {
  const cols = Math.max(40, dims.cols);
  const rows = Math.max(10, dims.rows);
  // Size the profiles column to the longest name so full names show without
  // truncation (+6 for the marker/icon/space prefix). paneRects caps it so it
  // can't dominate narrow terminals.
  const longestName = state.profiles.reduce((m, p) => Math.max(m, p.name.length), 0);
  const rects = paneRects(cols, longestName + 6, state.profileWidthDelta ?? 0, state.skillWidthDelta ?? 0);

  const out: string[] = [];
  out.push("\x1b[2J");
  out.push(moveTo(1, 1) + header(state, cols));

  const paneTop = 3;
  const paneHeight = rows - paneTop - 1;
  out.push(...renderProfilesPane(state, rects.profiles, paneTop, paneHeight));
  out.push(...renderSkillsPane(state, rects.skills, paneTop, paneHeight));
  out.push(...renderPreviewPane(state, rects.preview, paneTop, paneHeight));

  for (let r = paneTop; r < paneTop + paneHeight; r++) {
    out.push(moveTo(r, rects.profiles.col + rects.profiles.width) + `${DIM}│${RESET}`);
    out.push(moveTo(r, rects.skills.col + rects.skills.width) + `${DIM}│${RESET}`);
  }

  if (state.error) out.push(renderError(state, cols, rows));
  out.push(moveTo(rows, 1) + footer(state, cols));
  return out.join("");
}
