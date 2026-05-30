/**
 * Raw-mode keyboard decoder. Reads chunks off stdin in raw mode and emits
 * typed key events. Recognized keys are intentionally narrow — the MVP only
 * needs nav + quit + a few mode toggles.
 */

export type KeyEvent =
  | { type: "up" }
  | { type: "down" }
  | { type: "left" }
  | { type: "right" }
  | { type: "tab" }
  | { type: "enter" }
  | { type: "esc" }
  | { type: "ctrl-c" }
  | { type: "q" }
  | { type: "slash" }
  | { type: "page-up" }
  | { type: "page-down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "char"; value: string };

export function decodeKey(chunk: Buffer | string): KeyEvent[] {
  const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const out: KeyEvent[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;

    if (c === "\x03") { out.push({ type: "ctrl-c" }); i++; continue; }
    if (c === "\r" || c === "\n") { out.push({ type: "enter" }); i++; continue; }
    if (c === "\t") { out.push({ type: "tab" }); i++; continue; }

    if (c === "\x1b") {
      const next = s[i + 1];
      const third = s[i + 2];
      if (next === "[" || next === "O") {
        if (third === "A") { out.push({ type: "up" });    i += 3; continue; }
        if (third === "B") { out.push({ type: "down" });  i += 3; continue; }
        if (third === "C") { out.push({ type: "right" }); i += 3; continue; }
        if (third === "D") { out.push({ type: "left" });  i += 3; continue; }
        if (third === "H") { out.push({ type: "home" }); i += 3; continue; }
        if (third === "F") { out.push({ type: "end" });  i += 3; continue; }
        if (third === "5" && s[i + 3] === "~") { out.push({ type: "page-up" });   i += 4; continue; }
        if (third === "6" && s[i + 3] === "~") { out.push({ type: "page-down" }); i += 4; continue; }
      }
      out.push({ type: "esc" });
      i = next === undefined ? i + 1 : i + 2;
      continue;
    }

    if (c === "/") { out.push({ type: "slash" }); i++; continue; }
    if (c === "q" || c === "Q") { out.push({ type: "q" }); i++; continue; }
    out.push({ type: "char", value: c });
    i++;
  }
  return out;
}

export function onKey(handler: (key: KeyEvent) => void): () => void {
  const listener = (chunk: Buffer) => {
    for (const k of decodeKey(chunk)) handler(k);
  };
  process.stdin.on("data", listener);
  return () => process.stdin.off("data", listener);
}
