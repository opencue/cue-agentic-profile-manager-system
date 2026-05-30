import { describe, expect, test } from "bun:test";

import { renderProfileList, resolveConflicts, type PickerOption } from "./picker";

describe("renderProfileList", () => {
  test("formats option label and description", () => {
    const opts: PickerOption[] = [
      { value: "frontend", label: "frontend", hint: "Frontend UI work" },
      { value: "backend", label: "backend", hint: "API/server work" },
    ];
    const rendered = renderProfileList(opts, { cwd: "/tmp/proj" });
    expect(rendered).toContain("cue · pick a profile");
    expect(rendered).toContain("/tmp/proj");
    expect(rendered).toContain("frontend");
    expect(rendered).toContain("Frontend UI work");
    expect(rendered).toContain("backend");
  });

  test("includes special entries for new profile and details", () => {
    const opts: PickerOption[] = [
      { value: "frontend", label: "frontend", hint: "Frontend UI work" },
    ];
    const rendered = renderProfileList(opts, { cwd: "/tmp/proj", includeFooter: true });
    expect(rendered).toMatch(/new profile from this cwd/);
    expect(rendered).toMatch(/details \(d\)/);
    expect(rendered).toMatch(/pick once, no pin \(n\)/);
  });
});

describe("resolveConflicts", () => {
  const map = (pairs: ReadonlyArray<readonly [string, readonly string[]]>): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const [k, vs] of pairs) m.set(k, new Set(vs));
    return m;
  };

  test("first-in-list wins when two conflicting values both appear", () => {
    const conflicts = map([
      ["medusa-vite", ["medusa-next"]],
      ["medusa-next", ["medusa-vite"]],
    ]);
    expect(resolveConflicts(["medusa-vite", "medusa-next"], conflicts)).toEqual(["medusa-vite"]);
    expect(resolveConflicts(["medusa-next", "medusa-vite"], conflicts)).toEqual(["medusa-next"]);
  });

  test("non-conflicting values pass through untouched", () => {
    const conflicts = map([["medusa-vite", ["medusa-next"]]]);
    expect(resolveConflicts(["medusa-vite", "backend", "frontend"], conflicts)).toEqual([
      "medusa-vite",
      "backend",
      "frontend",
    ]);
  });

  test("conflicts are evaluated against already-kept items only, not against dropped ones", () => {
    // a conflicts with b. b conflicts with a and c. c conflicts with b.
    // Iterating [a, b, c]: a is kept; b conflicts with kept a → dropped;
    // c is checked against the kept set {a}, which doesn't conflict with c,
    // so c is kept. The c-conflicts-with-b relation is moot because b never
    // made it into the kept set.
    const conflicts = map([
      ["a", ["b"]],
      ["b", ["a", "c"]],
      ["c", ["b"]],
    ]);
    expect(resolveConflicts(["a", "c"], conflicts)).toEqual(["a", "c"]);
    expect(resolveConflicts(["a", "b", "c"], conflicts)).toEqual(["a", "c"]);
  });

  test("empty input and empty map are safe", () => {
    expect(resolveConflicts([], new Map())).toEqual([]);
    expect(resolveConflicts(["a", "b"], new Map())).toEqual(["a", "b"]);
  });
});
