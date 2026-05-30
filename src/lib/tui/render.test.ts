import { describe, expect, test } from "bun:test";

import { renderFrame } from "./render";
import type { TuiState } from "./types";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function baseState(over: Partial<TuiState> = {}): TuiState {
  return {
    profiles: [
      { name: "skill-writer", icon: "🧬", description: "skill writing" },
      { name: "work-kfb",     icon: "🏭", description: "industrial" },
      { name: "medusa-shops", icon: "🛒", description: "webshops" },
    ],
    active: {
      name: "skill-writer",
      source: "pin-file",
      skillCount: 40,
      mcpCount: 2,
      pluginCount: 5,
    },
    skills: [
      { id: "meta/skill-reviewer", kind: "local" },
      { id: "meta/prompt-master",  kind: "local" },
      { id: "review/code-review",  kind: "local" },
    ],
    profileCursor: 0,
    skillCursor: 0,
    previewScroll: 0,
    preview: { title: "skill-reviewer", body: "---\nname: skill-reviewer\n---\n# heading" },
    focus: "profiles",
    error: null,
    ...over,
  };
}

describe("renderFrame", () => {
  test("renders profile name + counts in header", () => {
    const frame = stripAnsi(renderFrame(baseState(), { cols: 100, rows: 24 }));
    expect(frame).toContain("skill-writer");
    expect(frame).toContain("skills 40");
    expect(frame).toContain("mcps 2");
    expect(frame).toContain("plugins 5");
  });

  test("lists all visible profiles", () => {
    const frame = stripAnsi(renderFrame(baseState(), { cols: 100, rows: 24 }));
    expect(frame).toContain("skill-writer");
    expect(frame).toContain("work-kfb");
    expect(frame).toContain("medusa-shops");
  });

  test("lists skills of the focused profile", () => {
    const frame = stripAnsi(renderFrame(baseState(), { cols: 120, rows: 24 }));
    expect(frame).toContain("skill-reviewer");
    expect(frame).toContain("prompt-master");
    expect(frame).toContain("code-review");
  });

  test("shows preview title and body", () => {
    const frame = stripAnsi(renderFrame(baseState(), { cols: 120, rows: 24 }));
    expect(frame).toContain("name: skill-reviewer");
  });

  test("keybind footer shows nav hints", () => {
    const frame = stripAnsi(renderFrame(baseState(), { cols: 100, rows: 24 }));
    expect(frame).toContain("nav");
    expect(frame).toContain("pane");
    expect(frame).toContain("quit");
  });

  test("renders error banner when state.error is set", () => {
    const frame = stripAnsi(renderFrame(baseState({ error: "boom" }), { cols: 100, rows: 24 }));
    expect(frame).toContain("boom");
  });

  test("empty-profile branches do not throw and show placeholder", () => {
    const empty = baseState({ active: null, skills: [], preview: null });
    const frame = stripAnsi(renderFrame(empty, { cols: 100, rows: 24 }));
    expect(frame).toContain("(none pinned)");
    expect(frame).toContain("(no active profile)");
  });

  test("uses alt-screen clear sequence", () => {
    const frame = renderFrame(baseState(), { cols: 100, rows: 24 });
    expect(frame).toContain("\x1b[2J");
  });

  test("survives minimum viable dimensions", () => {
    expect(() => renderFrame(baseState(), { cols: 30, rows: 8 })).not.toThrow();
  });

  test("overflowing skills list shows a hidden-count indicator at the bottom", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `meta/skill-${i}`, kind: "local" as const, origin: "profile" as const,
    }));
    // Cursor at top → everything below is hidden; small pane forces overflow.
    const frame = stripAnsi(renderFrame(baseState({ skills: many, skillCursor: 0 }), { cols: 100, rows: 12 }));
    expect(frame).toMatch(/v \d+ more to the bottom/);
  });

  test("no indicator when the list fits the pane", () => {
    const few = [
      { id: "a", kind: "local" as const, origin: "profile" as const },
      { id: "b", kind: "local" as const, origin: "profile" as const },
    ];
    const frame = stripAnsi(renderFrame(baseState({ skills: few }), { cols: 100, rows: 24 }));
    expect(frame).not.toMatch(/more/);
  });

  test("mcp mode titles the middle pane MCPS and lists mcp rows", () => {
    const state = baseState({
      mode: "mcps",
      skills: [
        { id: "coolify", kind: "mcp", origin: "profile" },
        { id: "gbrain", kind: "mcp", origin: "builtin" },
      ],
      preview: { title: "coolify", body: "MCP server: coolify" },
    });
    const frame = stripAnsi(renderFrame(state, { cols: 120, rows: 24 }));
    expect(frame).toContain("MCPS (2)");
    expect(frame).toContain("coolify");
    expect(frame).toContain("gbrain");
  });

  test("cli mode titles the middle pane CLIS and lists cli rows", () => {
    const state = baseState({
      mode: "clis",
      skills: [
        { id: "gh", kind: "cli" },
        { id: "docker", kind: "cli" },
      ],
      preview: { title: "gh", body: "CLI: gh" },
    });
    const frame = stripAnsi(renderFrame(state, { cols: 120, rows: 24 }));
    expect(frame).toContain("CLIS (2)");
    expect(frame).toContain("gh");
    expect(frame).toContain("docker");
  });
});
