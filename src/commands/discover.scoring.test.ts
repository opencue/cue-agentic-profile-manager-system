/**
 * Scorer regression fixtures for `cue discover`.
 *
 * Each case is hand-labeled with a known-good repo (or known dump). We assert
 * on a *range*, not an exact value — the scoring formula is allowed to drift,
 * but real gems must stay well above the default --min-score (3) and dumps
 * must stay at 0.
 *
 * If you tweak the formula in discover.ts and these break: re-rank the
 * fixtures by hand first, then adjust the ranges here.
 */

import { describe, expect, test } from "bun:test";
import { scoreGem, isLikelySpam, type GemRepo } from "./discover";

// ---- Fixture helpers ------------------------------------------------------

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

function gem(partial: Partial<GemRepo>): GemRepo {
  return {
    full_name: "",
    owner: "",
    name: "",
    description: "",
    stars: 0,
    forks: 0,
    created_at: iso(180),
    pushed_at: iso(7),
    topics: [],
    language: "",
    has_skill_md: false,
    has_claude_dir: false,
    has_mcp_sdk: false,
    gem_score: 0,
    suggested_profiles: [],
    suggested_mcps: [],
    suggested_clis: [],
    quality: 0,
    url: "",
    ...partial,
  };
}

// ---- Real-world labeled fixtures -----------------------------------------

const FIXTURES: Array<{ label: string; repo: GemRepo; min: number; max: number; spam?: boolean }> = [
  {
    label: "elementalsouls/Claude-OSINT — 1362★ curated, top-tier gem",
    repo: gem({
      owner: "elementalsouls", name: "Claude-OSINT",
      description: "Two paired Claude skills · 90+ recon modules · 48 secret-regex patterns · 80+ dorks",
      stars: 1362, forks: 120, created_at: iso(365), pushed_at: iso(7),
      topics: ["claude-skill", "mcp-server"], language: "Python",
      has_skill_md: true, has_claude_dir: true,
    }),
    min: 18, max: 30,
  },
  {
    label: "fallow-rs/fallow-skills — 48★ proven small skill repo",
    repo: gem({
      owner: "fallow-rs", name: "fallow-skills",
      description: "Agent skills for fallow, codebase intelligence for JavaScript and TypeScript",
      stars: 48, forks: 6, created_at: iso(60), pushed_at: iso(7),
      topics: ["agent-skill"], language: "Rust",
      has_skill_md: true,
    }),
    min: 10, max: 18,
  },
  {
    label: "Lupynow/math-modeling-skills — 21★ mature & active",
    repo: gem({
      owner: "Lupynow", name: "math-modeling-skills",
      description: "Math modeling competition guidance Skill — covers CUMCM and MCM/ICM",
      stars: 21, forks: 3, created_at: iso(365), pushed_at: iso(30),
      topics: ["claude-skill"], language: "Python",
      has_skill_md: true,
    }),
    min: 9, max: 16,
  },
  {
    label: "Zandereins/hydra — 1★ hydra council, has SKILL.md, fresh",
    repo: gem({
      owner: "Zandereins", name: "hydra",
      description: "Multi-perspective code review council for Claude Code. 3 advisors by default, 10 agents in deep mode",
      stars: 1, forks: 0, created_at: iso(30), pushed_at: iso(7),
      topics: ["claude-skill"], language: "TypeScript",
      has_skill_md: true,
    }),
    min: 8, max: 14,
  },

  // --- Spam / AI dumps ---
  {
    label: "ditakebede1/personal-knowledge-nexus — AI slop (Library OS opener)",
    repo: gem({
      owner: "ditakebede1", name: "personal-knowledge-nexus",
      description: "Library OS 2026: Auto-Publish Your Deep Book Notes to Your Website",
      stars: 0, forks: 0, created_at: iso(7), pushed_at: iso(7),
    }),
    min: 0, max: 0, spam: true,
  },
  {
    label: "Meizu1330/neural-context-archive — AI slop (year-stamped name)",
    repo: gem({
      owner: "Meizu1330", name: "neural-context-archive-2026",
      description: "GitHub Memory Snapshot 2026 – Auto Recall & Prune Project Context",
      stars: 0, forks: 0, created_at: iso(7), pushed_at: iso(7),
    }),
    min: 0, max: 0, spam: true,
  },
  {
    label: "j28rawat/support-sentinel — AI slop (Production-grade opener)",
    repo: gem({
      owner: "j28rawat", name: "support-sentinel",
      description: "Production-grade multi-agent AI customer support system",
      stars: 0, forks: 0, created_at: iso(5), pushed_at: iso(5),
    }),
    min: 0, max: 0, spam: true,
  },

  // --- Edge cases ---
  {
    label: "Edge: fresh repo with year-stamped name BUT has SKILL.md → not spam",
    repo: gem({
      owner: "real-author", name: "skill-2026",
      description: "",
      stars: 0, forks: 0, created_at: iso(7), pushed_at: iso(7),
      has_skill_md: true,
    }),
    min: 5, max: 12, spam: false,
  },
  {
    label: "Edge: stale repo (push 500d ago) — penalty applies, low but nonzero",
    repo: gem({
      owner: "abandoned", name: "old-skill",
      description: "An older skill that used to work great — long since unmaintained",
      stars: 5, forks: 1, created_at: iso(700), pushed_at: iso(500),
      has_skill_md: true,
    }),
    min: 2, max: 7,
  },
  {
    label: "Edge: just an MCP SDK user, no SKILL.md — modest signal",
    repo: gem({
      owner: "someone", name: "mcp-tool",
      description: "Tiny MCP server for X — uses the model context protocol SDK",
      stars: 3, forks: 0, created_at: iso(120), pushed_at: iso(20),
      has_mcp_sdk: true,
    }),
    min: 3, max: 8,
  },
];

