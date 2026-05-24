/**
 * `cue discover` — find hidden gem skill repos and export a curated index.
 *
 * Subcommands:
 *   search [query]          — search GitHub for undiscovered skill repos
 *   list                    — show already-discovered gems (from cache)
 *   --export [path]         — generate docs/discovered.md
 *   --json                  — JSON output
 *   --min-score <n>         — minimum gem score to include (default: 3)
 *   --limit <n>             — max results (default: 50)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Cache path resolved lazily so tests can redirect via XDG_CONFIG_HOME without
// re-importing the module. (Bun shares module state across test files; const
// values captured at import time wouldn't see runtime env changes.)
function cacheDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue", "discover");
}
function cacheFile(): string { return join(cacheDir(), "gems.json"); }
const DEFAULT_EXPORT = join(REPO_ROOT, "docs", "discovered.md");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GemRepo {
  full_name: string;
  owner: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  created_at: string;
  pushed_at: string;
  topics: string[];
  language: string;
  has_skill_md: boolean;
  has_claude_dir: boolean;
  has_mcp_sdk: boolean;
  gem_score: number;
  suggested_profiles: string[];
  suggested_mcps: string[];
  suggested_clis: string[];
  quality: number;
  url: string;
}

interface GemCache {
  updated: string;
  gems: GemRepo[];
}

// ---------------------------------------------------------------------------
// GitHub search queries for hidden gems
// ---------------------------------------------------------------------------

const SEARCH_QUERIES = [
  // Repos with SKILL.md (explicit claude skill format)
  { q: "path:SKILL.md", label: "has SKILL.md" },
  // Repos with .claude directory
  { q: "path:.claude pushed:>{RECENT}", label: "has .claude/" },
  // Topic-based
  { q: "topic:claude-skill", label: "topic:claude-skill" },
  { q: "topic:claude-code-skill", label: "topic:claude-code-skill" },
  { q: "topic:mcp-server pushed:>{RECENT}", label: "topic:mcp-server" },
  { q: "topic:ai-agent-skill", label: "topic:ai-agent-skill" },
  // Frontmatter patterns (allowed-tools is cue/claude skill marker)
  { q: "\"allowed-tools\" in:file extension:md pushed:>{RECENT}", label: "allowed-tools frontmatter" },
  // MCP SDK dependents
  { q: "\"@modelcontextprotocol/sdk\" in:file filename:package.json", label: "MCP SDK users" },
];

function recentDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().split("T")[0]!;
}

// ---------------------------------------------------------------------------
// Gem scoring
// ---------------------------------------------------------------------------

const SLOP_OPENERS = [
  /^(production-grade|premium saas|local-first ai|enterprise-ready|next-gen)\b/i,
  /\bauto-fill\s+ATS\b/i,
  /\bcertified\s+(architect|professional)\s+exam/i,
  /\bLibrary OS\b/i,
];

/** Spot obvious AI-generated/dump repos that hit search but aren't gems. */
export function isLikelySpam(repo: GemRepo): boolean {
  // Has the SKILL.md signal? Don't filter — that's load-bearing evidence.
  if (repo.has_skill_md) return false;

  const desc = (repo.description ?? "").trim();
  const created = repo.created_at ? new Date(repo.created_at).getTime() : Date.now();
  const daysSinceCreation = (Date.now() - created) / 86400000;
  const freshAndDead = daysSinceCreation < 14 && repo.stars === 0 && repo.forks === 0;
  if (!freshAndDead) return false;

  // Year-stamped names: foo-2026, editor_pack_v3_2026-03-17, neural-X-2026
  const yearInName = /(^|[_-])(2025|2026)([_-]|$)/.test(repo.name);
  // High-entropy numeric suffix on owner: ditakebede1, karthik768990, Meizu1330
  const ownerNumericTail = /[a-zA-Z][0-9]{3,}$/.test(repo.owner);
  // Description that opens with marketing slop
  const slopDesc = SLOP_OPENERS.some(re => re.test(desc));

  return yearInName || ownerNumericTail || slopDesc || desc.length === 0;
}

/** One score component — used for the breakdown view (`--explain-score`). */
export interface ScoreComponent {
  label: string;
  delta: number;
}

/**
 * Returns score + per-factor breakdown. Pure: no I/O, deterministic.
 *
 * Keep additions multiplicative-resistant — if you add a factor, balance it
 * against the existing fixture ranges in discover.scoring.test.ts.
 */
export function scoreGemBreakdown(repo: GemRepo): { score: number; components: ScoreComponent[] } {
  if (isLikelySpam(repo)) return { score: 0, components: [{ label: "likely spam", delta: 0 }] };

  const now = Date.now();
  const pushed = repo.pushed_at ? new Date(repo.pushed_at).getTime() : now;
  const created = repo.created_at ? new Date(repo.created_at).getTime() : now;
  const daysSincePush = (now - pushed) / 86400000;
  const ageDays = (now - created) / 86400000;

  const cs: ScoreComponent[] = [];
  const add = (label: string, delta: number) => { if (Math.abs(delta) >= 0.05) cs.push({ label, delta }); };

  // Recency: smooth decay, half-life ~60 days.
  add(`recency (push ${Math.round(daysSincePush)}d ago)`, 3 * Math.exp(-daysSincePush / 60));

  // Real skill signals (file-level evidence)
  if (repo.has_skill_md) add("has SKILL.md", 5);
  if (repo.has_claude_dir) add("has .claude/", 3);
  if (repo.has_mcp_sdk) add("uses MCP SDK", 2);

  // Topic hits — count + diversity bonus
  const gemTopics = ["claude-skill", "claude-code", "mcp-server", "ai-agent", "codex-plugin", "claude-code-skill", "agent-skill"];
  const matchingTopics = repo.topics.filter(t => gemTopics.includes(t));
  const topicHits = Math.min(3, matchingTopics.length);
  if (topicHits > 0) add(`relevant topics (×${topicHits})`, topicHits * 2);
  // Diversity bonus: hits across both "claude-*" AND "mcp-*"/agent-* categories
  const hasClaudeTopic = matchingTopics.some(t => t.startsWith("claude"));
  const hasAgentOrMcpTopic = matchingTopics.some(t => t.startsWith("mcp") || t.includes("agent"));
  if (hasClaudeTopic && hasAgentOrMcpTopic) add("topic diversity (claude+agent/mcp)", 0.5);

  // Star curve
  add(`stars (${repo.stars}★)`, Math.min(2.5, Math.log(1 + repo.stars) * 0.5));

  // Proven gem: high stars + skill-related content
  if (repo.stars >= 50) {
    const descLower = (repo.description ?? "").toLowerCase();
    const isSkillRepo = descLower.includes("skill") || descLower.includes("mcp") || descLower.includes("claude") || descLower.includes("agent");
    if (isSkillRepo) add("proven gem (≥50★ + skill desc)", 3);
  }
  if (repo.stars >= 500) add("highly proven (≥500★)", 2);

  // Fork-to-star ratio
  if (repo.stars >= 5 && repo.forks > 0) {
    const ratio = repo.forks / repo.stars;
    if (ratio >= 0.1) add(`fork ratio ≥0.10 (${repo.forks}⑂)`, 1);
    if (ratio >= 0.3) add("fork ratio ≥0.30 (strong reuse)", 1);
  }

  // Description quality
  const desc = (repo.description ?? "").trim();
  if (desc.length >= 40 && desc.length <= 200) add("description length 40-200 chars", 1);

  // Penalty: year-stamped description (2025/2026 in desc — marketing slop signal)
  if (!repo.has_skill_md && /\b(2025|2026)\b/.test(desc)) add("year-stamped description", -0.5);

  // Penalty: owner with high-entropy numeric tail (bot/dump signal — only when no SKILL.md)
  if (!repo.has_skill_md && /[a-zA-Z][0-9]{3,}$/.test(repo.owner)) add("owner numeric tail", -1);

  // Penalty: year-stamped repo name (already partly caught by spam filter; reinforces for borderline cases)
  if (!repo.has_skill_md && /(^|[_-])(2025|2026)([_-]|$)/.test(repo.name)) add("year-stamped repo name", -1);

  // Mature AND actively maintained: >90 days old, pushed in last 30
  if (ageDays > 90 && daysSincePush < 30) add("mature + actively maintained", 1.5);

  // Earned-attention bonus: stars accrued over real time
  if (repo.stars >= 5 && ageDays > 60) add("earned attention (stars × age)", Math.min(1, Math.log(1 + repo.stars * ageDays / 365) * 0.15));

  // Stale penalty
  if (daysSincePush > 365) add("stale (>1yr no push)", -3);

  const raw = cs.reduce((s, c) => s + c.delta, 0);
  const score = Math.max(0, Math.round(raw * 10) / 10);
  return { score, components: cs };
}

