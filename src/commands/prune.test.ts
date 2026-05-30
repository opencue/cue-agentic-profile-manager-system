import { describe, expect, test } from "bun:test";

import { dropSkillsFromYaml, parseArgs } from "./prune";

describe("prune parseArgs", () => {
  test("defaults: not --dead, not --apply, 30d window", () => {
    const a = parseArgs([]);
    expect(a.dead).toBe(false);
    expect(a.apply).toBe(false);
    expect(a.sinceDays).toBe(30);
  });

  test("--dead --apply --profile --since are all parsed", () => {
    const a = parseArgs(["--dead", "--apply", "--profile", "rust", "--since", "14"]);
    expect(a.dead).toBe(true);
    expect(a.apply).toBe(true);
    expect(a.profile).toBe("rust");
    expect(a.sinceDays).toBe(14);
  });

  test("--since accepts `14d` shorthand", () => {
    expect(parseArgs(["--since", "14d"]).sinceDays).toBe(14);
  });

  test("--since with garbage falls back to default 30", () => {
    expect(parseArgs(["--since", "garbage"]).sinceDays).toBe(30);
  });
});

describe("dropSkillsFromYaml", () => {
  const sample = `name: demo
description: example
inherits: core
skills:
  local:
    - cat/keep
    - cat/drop
    - cat/keep-too        # trailing comment preserved
    - cat/drop-too
    - id: cat/object-keep
    - id: cat/object-drop
mcps:
  - cat/drop              # not in skills block, must not be touched
`;

  test("removes plain skill entries by name", () => {
    const out = dropSkillsFromYaml(sample, ["cat/drop"]);
    expect(out).not.toBeNull();
    expect(out!.removed).toBe(1);
    expect(out!.rewritten).toContain("cat/keep");
    expect(out!.rewritten).not.toContain("- cat/drop\n");
  });

  test("removes object-form (id:) entries by name", () => {
    const out = dropSkillsFromYaml(sample, ["cat/object-drop"]);
    expect(out).not.toBeNull();
    expect(out!.removed).toBe(1);
    expect(out!.rewritten).toContain("id: cat/object-keep");
    expect(out!.rewritten).not.toContain("id: cat/object-drop");
  });

  test("never touches entries outside the skills.local block", () => {
    // `cat/drop` also appears under `mcps:` — must survive.
    const out = dropSkillsFromYaml(sample, ["cat/drop"])!;
    expect(out.rewritten).toContain("- cat/drop              # not in skills block");
  });

  test("returns null when no matching entries are found", () => {
    expect(dropSkillsFromYaml(sample, ["cat/does-not-exist"])).toBeNull();
  });

  test("removes multiple entries in a single pass", () => {
    const out = dropSkillsFromYaml(sample, ["cat/drop", "cat/drop-too", "cat/object-drop"]);
    expect(out!.removed).toBe(3);
    expect(out!.rewritten).not.toContain("- cat/drop\n");
    expect(out!.rewritten).not.toContain("- cat/drop-too\n");
    expect(out!.rewritten).not.toContain("id: cat/object-drop");
  });

  test("returns null when there is no skills.local block at all", () => {
    expect(dropSkillsFromYaml("name: x\ndescription: y\n", ["a"])).toBeNull();
  });
});
