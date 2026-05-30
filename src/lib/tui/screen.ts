/**
 * Terminal screen primitives. Thin wrappers over stdout ANSI + stdin raw mode.
 *
 * The TUI uses the alternate-screen buffer so quitting restores the prior
 * terminal contents. enterTui() and leaveTui() must be paired even on crash:
 * the app loop wires SIGINT / uncaughtException to leaveTui().
 */

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";

export interface ScreenSize {
  cols: number;
  rows: number;
}

export function getSize(): ScreenSize {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

export function isTty(): boolean {
  return Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
}

export function enterTui(): void {
  process.stdout.write(ENTER_ALT + HIDE_CURSOR + CLEAR);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
}

export function leaveTui(): void {
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* already raw-off */ }
  }
  process.stdin.pause();
  process.stdout.write(SHOW_CURSOR + LEAVE_ALT);
}

export function paint(frame: string): void {
  process.stdout.write(frame);
}

export function onResize(handler: (size: ScreenSize) => void): () => void {
  const fn = () => handler(getSize());
  process.stdout.on("resize", fn);
  return () => process.stdout.off("resize", fn);
}