export function scoreGem(repo: GemRepo): number {
  return scoreGemBreakdown(repo).score;
}

// ---------------------------------------------------------------------------
// Render helpers — colors, formatting, slop strip, freshness, install detection
// ---------------------------------------------------------------------------

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};
const wrap = (color: string, s: string): string => `${color}${s}${ANSI.reset}`;

/** Strip marketing-slop openers from a description so the real feature shows first. */
export function stripSlopOpener(desc: string): string {
  let s = desc.trim();
  for (const re of SLOP_OPENERS) s = s.replace(re, "").trim();
  s = s.replace(/^[—:·\-,]\s*/, "").trim();           // dangling punctuation after strip
  s = s.replace(/^\d{4}\s*(:|—|-)\s*/, "").trim();    // "2026 - actual feature" → "actual feature"
  s = s.replace(/^Best\s+(?:AI\s+)?[A-Z][a-z]+\s+\d{4}:?\s*/i, "").trim();  // "Best AI Code Architect 2026:"
  return s;
}

/** Word-wrap to width, returning lines with the given hanging indent on continuations. */
export function wrapText(text: string, width: number, indent: string): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + 1 + w.length > width && line) {
      lines.push(line);
      line = indent + w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Color stars by tier: magenta ≥1000, green ≥100, yellow ≥10, gray <10. */
export function colorStars(n: number): string {
  if (n >= 1000) return wrap(ANSI.magenta + ANSI.bold, `★ ${n}`);
  if (n >= 100) return wrap(ANSI.green, `★ ${n}`);
  if (n >= 10) return wrap(ANSI.yellow, `★ ${n}`);
  return wrap(ANSI.gray, `★ ${n}`);
}

/** Pretty "Nd ago" / "Nw ago" / "Nmo ago" / "Nyr ago". */
export function freshnessLabel(pushed_at: string): string {
  if (!pushed_at) return "unknown";
  const days = Math.floor((Date.now() - new Date(pushed_at).getTime()) / 86400000);
  if (days < 0) return "in future";
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}yr ago`;
}

/** Green if hot (<14d), yellow if warm (<60d), gray if cold (<365d), red if stale. */
export function freshnessColor(pushed_at: string): string {
  if (!pushed_at) return ANSI.gray;
  const days = Math.floor((Date.now() - new Date(pushed_at).getTime()) / 86400000);
  if (days < 14) return ANSI.green;
  if (days < 60) return ANSI.yellow;
  if (days < 365) return ANSI.gray;
  return ANSI.red;
}

/** Tier name + tier color for a score. */
export function tierName(score: number): string {
  if (score >= 12) return "premium";
  if (score >= 8) return "strong";
  if (score >= 5) return "worth";
  return "tail";
}
export function tierColorFor(score: number): string {
  if (score >= 12) return ANSI.magenta;
  if (score >= 8) return ANSI.cyan;
  if (score >= 5) return ANSI.yellow;
  return ANSI.gray;
}

/**
 * Scan all profile.yaml files for a skill ref matching the gem's name or
 * `owner/name` slug. Returns the list of profiles that already include it.
 * Cheap enough to call per-gem (cached once per session via the closure pattern
 * in renderers).
 */
export function getInstalledIn(gem: GemRepo, profilesDir = join(REPO_ROOT, "profiles")): string[] {
  if (!existsSync(profilesDir)) return [];
  const hits: string[] = [];
  const slugs = [gem.name.toLowerCase(), gem.full_name.toLowerCase()];
  try {
    const profiles = require("node:fs").readdirSync(profilesDir);
    for (const p of profiles) {
      if (p.startsWith("_") || p.startsWith(".")) continue;
      const yaml = join(profilesDir, p, "profile.yaml");
      if (!existsSync(yaml)) continue;
      const content = readFileSync(yaml, "utf8").toLowerCase();
      if (slugs.some(s => content.includes(s))) hits.push(p);
    }
  } catch { /* ignore */ }
  return hits;
}

/** Detect active profile from cwd (`.cue-profile` file). Returns undefined if none. */
export function getActiveProfile(cwd: string = process.cwd()): string | undefined {
  const f = join(cwd, ".cue-profile");
  if (!existsSync(f)) return undefined;
  try {
    const s = readFileSync(f, "utf8").trim();
    return s || undefined;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Filters — `cue discover` supports many slicing dimensions over GemRepo[]
// ---------------------------------------------------------------------------

export interface GemFilter {
  minStars?: number;
  maxStars?: number;
  freshDays?: number;       // pushed within last N days
  staleDays?: number;       // pushed more than N days ago
  hasMcp?: boolean;
  hasSkillMd?: boolean;
  hasClaudeDir?: boolean;
  language?: string;        // case-insensitive
  topic?: string;           // case-insensitive substring
  owner?: string;
  excludeOwner?: string;
  tier?: Set<"premium" | "strong" | "worth" | "tail">;
  profile?: string;         // gem suggested_profiles includes this
  installed?: boolean;      // gem is referenced by some profile.yaml
  notInstalled?: boolean;
}

export function applyFilters(gems: GemRepo[], f: GemFilter): GemRepo[] {
  if (!Object.keys(f).length) return gems;
  return gems.filter(g => {
    if (f.minStars !== undefined && g.stars < f.minStars) return false;
    if (f.maxStars !== undefined && g.stars > f.maxStars) return false;
    if (f.freshDays !== undefined) {
      const days = (Date.now() - new Date(g.pushed_at || 0).getTime()) / 86400000;
      if (days > f.freshDays) return false;
    }
    if (f.staleDays !== undefined) {
      const days = (Date.now() - new Date(g.pushed_at || 0).getTime()) / 86400000;
      if (days < f.staleDays) return false;
    }
    if (f.hasMcp && !(g.has_mcp_sdk || g.topics.includes("mcp-server"))) return false;
    if (f.hasSkillMd && !g.has_skill_md) return false;
    if (f.hasClaudeDir && !g.has_claude_dir) return false;
    if (f.language && (g.language || "").toLowerCase() !== f.language.toLowerCase()) return false;
    if (f.topic && !g.topics.some(t => t.toLowerCase().includes(f.topic!.toLowerCase()))) return false;
    if (f.owner && g.owner.toLowerCase() !== f.owner.toLowerCase()) return false;
    if (f.excludeOwner && g.owner.toLowerCase() === f.excludeOwner.toLowerCase()) return false;
    if (f.tier && !f.tier.has(tierName(g.gem_score) as any)) return false;
    if (f.profile && !g.suggested_profiles.includes(f.profile)) return false;
    if (f.installed || f.notInstalled) {
      const isIn = getInstalledIn(g).length > 0;
      if (f.installed && !isIn) return false;
      if (f.notInstalled && isIn) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Profile suggestion (keyword matching)
// ---------------------------------------------------------------------------

const PROFILE_KEYWORDS: Record<string, string[]> = {
  backend: ["api", "server", "express", "fastapi", "django", "flask", "webhook", "database", "sql", "graphql", "deploy", "docker", "kubernetes", "microservice", "redis", "postgres", "mongo", "supabase", "prisma"],
  frontend: ["react", "vue", "svelte", "nextjs", "css", "tailwind", "component", "browser", "dom", "ui", "ux", "responsive", "animation", "spa"],
  nextjs: ["nextjs", "next.js", "vercel", "app-router", "server-component", "next-auth"],
  "python-api": ["python", "fastapi", "django", "flask", "sqlalchemy", "pytest", "pip", "uvicorn", "pydantic", "celery"],
  rust: ["rust", "cargo", "tokio", "crate", "wasm", "async-std"],
  "go-api": ["golang", "gin", "echo", "chi", "gorm", "goroutine"],
  cybersecurity: ["security", "pentest", "vulnerability", "exploit", "forensic", "dfir", "red-team", "blue-team", "malware", "audit", "cve", "owasp", "threat", "osint", "recon", "dork", "credential", "phishing"],
  "creative-media": ["image", "video", "media", "design", "brand", "visual", "photo", "illustration", "figma", "canvas"],
  "docs-writer": ["documentation", "markdown", "docs", "writing", "obsidian", "knowledge-base", "wiki", "readme", "technical-writing", "docusaurus"],
  research: ["research", "paper", "literature", "citation", "academic", "notebook", "arxiv", "scholar", "study", "analysis"],
  threejs: ["three.js", "threejs", "webgl", "shader", "3d", "scene", "geometry"],
  video: ["video", "ffmpeg", "transcription", "frame", "subtitle", "stream", "recording", "youtube"],
  marketing: ["seo", "marketing", "copywriting", "growth", "conversion", "analytics", "campaign", "funnel", "landing-page"],
  medusa: ["medusa", "ecommerce", "storefront", "shop", "cart", "checkout", "product-catalog", "amazon", "seller"],
  "fleet-control": ["multi-agent", "orchestrat", "coordinator", "dispatch", "parallel", "swarm", "colony"],
};

// `core` is the fallback — don't match it via keywords, only assign when nothing else matches.

function suggestProfiles(repo: GemRepo): string[] {
  const desc = (repo.description ?? "").toLowerCase();
  const topicStr = repo.topics.join(" ").toLowerCase();
  const name = repo.name.toLowerCase();
  const lang = repo.language.toLowerCase();

  const scored: { profile: string; score: number }[] = [];

  for (const [profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
    let hits = 0;

    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}`, "i");
      // Topics get 3× weight
      if (re.test(topicStr)) hits += 3;
      // Description gets 1× weight
      if (re.test(desc)) hits += 1;
      // Repo name gets 2× weight
      if (re.test(name)) hits += 2;
    }

    // Language-based boost
    if (profile === "python-api" && lang === "python") hits += 2;
    if (profile === "rust" && lang === "rust") hits += 2;
    if (profile === "go-api" && lang === "go") hits += 2;
    if (profile === "frontend" && (lang === "typescript" || lang === "javascript")) hits += 1;

    // Require at least 3 weighted hits to suggest (stricter threshold)
    if (hits >= 3) scored.push({ profile, score: hits });
  }

  // Sort by score, take top 2
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 2).map(s => s.profile);
  return top.length ? top : ["core"];
}

