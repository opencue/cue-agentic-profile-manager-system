/**
 * Lightweight markdown → ANSI styler for the TUI preview pane.
 *
 * Design constraints:
 *  - One input line maps to exactly one output line. No reflow/wrapping, so the
 *    preview scroll offset (a line index) stays meaningful after styling.
 *  - Output carries only SGR escape sequences (bold/dim/italic/color). Those
 *    pass through tmux natively — no kitty graphics, no passthrough envelope.
 *  - Styling only *wraps* the visible text; it never deletes characters that a
 *    reader needs (heading markers are dropped, but the heading text stays).
 *
 * The companion `ansiAwareTruncate` lets the renderer clip a styled line to a
 * column width without counting escape bytes as visible cells or slicing a
 * sequence in half.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

/** Matches a complete SGR escape sequence: ESC [ … m */
const SGR = /\x1b\[[0-9;]*m/g;
/** Matches any CSI escape sequence (broader — used when copying verbatim). */
const CSI_AT = /^\x1b\[[0-9;]*[A-Za-z]/;

/** Visible width of a string, ignoring SGR escape sequences. */
export function visibleWidth(s: string): number {
  return s.replace(SGR, "").length;
}

/**
 * Inline styling for a single line of body text: `code`, **bold**, *italic*.
 * Applied in order so earlier replacements (code) shield their content from
 * later ones. Each replacement is self-contained (opens and RESETs its own
 * style), so there is no nesting state to track.
 */
function styleInline(text: string): string {
  let out = text;
  // `code` → dim. Run first so * or _ inside code spans aren't re-styled.
  out = out.replace(/`([^`]+)`/g, `${DIM}$1${RESET}`);
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`);
  // *italic* or _italic_ — single delimiter, not adjacent to another (so the
  // leftover halves of **bold** aren't matched).
  out = out.replace(/(?<![*\w])[*_]([^*_\n]+)[*_](?![*\w])/g, `${ITALIC}$1${RESET}`);
  return out;
}

/**
 * Style a full markdown document into per-line ANSI strings. Stateful across
 * lines only for fenced code blocks (``` … ```), which render dim verbatim so
 * inline markers inside code aren't mangled.
 */
export function styleMarkdownLines(body: string): string[] {
  const lines = body.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    // Fence toggle (``` or ~~~). The fence line itself renders dim.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(`${DIM}${line}${RESET}`);
      continue;
    }
    if (inFence) {
      out.push(`${DIM}${line}${RESET}`);
      continue;
    }

    // ATX heading: drop the `#` markers, keep the text, paint bold cyan.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`${BOLD}${CYAN}${heading[2]}${RESET}`);
      continue;
    }

    // Horizontal rule / frontmatter fence (---, ***, ___): dim verbatim.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(`${DIM}${line}${RESET}`);
      continue;
    }

    // Blockquote: dim the whole line, marker included.
    if (/^\s*>/.test(line)) {
      out.push(`${DIM}${line}${RESET}`);
      continue;
    }

    // List item: colorize the bullet/number, inline-style the remainder.
    const list = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      const [, indent, marker, rest] = list;
      const bullet = /^\d/.test(marker!) ? `${YELLOW}${marker}${RESET}` : `${GREEN}•${RESET}`;
      out.push(`${indent}${bullet} ${styleInline(rest!)}`);
      continue;
    }

    out.push(styleInline(line));
  }
  return out;
}

/**
 * Clip a (possibly ANSI-styled) string to `width` visible columns. SGR escape
 * sequences are copied verbatim and cost 0 width; the result is RESET-closed so
 * styling never bleeds into the next painted row. When clipped, the last
 * visible cell becomes an ellipsis.
 */
export function ansiAwareTruncate(s: string, width: number): string {
  if (width <= 0) return "";
  const total = visibleWidth(s);
  if (total <= width) {
    return s.includes("\x1b[") ? s + RESET : s;
  }

  const limit = width - 1; // reserve one cell for the ellipsis
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < limit) {
    if (s[i] === "\x1b") {
      const m = CSI_AT.exec(s.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += s[i];
    visible++;
    i++;
  }
  return out + "…" + RESET;
}
