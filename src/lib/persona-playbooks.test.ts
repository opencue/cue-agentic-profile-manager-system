/**
 * Tests for the Phase 1+2 schema extensions (persona, playbooks, qualityGates, evals).
 * Verifies profile-loader merge semantics and runtime-materializer output without
 * needing real npx skills or live MCP servers.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, readlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeRuntime } from "./runtime-materializer";
import type { ResolvedProfile } from "../../profiles/_types";

let root: string;
beforeEach(async () => { root = mkdtempSync(join(tmpdir(), "cue-persona-")); });
afterEach(async () => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

const base: ResolvedProfile = {
  name: "test-persona", description: "test profile",
  agents: ["claude-code"], inheritanceChain: ["test-persona"],
  skills: { local: [], npx: [] },
  mcps: [], plugins: [], env: {},
  rules: [], commands: [], hooks: [],
  persona: "", playbooks: [], qualityGates: [], evals: [],
};

describe("Phase 1: persona injection", () => {
  test("when persona is set, it appears as '## Your Expertise' above '## Your Role' in CLAUDE.md", async () => {
    const profile: ResolvedProfile = {
      ...base,
      persona: "You're a senior Rust engineer. You default to safety.",
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code", runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/${id}`,
      mcpRegistry: {}, userClaudeMd: "",
    });
    const md = readFileSync(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(md).toContain("## Your Expertise");
    expect(md).toContain("senior Rust engineer");
    // Ordering: persona before role
    const expertiseIdx = md.indexOf("## Your Expertise");
    const roleIdx = md.indexOf("## Your Role");
    expect(expertiseIdx).toBeGreaterThan(0);
    expect(roleIdx).toBeGreaterThan(expertiseIdx);
  });

  test("when persona is empty, '## Your Expertise' is omitted (backwards-compat)", async () => {
    const out = await materializeRuntime({
      profile: base, agent: "claude-code", runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/${id}`,
      mcpRegistry: {}, userClaudeMd: "",
    });
    const md = readFileSync(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(md).not.toContain("## Your Expertise");
    expect(md).toContain("## Your Role");
  });
});

describe("Phase 2: playbooks symlink + index", () => {
  test("playbook refs are symlinked into <runtime>/playbooks/ and indexed in CLAUDE.md", async () => {
    const profile: ResolvedProfile = {
      ...base,
      playbooks: ["ship-feature", "triage-bug"],
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code", runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/${id}`,
      mcpRegistry: {}, userClaudeMd: "",
    });
    const link = readlinkSync(join(out.runtimeDir, "playbooks", "ship-feature.md"));
    expect(link).toContain("resources/playbooks/ship-feature.md");
    const md = readFileSync(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(md).toContain("## Playbooks (2)");
    expect(md).toContain("`playbooks/ship-feature.md`");
    expect(md).toContain("`playbooks/triage-bug.md`");
  });

  test("missing playbook ref is non-fatal (skipped silently)", async () => {
    const profile: ResolvedProfile = {
      ...base, playbooks: ["definitely-not-a-real-playbook"],
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code", runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/${id}`,
      mcpRegistry: {}, userClaudeMd: "",
    });
    expect(out.rebuilt).toBe(true);
    // dir gets created but with no symlinks
    expect(existsSync(join(out.runtimeDir, "playbooks"))).toBe(true);
  });
});

describe("Phase 3: quality gates symlink + CLAUDE.md mention", () => {
  test("gate refs are symlinked and mentioned in '## Quality Gates' block", async () => {
    const profile: ResolvedProfile = {
      ...base, qualityGates: ["tests-pass.sh"],
    };
    const out = await materializeRuntime({
      profile, agent: "claude-code", runtimeRoot: join(root, "runtime"),
      skillSourceLookup: async (id) => `/fake/${id}`,
      mcpRegistry: {}, userClaudeMd: "",
    });
    const link = readlinkSync(join(out.runtimeDir, "quality-gates", "tests-pass.sh"));
    expect(link).toContain("resources/quality-gates/tests-pass.sh");
    const md = readFileSync(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(md).toContain("## Quality Gates");
    expect(md).toContain("`tests-pass.sh`");
  });
});