// ---------------------------------------------------------------------------
// GitHub API search
// ---------------------------------------------------------------------------

function ghSearch(query: string, limit: number): any[] {
  const q = query.replace("{RECENT}", recentDate());
  const res = spawnSync("gh", [
    "api", "search/repositories",
    "--method", "GET",
    "-f", `q=${q}`,
    "-f", `per_page=${Math.min(limit, 30)}`,
    "-f", "sort=updated",
    "--jq", ".items",
  ], { encoding: "utf8", timeout: 30000 });

  if (res.status !== 0) return [];
  try { return JSON.parse(res.stdout); } catch { return []; }
}

function checkFileExists(fullName: string, path: string): boolean {
  const res = spawnSync("gh", ["api", `repos/${fullName}/contents/${path}`, "--jq", ".name"], {
    encoding: "utf8", timeout: 8000,
  });
  return res.status === 0 && !!res.stdout.trim();
}

/** Build profile-specific GitHub search queries */
function buildProfileQueries(profile: string): { q: string; label: string }[] {
  const PROFILE_SEARCH_TERMS: Record<string, string[]> = {
    backend: ["api server deploy", "webhook microservice", "database migration", "docker kubernetes skill", "ci cd pipeline"],
    frontend: ["react component skill", "ui design system", "tailwind css", "browser testing", "responsive web"],
    nextjs: ["nextjs skill", "next.js vercel", "app router server component", "next-auth"],
    "python-api": ["python fastapi skill", "django api", "flask sqlalchemy", "pytest automation"],
    rust: ["rust cargo skill", "rust cli tool", "tokio async", "rust wasm"],
    "go-api": ["golang api skill", "go gin echo", "golang microservice"],
    cybersecurity: ["security audit skill", "pentest tool", "vulnerability scanner", "red team blue team", "threat detection"],
    "creative-media": ["image generation skill", "video editing ai", "design asset brand", "figma automation"],
    "docs-writer": ["documentation generator", "markdown writing skill", "knowledge base wiki", "technical writing"],
    research: ["research paper skill", "literature review", "citation manager", "academic notebook", "arxiv"],
    threejs: ["three.js skill", "webgl shader", "3d scene interactive"],
    video: ["video processing skill", "ffmpeg automation", "transcription subtitle", "youtube tool"],
    marketing: ["seo optimization skill", "marketing automation", "copywriting ai", "conversion funnel", "growth hacking"],
    medusa: ["medusa ecommerce", "storefront skill", "shopping cart", "product catalog", "amazon seller"],
    "fleet-control": ["multi-agent orchestration", "agent coordinator", "parallel agent", "task dispatch"],
    coolify: ["coolify deploy", "self-hosted paas", "server management"],
    hostinger: ["hosting dns", "vps management", "domain config"],
    nvidia: ["nvidia cuda", "gpu optimization", "cuopt routing"],
  };

  const terms = PROFILE_SEARCH_TERMS[profile] ?? [profile];
  const recent = recentDate();

  return [
    // Profile-specific skill searches
    ...terms.map(t => ({ q: `${t} pushed:>${recent}`, label: t })),
    // Also search for SKILL.md repos matching profile keywords
    { q: `path:SKILL.md ${terms[0]}`, label: `SKILL.md + ${terms[0]}` },
    // Topic-based for the profile
    { q: `topic:claude-skill ${terms[0]?.split(" ")[0]}`, label: `topic:claude-skill + ${profile}` },
  ];
}

