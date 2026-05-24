import { describe, expect, test } from "bun:test";
import { lint, applyFixes, buildPrBody } from "./skill-linter";

const cleanSkill = `---
name: example-skill
description: Use when the user asks to do X with Y. Triggers on phrases like "do x".
tags: [example, demo]
allowed-tools: Bash(echo:*)
---

# Example Skill

This is a demo skill body.

## Prerequisites

- \`echo\` — built-in
`;

describe("skill-linter rules", () => {
  test("clean skill emits no errors", () => {
    const { diagnostics } = lint(cleanSkill);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("R001: missing name is flagged + fixable from H1", () => {
    const md = `---\ndescription: x\n---\n# My Skill\n`;
    const diags = lint(md).diagnostics;
    const r001 = diags.find((d) => d.rule === "R001");
    expect(r001?.severity).toBe("error");
    expect(typeof r001?.fix).toBe("function");
    const fixed = r001!.fix!(md);
    expect(fixed).toMatch(/name:\s*my-skill/);
  });

  test("R002: missing description is flagged (not auto-fixable)", () => {
    const md = `---\nname: x\n---\n# X\n`;
    const r002 = lint(md).diagnostics.find((d) => d.rule === "R002");
    expect(r002?.severity).toBe("error");
    expect(r002?.fix).toBeUndefined();
  });

  test("R003: description >200 chars is flagged", () => {
    const long = "A".repeat(250);
    const md = `---\nname: x\ndescription: ${long}\n---\n`;
    const r003 = lint(md).diagnostics.find((d) => d.rule === "R003");
    expect(r003?.severity).toBe("warning");
  });

  test("R004: description without trigger phrase is flagged", () => {
    const md = `---\nname: x\ndescription: A library for parsing things.\n---\n`;
    const r004 = lint(md).diagnostics.find((d) => d.rule === "R004");
    expect(r004?.severity).toBe("warning");
  });

  test("R004: description WITH trigger phrase passes", () => {
    const md = `---\nname: x\ndescription: Use when the user asks for parsing.\n---\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R004")).toBeUndefined();
  });

  test("R005: bare allowed-tools is flagged + fixed to Bash(name:*) form", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: nmap, curl\n---\n# X\n`;
    const r005 = lint(md).diagnostics.find((d) => d.rule === "R005");
    expect(r005?.severity).toBe("error");
    const fixed = r005!.fix!(md);
    expect(fixed).toContain("Bash(nmap:*)");
    expect(fixed).toContain("Bash(curl:*)");
  });

  test("R006: skill declares CLIs but no Prerequisites — flagged + fixed", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(nmap:*), Bash(sqlmap:*)\n---\n\n# X\n\nThis does things.\n`;
    const r006 = lint(md).diagnostics.find((d) => d.rule === "R006");
    expect(r006?.severity).toBe("warning");
    const fixed = r006!.fix!(md);
    expect(fixed).toMatch(/^## Prerequisites$/m);
    expect(fixed).toContain("**nmap**");
    expect(fixed).toContain("**sqlmap**");
  });

  test("R006: skill with existing Prerequisites is not flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(nmap:*)\n---\n\n# X\n\n## Prerequisites\n\n- nmap\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R006")).toBeUndefined();
  });

  test("R007: no tags/domain/category is info-level (not error)", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n`;
    const r007 = lint(md).diagnostics.find((d) => d.rule === "R007");
    expect(r007?.severity).toBe("info");
  });

  test("R008: broken anchor link is flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nSee [details](#missing-section).\n`;
    const r008 = lint(md).diagnostics.find((d) => d.rule === "R008");
    expect(r008?.severity).toBe("warning");
    expect(r008?.message).toContain("missing-section");
  });
});

describe("applyFixes round-trip", () => {
  test("fixing a broken skill makes errors disappear (round-trip)", () => {
    const broken = `---\nallowed-tools: nmap, sqlmap\n---\n# Pen Test Helper\n\nDoes stuff.\n`;
    const { fixed, applied } = applyFixes(broken);
    expect(applied).toContain("R001"); // name added
    expect(applied).toContain("R005"); // allowed-tools fixed
    expect(applied).toContain("R006"); // Prerequisites added
    // After fix, those three rules should no longer be flagged
    const remaining = lint(fixed).diagnostics.map((d) => d.rule);
    expect(remaining).not.toContain("R001");
    expect(remaining).not.toContain("R005");
    expect(remaining).not.toContain("R006");
  });

  test("applyFixes is idempotent — running twice is the same as once", () => {
    const broken = `---\nallowed-tools: nmap\n---\n# X\n`;
    const once = applyFixes(broken).fixed;
    const twice = applyFixes(once).fixed;
    expect(twice).toBe(once);
  });
});

describe("buildPrBody", () => {
  test("emits a title and body referencing the repo and listing fixes", () => {
    const before = `---\nallowed-tools: nmap\n---\n# X\n`;
    const { fixed, applied } = applyFixes(before);
    const fixedDiags = lint(before).diagnostics.filter((d) => applied.includes(d.rule));
    const left = lint(fixed).diagnostics;
    const { title, body } = buildPrBody({
      repo: "demo/skill",
      files: [{ path: "SKILL.md", before, after: fixed, fixedRules: [...new Set(applied)] }],
      diagnosticsFixed: fixedDiags, diagnosticsLeft: left,
    });
    expect(title).toContain("cue:");
    expect(body).toContain("demo/skill");
    expect(body).toContain("`cue`");
    expect(body).toContain("opt out");
    // Title now names the actual fixes (R001 → "add missing name:")
    expect(title).toMatch(/name|prerequisites|allowed-tools/i);
    // Body contains an inline diff
    expect(body).toContain("```diff");
  });
});

describe("buildPrTitle", () => {
  test("0 fixed rules → flagged review title", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle([], ["R002"])).toMatch(/spec issues need review/);
  });
  test("1 rule → single-clause title", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle(["R005"], [])).toMatch(/fix `allowed-tools` syntax/);
  });
  test("2 rules → joined with +", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle(["R005", "R006"], [])).toMatch(/allowed-tools.*\+.*Prerequisites/);
  });
  test("3+ rules → truncates with `+N more`", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle(["R001", "R005", "R006", "R007"], [])).toMatch(/\+\d+ more/);
  });
});

describe("R006 with cli-recipes", () => {
  test("Prerequisites section uses per-platform install commands from cli-recipes.json", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(nmap:*)\n---\n\n# X\n\nBody.\n`;
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("sudo apt install -y nmap");
    expect(fixed).toContain("brew install nmap");
  });
  test("snap-only recipe (helm) emits snap command", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(helm:*)\n---\n\n# X\n\nBody.\n`;
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("sudo snap install helm");
  });
});
