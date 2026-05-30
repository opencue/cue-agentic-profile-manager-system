import { describe, expect, test } from "bun:test";
import { styleMarkdownLines, ansiAwareTruncate, visibleWidth } from "./markdown";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("styleMarkdownLines", () => {
  test("one source line maps to one output line (scroll offsets stay valid)", () => {
    const body = "a\nb\nc\nd";
    expect(styleMarkdownLines(body)).toHaveLength(4);
  });

  test("preserves visible text after stripping ANSI", () => {
    const body = "# Title\n\nsome **bold** and `code` here\n- item one";
    const visible = styleMarkdownLines(body).map(stripAnsi);
    expect(visible[0]).toBe("Title");            // heading markers dropped, text kept
    expect(visible[2]).toContain("bold");
    expect(visible[2]).toContain("code");
    expect(visible[3]).toContain("item one");
  });

  test("headings are bold cyan with the # markers removed", () => {
    const [line] = styleMarkdownLines("## Heading");
    expect(line).toBe("\x1b[1m\x1b[36mHeading\x1b[0m");
  });

  test("fenced code blocks render verbatim and don't mangle inline markers", () => {
    const body = "```\nconst x = a * b * c\n```";
    const out = styleMarkdownLines(body);
    // The code line keeps its asterisks intact (no italic styling inside fence).
    expect(stripAnsi(out[1]!)).toBe("const x = a * b * c");
    expect(out[1]).toContain("\x1b[2m"); // dim
  });

  test("frontmatter --- delimiters survive as visible text", () => {
    const visible = styleMarkdownLines("---\nname: x\n---").map(stripAnsi);
    expect(visible[0]).toBe("---");
    expect(visible[1]).toBe("name: x");
  });

  test("list bullets get a marker and keep their text", () => {
    const visible = styleMarkdownLines("- first\n2. second").map(stripAnsi);
    expect(visible[0]).toContain("first");
    expect(visible[1]).toContain("second");
  });
});

describe("ansiAwareTruncate", () => {
  test("leaves short plain strings untouched", () => {
    expect(ansiAwareTruncate("hello", 20)).toBe("hello");
  });

  test("counts visible width ignoring escape sequences", () => {
    const styled = "\x1b[1mhello\x1b[0m"; // visible width 5
    // width 10 is enough, so no ellipsis; reset appended defensively
    const out = ansiAwareTruncate(styled, 10);
    expect(stripAnsi(out)).toBe("hello");
  });

  test("clips to width with an ellipsis on the last cell", () => {
    const out = ansiAwareTruncate("abcdefghij", 5);
    expect(stripAnsi(out)).toBe("abcd…"); // 4 chars + ellipsis = width 5
  });

  test("never slices an escape sequence in half and resets at the end", () => {
    const styled = "\x1b[1mabcdefghij\x1b[0m";
    const out = ansiAwareTruncate(styled, 5);
    expect(stripAnsi(out)).toBe("abcd…");
    expect(out.startsWith("\x1b[1m")).toBe(true); // opening sequence preserved whole
    expect(out.endsWith("\x1b[0m")).toBe(true);   // reset-closed
  });

  test("zero/negative width yields empty string", () => {
    expect(ansiAwareTruncate("abc", 0)).toBe("");
  });
});

describe("visibleWidth", () => {
  test("ignores SGR escape sequences", () => {
    expect(visibleWidth("\x1b[1m\x1b[36mHi\x1b[0m")).toBe(2);
  });
});