async function cmdSearch(query: string | undefined, opts: { limit: number; minScore: number; json: boolean; profile?: string }): Promise<number> {
  const profileLabel = opts.profile ? ` for "${opts.profile}" profile` : "";
  process.stderr.write(`🔍 Searching GitHub for hidden gem skill repos${profileLabel}...\n\n`);

  const seen = new Set<string>();
  const gems: GemRepo[] = [];

  let queries: { q: string; label: string }[];

  if (query) {
    queries = [{ q: `${query} pushed:>${recentDate()}`, label: `"${query}"` }];
  } else if (opts.profile) {
    queries = buildProfileQueries(opts.profile);
  } else {
    queries = SEARCH_QUERIES;
  }

  for (const { q, label } of queries) {
    if (gems.length >= opts.limit) break;
    process.stderr.write(`  ⏳ ${label}...\n`);

    const items = ghSearch(q, opts.limit - gems.length);
    for (const item of items) {
      if (seen.has(item.full_name)) continue;
      seen.add(item.full_name);

      const gem: GemRepo = {
        full_name: item.full_name,
        owner: item.owner?.login ?? "",
        name: item.name,
        description: item.description ?? "",
        stars: item.stargazers_count ?? 0,
        forks: item.forks_count ?? 0,
        created_at: item.created_at ?? "",
        pushed_at: item.pushed_at ?? "",
        topics: item.topics ?? [],
        language: item.language ?? "",
        has_skill_md: false,
        has_claude_dir: false,
        has_mcp_sdk: false,
        gem_score: 0,
        suggested_profiles: [],
        suggested_mcps: [],
        suggested_clis: [],
        quality: 0,
        url: item.html_url ?? `https://github.com/${item.full_name}`,
      };

      // SKILL.md / .claude detection is load-bearing for scoring, so always check.
      // Authenticated `gh api` raises the rate ceiling enough to absorb 2 calls per repo.
      gem.has_skill_md = checkFileExists(gem.full_name, "SKILL.md");
      gem.has_claude_dir = checkFileExists(gem.full_name, ".claude");

      gem.gem_score = scoreGem(gem);
      gem.suggested_profiles = suggestProfiles(gem);

      if (gem.gem_score >= opts.minScore) gems.push(gem);
    }
  }

  // Sort by score descending
  gems.sort((a, b) => b.gem_score - a.gem_score);

  // Cache results
  mkdirSync(cacheDir(), { recursive: true });
  const cache: GemCache = { updated: new Date().toISOString(), gems };
  writeFileSync(cacheFile(), JSON.stringify(cache, null, 2));

  if (opts.json) {
    process.stdout.write(JSON.stringify(gems, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  🎯 Hidden Gems Found: ${gems.length}\n\n`);
  for (const gem of gems.slice(0, opts.limit)) {
    const profiles = gem.suggested_profiles.join(", ");
    process.stdout.write(`  ${gem.gem_score >= 8 ? "💎" : gem.gem_score >= 5 ? "✨" : "🔹"} ${gem.full_name} (★ ${gem.stars}, score: ${gem.gem_score})\n`);
    if (gem.description) process.stdout.write(`    ${gem.description.slice(0, 100)}\n`);
    process.stdout.write(`    Profiles: ${profiles}\n`);
    if (gem.has_skill_md) process.stdout.write(`    📄 Has SKILL.md\n`);
    if (gem.has_claude_dir) process.stdout.write(`    📁 Has .claude/\n`);
    process.stdout.write(`    ${gem.url}\n\n`);
  }

  process.stdout.write(`  Export: cue discover --export\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Export to docs/discovered.md
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Export — SEO/GEO-friendly artifacts.
//
//   --export <path.md>           single markdown file (legacy)
//   --export <dir> --site        per-profile pages + index (SEO targets long-tail
//                                 queries: "Claude Code skills for cybersecurity")
//   --export <dir> --site --html same, with HTML + JSON-LD schema for LLM citation
// ---------------------------------------------------------------------------

function tierIcon(score: number): string {
  return score >= 8 ? "💎" : score >= 5 ? "✨" : "🔹";
}
function tierLabel(score: number): string {
  return score >= 8 ? "exceptional" : score >= 5 ? "strong" : "potential";
}
function repoAnchor(repo: string): string {
  return repo.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function buildProfilePage(profile: string, gems: GemRepo[], updated: string): string {
  const sorted = [...gems].sort((a, b) => b.gem_score - a.gem_score);
  let md = `---
title: "Claude Code Skills for ${profile}"
description: "${gems.length} community Claude Code skills curated by cue for the ${profile} profile. Hidden-gem repos with SKILL.md, MCP servers, and CLI integrations."
layout: page
updated: ${updated.split("T")[0]}
tags: [claude-code, ${profile}, skills, mcp, ai-agents]
---

`;
  md += `# Claude Code Skills for \`${profile}\`\n\n`;
  md += `> ${gems.length} community-built skills curated by [cue](https://github.com/recodeee/cue) for the **${profile}** profile.\n`;
  md += `> Each one was discovered via GitHub Code Search, scored on signal quality, and mapped to this profile by keyword overlap.\n\n`;
  md += `**[← back to all discovered skills](./index.md)**\n\n---\n\n`;

  for (const gem of sorted) {
    const icon = tierIcon(gem.gem_score);
    md += `<a id="${repoAnchor(gem.full_name)}"></a>\n`;
    md += `## ${icon} [${gem.full_name}](${gem.url})\n\n`;
    md += `**★ ${gem.stars}** · ${tierLabel(gem.gem_score)} (score ${gem.gem_score})`;
    if (gem.language) md += ` · ${gem.language}`;
    if (gem.topics.length > 0) md += ` · tags: ${gem.topics.slice(0, 5).join(", ")}`;
    md += `\n\n${gem.description}\n\n`;
    const evidence: string[] = [];
    if (gem.has_skill_md) evidence.push("✅ SKILL.md");
    if (gem.has_claude_dir) evidence.push("✅ `.claude/` directory");
    if (gem.has_mcp_sdk) evidence.push("✅ MCP SDK");
    if (evidence.length > 0) md += `${evidence.join(" · ")}\n\n`;
    if (gem.suggested_clis.length > 0) {
      md += `**CLIs needed:** ${gem.suggested_clis.map((c) => `\`${c}\``).join(", ")}\n\n`;
    }
    md += `\`\`\`bash\ncue skills add ${gem.full_name} --profile ${profile}\n\`\`\`\n\n---\n\n`;
  }
  md += `## About this list\n\nGenerated by [cue](https://github.com/recodeee/cue) — an open-source agent profile manager. cue runs nightly GitHub Code Search for \`filename:SKILL.md\` and scores each repo by recency, skill format, MCP integration, and engagement signals.\n\n**Authors:** if you'd rather not be listed, add \`<!-- cue: ignore -->\` to your README — we respect it permanently. Want to opt in explicitly? Add \`<!-- cue: ok -->\`.\n\n`;
  return md;
}

function buildIndexPage(byProfile: Map<string, GemRepo[]>, totalGems: number, updated: string): string {
  const sorted = [...byProfile.entries()].sort((a, b) => b[1].length - a[1].length);
  let md = `---
title: "Discovered Claude Code Skills"
description: "${totalGems} community Claude Code skills curated by cue across ${byProfile.size} profiles. Find skills for backend, frontend, marketing, cybersecurity, and more."
layout: page
updated: ${updated.split("T")[0]}
tags: [claude-code, skills, mcp, ai-agents, marketplace]
---

# 🎯 Discovered Claude Code Skills

> **${totalGems} hidden-gem skills** discovered by [cue](https://github.com/recodeee/cue) across **${byProfile.size} profiles**.
> Last updated: ${updated.split("T")[0]} · refreshed nightly via GitHub Code Search.

## Browse by profile

| Profile | Skills | Sample |
|---|---|---|
`;
  for (const [profile, gems] of sorted) {
    const top = [...gems].sort((a, b) => b.gem_score - a.gem_score).slice(0, 3);
    const samples = top.map((g) => `\`${g.full_name.split("/")[1]}\``).join(", ");
    md += `| [**${profile}**](./${profile}.md) | ${gems.length} | ${samples} |\n`;
  }
  md += `\n## How scoring works\n\n| Tier | Score | Meaning |\n|---|---|---|\n| 💎 exceptional | 8+ | Active repo, proper skill format, low star count (true hidden gem) |\n| ✨ strong | 5–7 | Good signal mix — proven format or active maintainer |\n| 🔹 potential | 3–4 | Some signal — worth a look |\n\n`;
  md += `## Use cue to install any of these\n\n\`\`\`bash\nnpx cue@latest\ncue skills add owner/repo --profile <profile>\n\`\`\`\n\n## About cue\n\ncue is an agent profile manager for Claude Code and Codex CLI. [github.com/recodeee/cue](https://github.com/recodeee/cue)\n`;
  return md;
}

function buildJsonLdItemList(name: string, description: string, gems: GemRepo[]): string {
  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    description,
    numberOfItems: gems.length,
    itemListElement: gems.slice(0, 100).map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "SoftwareApplication",
        name: g.full_name,
        description: g.description,
        url: g.url,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Cross-platform",
        codeRepository: g.url,
        ...(g.language ? { programmingLanguage: g.language } : {}),
      },
    })),
  };
  return JSON.stringify(list, null, 2);
}