// ---- Tests ----------------------------------------------------------------

describe("scoreGem — labeled real-world fixtures", () => {
  for (const fx of FIXTURES) {
    test(fx.label, () => {
      const score = scoreGem(fx.repo);
      expect(score).toBeGreaterThanOrEqual(fx.min);
      expect(score).toBeLessThanOrEqual(fx.max);
      if (fx.spam !== undefined) {
        expect(isLikelySpam(fx.repo)).toBe(fx.spam);
      }
    });
  }
});

describe("scoreGem — ordering invariants", () => {
  test("curated 1000★ repo outranks 1★ fresh repo (both have SKILL.md)", () => {
    const curated = FIXTURES.find(f => f.label.startsWith("elementalsouls"))!.repo;
    const fresh = FIXTURES.find(f => f.label.startsWith("Zandereins"))!.repo;
    expect(scoreGem(curated)).toBeGreaterThan(scoreGem(fresh));
  });

  test("any AI dump scores below the default --min-score=3", () => {
    for (const fx of FIXTURES.filter(f => f.spam === true)) {
      expect(scoreGem(fx.repo)).toBeLessThan(3);
    }
  });

  test("SKILL.md is the load-bearing signal: adding it lifts an otherwise-borderline repo", () => {
    const without = gem({
      owner: "x", name: "y", description: "Reasonable description of an MCP server here",
      stars: 5, forks: 0, created_at: iso(100), pushed_at: iso(20),
    });
    const withIt = { ...without, has_skill_md: true };
    // Allow tiny fp epsilon; the contract is "SKILL.md contributes the full +5 bonus".
    expect(scoreGem(withIt) - scoreGem(without)).toBeGreaterThan(4.95);
  });
});

describe("isLikelySpam — guard conditions", () => {
  test("does NOT mark spam if has_skill_md is true (load-bearing exemption)", () => {
    expect(isLikelySpam(gem({
      owner: "spammy1", name: "foo-2026", description: "",
      created_at: iso(2), has_skill_md: true,
    }))).toBe(false);
  });

  test("does NOT mark spam if repo has any engagement (forks ≥ 1)", () => {
    expect(isLikelySpam(gem({
      owner: "spammy1", name: "foo-2026", description: "",
      stars: 0, forks: 1, created_at: iso(2),
    }))).toBe(false);
  });

  test("does NOT mark spam if repo is older than 14 days", () => {
    expect(isLikelySpam(gem({
      owner: "spammy1", name: "foo-2026", description: "",
      stars: 0, forks: 0, created_at: iso(30),
    }))).toBe(false);
  });
});