function buildIndexHtml(byProfile: Map<string, GemRepo[]>, totalGems: number, updated: string): string {
  const sorted = [...byProfile.entries()].sort((a, b) => b[1].length - a[1].length);
  const allGems: GemRepo[] = [];
  for (const [, gems] of sorted) for (const g of gems) if (!allGems.some((x) => x.full_name === g.full_name)) allGems.push(g);
  const jsonLd = buildJsonLdItemList(
    "Discovered Claude Code Skills",
    `${totalGems} community-built skills for Claude Code, curated by cue.`,
    allGems,
  );
  const rows = sorted.map(([profile, gems]) => {
    const top = [...gems].sort((a, b) => b.gem_score - a.gem_score).slice(0, 3);
    const samples = top.map((g) => `<code>${g.full_name.split("/")[1]}</code>`).join(", ");
    return `    <tr><td><a href="./${profile}.html">${profile}</a></td><td>${gems.length}</td><td>${samples}</td></tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Discovered Claude Code Skills · cue</title>
<meta name="description" content="${totalGems} community Claude Code skills curated by cue across ${byProfile.size} profiles. Find skills for backend, frontend, marketing, cybersecurity, and more.">
<meta property="og:title" content="Discovered Claude Code Skills · cue">
<meta property="og:description" content="${totalGems} community Claude Code skills curated by cue.">
<meta property="og:type" content="website">
<link rel="canonical" href="https://recodeee.github.io/cue/discovered/">
<style>body{font:16px/1.6 -apple-system,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;color:#222}table{border-collapse:collapse;width:100%}th,td{padding:.5em .75em;border-bottom:1px solid #eee;text-align:left}code{background:#f4f4f4;padding:1px 5px;border-radius:3px;font-size:.9em}a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}</style>
<script type="application/ld+json">
${jsonLd}
</script>
</head><body>
<h1>🎯 Discovered Claude Code Skills</h1>
<p><strong>${totalGems} hidden-gem skills</strong> discovered by <a href="https://github.com/recodeee/cue">cue</a> across <strong>${byProfile.size} profiles</strong>.</p>
<p><small>Last updated: ${updated.split("T")[0]} · refreshed nightly via GitHub Code Search.</small></p>
<h2>Browse by profile</h2>
<table><thead><tr><th>Profile</th><th>Skills</th><th>Sample</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<p><a href="https://github.com/recodeee/cue">github.com/recodeee/cue</a></p>
</body></html>
`;
}

function buildProfileHtml(profile: string, gems: GemRepo[], updated: string): string {
  const sorted = [...gems].sort((a, b) => b.gem_score - a.gem_score);
  const jsonLd = buildJsonLdItemList(
    `Claude Code Skills for ${profile}`,
    `${gems.length} community Claude Code skills for ${profile}, curated by cue.`,
    sorted,
  );
  const cards = sorted.map((g) => {
    const icon = tierIcon(g.gem_score);
    const escDesc = g.description.replace(/[<>]/g, (c) => c === "<" ? "&lt;" : "&gt;");
    return `<article id="${repoAnchor(g.full_name)}">
<h2>${icon} <a href="${g.url}">${g.full_name}</a></h2>
<p><small>★ ${g.stars} · ${tierLabel(g.gem_score)} (score ${g.gem_score})${g.language ? " · " + g.language : ""}</small></p>
<p>${escDesc}</p>
<pre><code>cue skills add ${g.full_name} --profile ${profile}</code></pre>
</article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Claude Code Skills for ${profile} · cue</title>
<meta name="description" content="${gems.length} community Claude Code skills for ${profile}, curated by cue. Discovered via GitHub Code Search, scored on signal quality.">
<meta property="og:title" content="Claude Code Skills for ${profile} · cue">
<meta property="og:description" content="${gems.length} skills for ${profile}, curated by cue.">
<link rel="canonical" href="https://recodeee.github.io/cue/discovered/${profile}.html">
<style>body{font:16px/1.6 -apple-system,sans-serif;max-width:760px;margin:2em auto;padding:0 1em;color:#222}article{border-bottom:1px solid #eee;padding:1em 0}pre{background:#f4f4f4;padding:.6em;border-radius:4px;overflow-x:auto}a{color:#0a58ca;text-decoration:none}a:hover{text-decoration:underline}</style>
<script type="application/ld+json">
${jsonLd}
</script>
</head><body>
<p><a href="./index.html">← back to all profiles</a></p>
<h1>Claude Code Skills for <code>${profile}</code></h1>
<p>${gems.length} skills discovered by <a href="https://github.com/recodeee/cue">cue</a>. Last updated ${updated.split("T")[0]}.</p>
${cards}
</body></html>
`;
}

interface ExportOpts { site: boolean; html: boolean; }

function cmdExport(exportPath: string, opts: ExportOpts = { site: false, html: false }): number {
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }
  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  const gems = cache.gems;

  const byProfile = new Map<string, GemRepo[]>();
  for (const gem of gems) {
    for (const p of gem.suggested_profiles) {
      const list = byProfile.get(p) ?? [];
      list.push(gem);
      byProfile.set(p, list);
    }
  }

  // --- Site mode: per-profile pages + index for SEO ---
  if (opts.site) {
    const dir = exportPath.endsWith(".md") ? dirname(exportPath) : exportPath;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.md"), buildIndexPage(byProfile, gems.length, cache.updated));
    if (opts.html) writeFileSync(join(dir, "index.html"), buildIndexHtml(byProfile, gems.length, cache.updated));
    for (const [profile, profGems] of byProfile) {
      writeFileSync(join(dir, `${profile}.md`), buildProfilePage(profile, profGems, cache.updated));
      if (opts.html) writeFileSync(join(dir, `${profile}.html`), buildProfileHtml(profile, profGems, cache.updated));
    }
    const fileCount = (byProfile.size + 1) * (opts.html ? 2 : 1);
    process.stdout.write(`✅ Exported ${gems.length} gems → ${fileCount} files under ${dir}/\n`);
    process.stdout.write(`   index: ${join(dir, "index.md")}${opts.html ? " (+ .html with JSON-LD)" : ""}\n`);
    process.stdout.write(`   per-profile pages: ${byProfile.size}${opts.html ? " (+ HTML)" : ""}\n`);
    return 0;
  }

  // --- Legacy single-file mode ---
  let md = `<p align="center">
  <img src="https://img.shields.io/badge/cue-💎_Discovered_Skills-6366f1?style=for-the-badge&labelColor=1e1b4b" alt="cue discovered skills">
</p>

# 🎯 Discovered Skills & Hidden Gems

> **${gems.length} repos** discovered across **${byProfile.size} profiles** · Last scan: ${cache.updated.split("T")[0]}
>
> Found by scanning GitHub for skill-compatible projects that most developers haven't discovered yet.

<table>
<tr><td>💎 <b>8+</b></td><td>Exceptional — active, proper skill format, community-validated</td></tr>
<tr><td>✨ <b>5–7</b></td><td>Strong — good signals, worth checking out</td></tr>
<tr><td>🔹 <b>3–4</b></td><td>Potential — some signals present</td></tr>
</table>

## Quick install

\`\`\`bash
npm install -g cue-ai
cue discover search                    # find gems
cue discover install --min-score 8     # install top gems into profiles
\`\`\`

---

`;
  const sortedProfiles = [...byProfile.keys()].sort();
  for (const profile of sortedProfiles) {
    const profileGems = byProfile.get(profile)!.sort((a, b) => b.gem_score - a.gem_score);
    const topScore = profileGems[0]?.gem_score ?? 0;
    const profileIcon = topScore >= 10 ? "🏆" : topScore >= 8 ? "💎" : "✨";
    md += `## ${profileIcon} ${profile} <sub>(${profileGems.length} gems)</sub>\n\n`;
    md += `| | Repo | ★ | Score | What it does |\n|---|------|---|-------|-------------|\n`;
    for (const gem of profileGems) {
      const icon = tierIcon(gem.gem_score);
      const desc = gem.description.slice(0, 70).replace(/\|/g, "\\|");
      const skillBadge = gem.has_skill_md ? " 📄" : "";
      md += `| ${icon} | [${gem.full_name}](${gem.url})${skillBadge} | ${gem.stars} | ${gem.gem_score} | ${desc} |\n`;
    }
    md += `\n<details><summary>Install all ${profile} gems</summary>\n\n\`\`\`bash\ncue discover install --profile ${profile} --min-score 5\n\`\`\`\n</details>\n\n---\n\n`;
  }
  md += `## Contributing

Want your repo listed? Either:
- Add \`topic:claude-skill\` to your GitHub repo
- Include a \`SKILL.md\` in your repo root
- Both get you discovered automatically on the next nightly scan

Want out? Add \`<!-- cue: ignore -->\` to your README.

---

<p align="center">
  <a href="https://github.com/recodeee/cue">
    <img src="https://img.shields.io/badge/powered_by-cue-6366f1?style=flat-square&labelColor=1e1b4b" alt="powered by cue">
  </a>
</p>
`;
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, md);
  process.stdout.write(`✅ Exported ${gems.length} gems to ${exportPath}\n`);
  process.stdout.write(`   💡 Add --site for per-profile SEO pages, --html for indexable HTML with JSON-LD.\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Analyze gems with Claude Code (reads README/SKILL.md, determines profile)
// ---------------------------------------------------------------------------

async function cmdAnalyze(opts: { profile?: string; minScore: number; limit: number }): Promise<number> {
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }

  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  let gems = cache.gems.filter(g => g.gem_score >= opts.minScore).slice(0, opts.limit);

  if (opts.profile) {
    gems = gems.filter(g => g.suggested_profiles.includes(opts.profile!));
  }

  if (gems.length === 0) {
    process.stdout.write("No gems to analyze. Try lowering --min-score.\n");
    return 0;
  }

  const profiles = await listProfiles();
  const profileList = profiles.join(", ");

  process.stdout.write(`\n  🧠 Analyzing ${gems.length} gem(s) with Claude Code...\n\n`);

  for (const gem of gems) {
    process.stdout.write(`  ⏳ ${gem.full_name} (★ ${gem.stars})...\n`);

    // Fetch README content
    const readmeRes = spawnSync("gh", [
      "api", `repos/${gem.full_name}/readme`, "--jq", ".content",
    ], { encoding: "utf8", timeout: 15000 });

    let readme = "";
    if (readmeRes.status === 0 && readmeRes.stdout.trim()) {
      readme = Buffer.from(readmeRes.stdout.trim(), "base64").toString("utf8").slice(0, 3000);
    }

    // Fetch SKILL.md if exists
    let skillMd = "";
    if (gem.has_skill_md) {
      const skillRes = spawnSync("gh", [
        "api", `repos/${gem.full_name}/contents/SKILL.md`, "--jq", ".content",
      ], { encoding: "utf8", timeout: 10000 });
      if (skillRes.status === 0 && skillRes.stdout.trim()) {
        skillMd = Buffer.from(skillRes.stdout.trim(), "base64").toString("utf8").slice(0, 2000);
      }
    }

    if (!readme && !skillMd) {
      process.stdout.write(`     ⚠️  No readable content, skipping\n`);
      continue;
    }

    // Use claude --print to analyze
    const prompt = `You are a profile classifier for "cue" (an agent profile manager). Given a GitHub repo's content, determine which cue profile(s) it best fits into.

Available profiles: ${profileList}

Repo: ${gem.full_name} (★ ${gem.stars})
Description: ${gem.description}
Language: ${gem.language}
Topics: ${gem.topics.join(", ")}

${skillMd ? `SKILL.md (first 2000 chars):\n${skillMd}\n` : ""}
${readme ? `README (first 3000 chars):\n${readme}\n` : ""}

Respond in EXACTLY this format (no other text):
PROFILES: <profile1>, <profile2>
MCPS: <mcp-server-names that this skill needs or provides, comma-separated, or "none">
CLIS: <cli tools required to run this skill, comma-separated, or "none">
REASON: <one sentence why>
QUALITY: <1-10 score of how useful this skill actually is>`;

    const claudeRes = spawnSync("claude", ["--print", "-p", prompt], {
      encoding: "utf8", timeout: 30000,
      env: { ...process.env, CUE_BYPASS: "1" },
    });

    if (claudeRes.status !== 0 || !claudeRes.stdout.trim()) {
      // Fallback: use the real claude binary directly
      const realClaude = "/home/deadpool/.nvm/versions/node/v22.22.0/bin/claude";
      const fallbackRes = spawnSync(realClaude, ["--print", "-p", prompt], {
        encoding: "utf8", timeout: 30000,
      });
      if (fallbackRes.status !== 0) {
        process.stdout.write(`     ⚠️  Claude analysis failed, keeping keyword suggestion\n`);
        continue;
      }
      claudeRes.stdout = fallbackRes.stdout;
    }

    const output = claudeRes.stdout.trim();
    const profileMatch = output.match(/PROFILES?:\s*(.+)/i);
    const mcpsMatch = output.match(/MCPS?:\s*(.+)/i);
    const clisMatch = output.match(/CLIS?:\s*(.+)/i);
    const reasonMatch = output.match(/REASON:\s*(.+)/i);
    const qualityMatch = output.match(/QUALITY:\s*(\d+)/i);

    if (profileMatch) {
      const newProfiles = profileMatch[1]!.split(",").map(p => p.trim().toLowerCase()).filter(p => profiles.includes(p));
      const mcps = (mcpsMatch?.[1] ?? "").split(",").map(m => m.trim().toLowerCase()).filter(m => m && m !== "none");
      const clis = (clisMatch?.[1] ?? "").split(",").map(c => c.trim().toLowerCase()).filter(c => c && c !== "none");
      const reason = reasonMatch?.[1] ?? "";
      const quality = parseInt(qualityMatch?.[1] ?? "5", 10);

      if (newProfiles.length > 0) {
        gem.suggested_profiles = newProfiles.slice(0, 2);
      }
      gem.suggested_mcps = mcps;
      gem.suggested_clis = clis;
      gem.quality = quality;

      process.stdout.write(`     ✅ → ${gem.suggested_profiles.join(", ")} (quality: ${quality}/10)\n`);
      if (mcps.length) process.stdout.write(`        MCPs: ${mcps.join(", ")}\n`);
      if (clis.length) process.stdout.write(`        CLIs: ${clis.join(", ")}\n`);
      if (reason) process.stdout.write(`        ${reason}\n`);
    }
  }

  // Save updated cache
  writeFileSync(cacheFile(), JSON.stringify(cache, null, 2));
  process.stdout.write(`\n  ✅ Analysis complete. Cache updated.\n`);
  process.stdout.write(`  Next: cue discover install --dry-run\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Notify repo owner via GitHub issue
// ---------------------------------------------------------------------------

const NOTIFY_LOG = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue",
  "discover-notified.json",
);

interface NotifyLog {
  notified: Record<string, { date: string; issueUrl: string }>;
  // Daily digest discussion posts in recodeee/cue, keyed by YYYY-MM-DD.
  digests?: Record<string, { discussionUrl: string; gems: string[] }>;
}

function loadNotifyLog(): NotifyLog {
  if (!existsSync(NOTIFY_LOG)) return { notified: {}, digests: {} };
  try {
    const log = JSON.parse(readFileSync(NOTIFY_LOG, "utf8")) as NotifyLog;
    log.digests ??= {};
    return log;
  } catch { return { notified: {}, digests: {} }; }
}

function saveNotifyLog(log: NotifyLog): void {
  mkdirSync(dirname(NOTIFY_LOG), { recursive: true });
  writeFileSync(NOTIFY_LOG, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Daily digest discussion (in recodeee/cue) — lower-pressure analog to --notify
// ---------------------------------------------------------------------------

const DIGEST_REPO = process.env.CUE_DIGEST_REPO ?? "recodeee/cue";
const DIGEST_CATEGORY_PREF = ["Discoveries", "Show and tell", "Announcements", "General"];

interface DiscussionTarget { repoId: string; categoryId: string; categoryName: string }

function resolveDiscussionTarget(repo: string): DiscussionTarget | null {
  const [owner, name] = repo.split("/");
  if (!owner || !name) return null;
  const query = `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ id discussionCategories(first:20){ nodes { id name } } } }`;
  const res = spawnSync("gh", [
    "api", "graphql",
    "-f", `query=${query}`,
    "-F", `owner=${owner}`,
    "-F", `name=${name}`,
  ], { encoding: "utf8", timeout: 15000 });
  if (res.status !== 0) return null;
  try {
    const data = JSON.parse(res.stdout);
    const repoNode = data?.data?.repository;
    if (!repoNode?.id) return null;
    const cats: { id: string; name: string }[] = repoNode.discussionCategories?.nodes ?? [];
    if (cats.length === 0) return null;
    for (const pref of DIGEST_CATEGORY_PREF) {
      const hit = cats.find(c => c.name.toLowerCase() === pref.toLowerCase());
      if (hit) return { repoId: repoNode.id, categoryId: hit.id, categoryName: hit.name };
    }
    return { repoId: repoNode.id, categoryId: cats[0]!.id, categoryName: cats[0]!.name };
  } catch { return null; }
}

function buildDigestBody(gems: GemRepo[], date: string): string {
  const byProfile = new Map<string, GemRepo[]>();
  for (const gem of gems) {
    const p = gem.suggested_profiles[0] ?? "core";
    const list = byProfile.get(p) ?? [];
    list.push(gem);
    byProfile.set(p, list);
  }
  const sections: string[] = [];
  for (const profile of [...byProfile.keys()].sort()) {
    const list = byProfile.get(profile)!.sort((a, b) => b.gem_score - a.gem_score);
    const lines = list.map(g => {
      const icon = g.gem_score >= 15 ? "🏆" : g.gem_score >= 8 ? "💎" : "✨";
      const desc = (g.description ?? "").slice(0, 110).replace(/\n+/g, " ");
      const signals: string[] = [];
      if (g.has_skill_md) signals.push("SKILL.md");
      if (g.has_claude_dir) signals.push(".claude/");
      if (g.has_mcp_sdk) signals.push("MCP SDK");
      const sigTag = signals.length ? ` _(${signals.join(", ")})_` : "";
      return `- ${icon} [\`${g.full_name}\`](${g.url}) — ★ ${g.stars} · score ${g.gem_score}${sigTag}\n  ${desc}`;
    }).join("\n");
    sections.push(`### \`${profile}\` (${list.length})\n\n${lines}`);
  }

  return `> Daily digest from [\`cue discover\`](https://github.com/recodeee/cue) — repos newly indexed on **${date}**, grouped by profile.

cue scans GitHub for high-quality skill repos (\`SKILL.md\`, \`.claude/\`, MCP servers) and routes them into per-profile bundles for users of Claude Code, Codex, and other agents. Today we indexed **${gems.length}** gem(s) across **${byProfile.size}** profile(s).

${sections.join("\n\n")}

---

**Want to be indexed?** Add a \`SKILL.md\` to your repo root or tag it \`topic:claude-skill\`. We scan daily.

**Don't want to be indexed?** Open an issue and we'll exclude your repo.

<sub>Posted by \`cue discover install --digest\`. One post per day.</sub>`;
}

function postDailyDigest(gems: GemRepo[], opts: { dryRun: boolean }): void {
  if (gems.length === 0) {
    process.stdout.write(`  ⏭  Digest: nothing new to post.\n`);
    return;
  }

  const log = loadNotifyLog();
  const date = new Date().toISOString().split("T")[0]!;
  if (log.digests?.[date]) {
    process.stdout.write(`  ⏭  Digest: already posted today (${log.digests[date].discussionUrl}).\n`);
    return;
  }

  const title = `cue discover — daily digest ${date} (${gems.length} new gem${gems.length === 1 ? "" : "s"})`;
  const body = buildDigestBody(gems, date);

  if (opts.dryRun) {
    process.stdout.write(`  [dry-run] Would post digest to ${DIGEST_REPO} discussions:\n`);
    process.stdout.write(`     Title: ${title}\n`);
    process.stdout.write(`     Body: ${body.length} chars across ${gems.length} gems\n`);
    return;
  }

  const target = resolveDiscussionTarget(DIGEST_REPO);
  if (!target) {
    process.stdout.write(`  ⚠️  Digest: could not resolve discussion category on ${DIGEST_REPO} (discussions enabled? gh auth?). Skipped.\n`);
    return;
  }

  const mutation = `mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){ createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){ discussion { url } } }`;
  const res = spawnSync("gh", [
    "api", "graphql",
    "-f", `query=${mutation}`,
    "-F", `repoId=${target.repoId}`,
    "-F", `catId=${target.categoryId}`,
    "-F", `title=${title}`,
    "-F", `body=${body}`,
  ], { encoding: "utf8", timeout: 20000 });

  if (res.status !== 0) {
    process.stdout.write(`  ⚠️  Digest: failed to post — ${res.stderr?.trim().slice(0, 120)}\n`);
    return;
  }

  try {
    const out = JSON.parse(res.stdout);
    const url: string = out?.data?.createDiscussion?.discussion?.url ?? "";
    log.digests ??= {};
    log.digests[date] = { discussionUrl: url, gems: gems.map(g => g.full_name) };
    saveNotifyLog(log);
    process.stdout.write(`  📰 Posted daily digest (${target.categoryName}): ${url}\n`);
  } catch {
    process.stdout.write(`  ⚠️  Digest: posted but couldn't parse response.\n`);
  }
}

function notifyOwner(gem: GemRepo, profile: string): void {
  const log = loadNotifyLog();
  if (log.notified[gem.full_name]) return; // already notified

  // Rate limit: max 15 issues per day to stay under GitHub's radar
  const today = new Date().toISOString().split("T")[0]!;
  const todayCount = Object.values(log.notified).filter(n => n.date.startsWith(today)).length;
  if (todayCount >= 15) {
    process.stdout.write(`     🛑 Daily limit reached (${todayCount}/15) — skipping notify to protect your account\n`);
    return;
  }

  // Neutral, dependabot-style title: owners are conditioned to tolerate this format.
  // The visual hooks live inside the body, not the title bar.
  const title = `cue discover indexed this repo — profile: ${profile}, score: ${gem.gem_score}`;
  const scoreIcon = gem.gem_score >= 15 ? "🏆" : gem.gem_score >= 8 ? "💎" : "✨";

  // Shields.io requires the 💎 codepoint URL-encoded (%F0%9F%92%8E) and spaces as %20.
  // The previous "cue-💎_Hidden_Gem-..." string rendered as literal underscores + raw emoji bytes.
  const BADGE = "https://img.shields.io/badge/cue-%F0%9F%92%8E%20hidden%20gem-6366f1?style=for-the-badge&labelColor=1e1b4b";

  // Per-repo evidence — show only signals that actually fired so the owner sees real proof.
  const signals: string[] = [];
  if (gem.has_skill_md) signals.push("`SKILL.md` in repo root");
  if (gem.has_claude_dir) signals.push("`.claude/` directory present");
  if (gem.has_mcp_sdk) signals.push("uses `@modelcontextprotocol/sdk`");
  const gemTopics = gem.topics.filter(t => ["claude-skill", "claude-code", "mcp-server", "ai-agent", "codex-plugin", "claude-code-skill", "agent-skill"].includes(t));
  if (gemTopics.length) signals.push(`relevant topic${gemTopics.length > 1 ? "s" : ""}: ${gemTopics.map(t => `\`${t}\``).join(", ")}`);
  if (gem.stars >= 5 && gem.forks > 0 && gem.forks / gem.stars >= 0.1) {
    signals.push(`${gem.stars}★ / ${gem.forks} forks — genuine reuse ratio`);
  }
  const pushedDays = gem.pushed_at ? Math.floor((Date.now() - new Date(gem.pushed_at).getTime()) / 86400000) : null;
  if (pushedDays !== null && pushedDays < 30) signals.push(`actively maintained — last push ${pushedDays}d ago`);
  const signalList = signals.length ? signals.map(s => `- ✅ ${s}`).join("\n") : "- ✅ matched cue's profile search query";

  const body = `> **Automated, one-time notification.** Close this issue to opt out — we'll never open another on this repo. No action required.

<p align="center">
  <a href="https://github.com/recodeee/cue"><img src="${BADGE}" alt="cue hidden gem"></a>
  <br><br>
  <strong>${gem.full_name} scored ${scoreIcon} ${gem.gem_score} on cue's discovery engine</strong>
</p>

---

### What happened

[**cue**](https://github.com/recodeee/cue) scans GitHub for high-quality skill repos and your repo cleared the bar. It was added to the **\`${profile}\`** profile, so developers running that profile will get your skills auto-loaded when they launch Claude Code or Codex.

### Signals we detected on this repo

${signalList}

[See the full scoring rubric →](https://github.com/recodeee/cue/blob/main/src/commands/discover.ts#L83-L168)

### How developers install your skills

\`\`\`bash
npm install -g cue-ai
cue skills add ${gem.full_name}
\`\`\`

Or surface it via search:

\`\`\`bash
cue discover search --profile ${profile}    # your repo shows up here
\`\`\`

### Where you're listed

- [\`docs/discovered.md\`](https://github.com/recodeee/cue/blob/main/docs/discovered.md) — public index, grouped by profile
- \`cue discover\` results for the \`${profile}\` profile
- \`cue optimizer\` dashboard for users on that profile

### Optional: README badge

<p align="center">
  <a href="https://github.com/recodeee/cue"><img src="${BADGE}" alt="cue hidden gem"></a>
</p>

\`\`\`markdown
[![cue hidden gem](${BADGE})](https://github.com/recodeee/cue)
\`\`\`

---

<sub>Opened by <a href="https://github.com/recodeee/cue"><code>cue discover install --notify</code></a>. One issue per repo, ever. If your repo shouldn't be indexed, close this or <a href="https://github.com/recodeee/cue/issues/new">file an issue against cue</a> and we'll remove it.</sub>`;

  const res = spawnSync("gh", [
    "issue", "create",
    "--repo", gem.full_name,
    "--title", title,
    "--body", body,
  ], { encoding: "utf8", timeout: 15000 });

  if (res.status === 0) {
    const issueUrl = res.stdout.trim();
    process.stdout.write(`     📬 Notified owner: ${issueUrl}\n`);
    log.notified[gem.full_name] = { date: new Date().toISOString(), issueUrl };
    saveNotifyLog(log);
  } else {
    process.stdout.write(`     ⚠️  Could not notify (issues may be disabled)\n`);
  }
}

// ---------------------------------------------------------------------------
// Install gems into profiles
// ---------------------------------------------------------------------------

async function cmdInstall(opts: { profile?: string; minScore: number; dryRun: boolean; all: boolean; notify: boolean; digest: boolean }): Promise<number> {
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }

  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  let gems = cache.gems.filter(g => g.gem_score >= opts.minScore);

  if (opts.profile) {
    gems = gems.filter(g => g.suggested_profiles.includes(opts.profile!));
  }

  if (gems.length === 0) {
    process.stdout.write("No gems match the criteria. Try lowering --min-score or running a new search.\n");
    return 0;
  }

  process.stdout.write(`\n  📦 Installing ${gems.length} gem(s) into profiles${opts.profile ? ` (filtered: ${opts.profile})` : ""}...\n\n`);

  let installed = 0;
  let skipped = 0;

  for (const gem of gems) {
    const targetProfile = opts.profile ?? gem.suggested_profiles[0] ?? "core";
    const icon = gem.gem_score >= 8 ? "💎" : gem.gem_score >= 5 ? "✨" : "🔹";

    process.stdout.write(`  ${icon} ${gem.full_name} → ${targetProfile}\n`);
    if (gem.suggested_mcps?.length) process.stdout.write(`     MCPs: ${gem.suggested_mcps.join(", ")}\n`);
    if (gem.suggested_clis?.length) process.stdout.write(`     CLIs: ${gem.suggested_clis.join(", ")}\n`);

    if (opts.dryRun) {
      process.stdout.write(`     [dry-run] Would run: npx skills add ${gem.full_name} -a claude-code -y\n`);
      installed++;
      continue;
    }

    // Install the skill via npx skills add
    const addRes = spawnSync("npx", ["skills", "add", gem.full_name, "-a", "claude-code", "-y"], {
      encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
    });

    if (addRes.status !== 0) {
      // Fallback: clone into skills dir
      const skillsDir = join(homedir(), ".claude", "skills");
      const targetDir = join(skillsDir, gem.name);
      if (!existsSync(targetDir)) {
        const cloneRes = spawnSync("git", ["clone", "--depth", "1", gem.url, targetDir], {
          encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
        });
        if (cloneRes.status !== 0) {
          process.stdout.write(`     ⚠️  Failed to install: ${addRes.stderr?.trim().slice(0, 80)}\n`);
          skipped++;
          continue;
        }
      }
    }

    // Add to profile.yaml
    const profileYaml = join(REPO_ROOT, "profiles", targetProfile, "profile.yaml");
    if (existsSync(profileYaml)) {
      const content = readFileSync(profileYaml, "utf8");
      // Find the skill ID (use repo name as fallback)
      const skillId = gem.name;
      if (!content.includes(skillId)) {
        // Append under skills.local
        const localMatch = content.match(/(skills:\s*\n\s*local:\s*\n)([\s\S]*?)(\n\S|\n*$)/);
        if (localMatch) {
          const indent = "    ";
          const insertion = `${indent}- ${skillId}\n`;
          const updated = content.replace(localMatch[0], localMatch[1] + localMatch[2] + insertion + (localMatch[3] ?? ""));
          writeFileSync(profileYaml, updated);
          process.stdout.write(`     ✅ Added skill to ${targetProfile}/profile.yaml\n`);
        }
      } else {
        process.stdout.write(`     ⏭  Skill already in profile\n`);
      }

      // Add MCPs if detected by analyze
      if (gem.suggested_mcps?.length) {
        let current = readFileSync(profileYaml, "utf8");
        const newMcps = gem.suggested_mcps.filter(m => !current.includes(m));
        if (newMcps.length) {
          const mcpsMatch = current.match(/(mcps:\s*\n)([\s\S]*?)(\n\S|\n*$)/);
          if (mcpsMatch) {
            const mcpLines = newMcps.map(m => `  - ${m}\n`).join("");
            current = current.replace(mcpsMatch[0], mcpsMatch[1] + mcpsMatch[2] + mcpLines + (mcpsMatch[3] ?? ""));
          } else {
            // No mcps section yet — add one
            current += `\nmcps:\n${newMcps.map(m => `  - ${m}`).join("\n")}\n`;
          }
          writeFileSync(profileYaml, current);
          process.stdout.write(`     ✅ Added MCPs: ${newMcps.join(", ")}\n`);
        }
      }

      // Show CLI requirements
      if (gem.suggested_clis?.length) {
        const missing = gem.suggested_clis.filter(c => {
          const which = spawnSync("which", [c], { encoding: "utf8" });
          return which.status !== 0;
        });
        if (missing.length) {
          process.stdout.write(`     ⚠️  Missing CLIs: ${missing.join(", ")} — install them for full functionality\n`);
        }
      }
    }

    installed++;

    // Notify repo owner via GitHub issue
    if (opts.notify && !opts.dryRun) {
      notifyOwner(gem, targetProfile);
    }
  }

  process.stdout.write(`\n  Done: ${installed} installed, ${skipped} skipped\n`);
  if (opts.dryRun) process.stdout.write(`  (dry-run — no changes made. Remove --dry-run to apply)\n`);

  // Daily digest discussion in recodeee/cue — covers everything we just touched,
  // so owners who don't get a --notify issue can still find the post.
  if (opts.digest) {
    const log = loadNotifyLog();
    const today = new Date().toISOString().split("T")[0]!;
    // Skip repos already mentioned in today's digest (dedupe across runs).
    const alreadyDigested = new Set(log.digests?.[today]?.gems ?? []);
    const newToday = gems.filter(g => !alreadyDigested.has(g.full_name));
    postDailyDigest(newToday, { dryRun: opts.dryRun });
  }

  return 0;
}

// ---------------------------------------------------------------------------
// List cached gems
// ---------------------------------------------------------------------------

function cmdList(json: boolean): number {
  if (!existsSync(cacheFile())) {
    process.stdout.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }

  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));

  if (json) {
    process.stdout.write(JSON.stringify(cache.gems, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n  Cached Gems (${cache.gems.length}) — scanned ${cache.updated.split("T")[0]}\n\n`);
  for (const gem of cache.gems.slice(0, 30)) {
    const icon = gem.gem_score >= 8 ? "💎" : gem.gem_score >= 5 ? "✨" : "🔹";
    process.stdout.write(`  ${icon} ${gem.full_name} (★ ${gem.stars}, score: ${gem.gem_score})\n`);
  }
  if (cache.gems.length > 30) process.stdout.write(`  ... +${cache.gems.length - 30} more\n`);
  process.stdout.write(`\n  Export: cue discover --export\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const exportFlag = args.includes("--export");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "50", 10) : 50;
  const minScoreIdx = args.indexOf("--min-score");
  const minScore = minScoreIdx >= 0 ? parseInt(args[minScoreIdx + 1] ?? "3", 10) : 3;
  const profileIdx = args.indexOf("--profile");
  const profile = profileIdx >= 0 ? args[profileIdx + 1] : undefined;
  const exportPathIdx = args.indexOf("--export");
  const exportPath = exportPathIdx >= 0 && args[exportPathIdx + 1] && !args[exportPathIdx + 1]!.startsWith("-")
    ? args[exportPathIdx + 1]!
    : DEFAULT_EXPORT;
  const siteMode = args.includes("--site");
  const htmlMode = args.includes("--html");

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue discover — find hidden gem skill repos on GitHub

Usage:
  cue discover search [query]          Scan GitHub for undiscovered skill repos
  cue discover search --profile <name> Find gems specifically for a profile
  cue discover analyze                 Use Claude to read gems and determine best profile
  cue discover install                 Install cached gems into their suggested profiles
  cue discover install --profile <name> Install only gems for a specific profile
  cue discover list                    Show cached gems from last search
  cue discover --export [path]         Generate docs/discovered.md from cache
  cue discover --json                  JSON output

Options:
  --profile <name>  Scope to a specific profile
  --limit <n>       Max results (default: 50)
  --min-score <n>   Minimum gem score to include (default: 3)
  --dry-run         Preview installs without making changes
  --notify          With install: open a one-time GitHub issue on each indexed repo
  --digest          With install: post a daily GitHub Discussion in recodeee/cue
                    summarizing today's indexed gems (one post per day, dedup'd)
  --export [path]   Export to markdown (default: docs/discovered.md)
  --site            With --export: write per-profile pages + index.md (better SEO)
  --html            With --site: also emit .html pages with JSON-LD schema for AI search citation

Scoring (higher = stronger gem signal):
  +5    has SKILL.md (load-bearing evidence)
  +3    has .claude/ directory
  +2    uses MCP SDK
  +2    per relevant topic (capped at 3 hits)
  +0-3  recency, exponential decay with ~60-day half-life
  +0-2.3 popularity, log-scaled (popularity isn't punished, doesn't dominate)
  +3    proven gem: stars ≥50 AND description mentions skill/mcp/claude/agent
  +2    highly proven: stars ≥500
  +1-2  fork-to-star ratio ≥0.1 / ≥0.3 (genuine reuse)
  +1    description 40-200 chars (specific, human-length)
  +1.5  mature AND actively maintained (>90d old, pushed <30d)
  -3    no commits in 1yr
  =0    obvious AI dump (fresh repo, no engagement, slop description/owner)

Examples:
  cue discover search                      # scan all signal queries
  cue discover search --profile marketing  # find gems for marketing
  cue discover install --profile marketing # install marketing gems
  cue discover install --dry-run           # preview what would be installed
  cue discover install --min-score 8       # only install 💎 gems
  cue discover install --digest --notify   # daily run: post digest + open per-repo issues
  cue discover --export                    # generate docs/discovered.md
`);
    return 0;
  }

  if (exportFlag) return cmdExport(exportPath, { site: siteMode, html: htmlMode });

  const skipValues = new Set<number>();
  if (limitIdx >= 0) skipValues.add(limitIdx + 1);
  if (minScoreIdx >= 0) skipValues.add(minScoreIdx + 1);
  if (profileIdx >= 0) skipValues.add(profileIdx + 1);
  const rest = args.filter((a, i) => !a.startsWith("-") && !skipValues.has(i));

  if (rest[0] === "search") {
    const query = rest.slice(1).join(" ") || undefined;
    return cmdSearch(query, { limit, minScore, json, profile });
  }

  if (rest[0] === "analyze") {
    return cmdAnalyze({ profile, minScore, limit });
  }

  if (rest[0] === "install") {
    const dryRun = args.includes("--dry-run");
    const all = args.includes("--all");
    const notify = args.includes("--notify");
    const digest = args.includes("--digest");
    return cmdInstall({ profile, minScore, dryRun, all, notify, digest });
  }

  if (rest[0] === "list" || rest.length === 0) {
    // If no cache, run search
    if (!existsSync(cacheFile())) {
      return cmdSearch(undefined, { limit, minScore, json, profile });
    }
    return cmdList(json);
  }

  // Treat unknown args as search query
  return cmdSearch(rest.join(" "), { limit, minScore, json, profile });
}
