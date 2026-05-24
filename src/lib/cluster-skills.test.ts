/**
 * Tests for the deterministic clustering lib.
 *
 * Covers: realistic skill clustering, stopword/IDF behavior, edge cases,
 * the jaccard helper, and the skillFrequency promote-to-core report.
 */

import { describe, expect, test } from "bun:test";
import {
  clusterByKeywords,
  clusterByEmbeddings,
  unclustered,
  jaccard,
  skillFrequency,
  type ClusterItem,
  type EmbedProvider,
} from "./cluster-skills";

describe("clusterByKeywords — realistic skill grouping", () => {
  test("groups reasoning/debate gems under a shared term", () => {
    // All four reasoning items mention "reasoning" — the cluster term should
    // surface that, and the storefront item must not get pulled in.
    const items: ClusterItem[] = [
      { id: "a", text: "Multi-perspective reasoning council with advisors" },
      { id: "b", text: "Reasoning loop via structured debate roles" },
      { id: "c", text: "AI reasoning partner with calibrated pushback" },
      { id: "d", text: "Reasoning advisory board: get second opinions" },
      { id: "e", text: "Storefront ecommerce shop cart checkout" },
    ];
    const clusters = clusterByKeywords(items, { minSize: 3 });
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const reasoning = clusters.find(c => c.items.some(i => i.id === "a"));
    expect(reasoning).toBeDefined();
    const ids = reasoning!.items.map(i => i.id);
    const reasoningHit = ids.filter(id => ["a","b","c","d"].includes(id)).length;
    expect(reasoningHit).toBeGreaterThanOrEqual(3);
    expect(reasoning!.items.some(i => i.id === "e")).toBe(false);
  });

  test("respects minSize — no cluster of 2 items is returned", () => {
    const items: ClusterItem[] = [
      { id: "x1", text: "memory session smart markdown manager" },
      { id: "x2", text: "session memory toolkit for context" },
      { id: "y1", text: "completely unrelated thing" },
    ];
    const clusters = clusterByKeywords(items, { minSize: 3 });
    expect(clusters.length).toBe(0);
  });

  test("filters out terms that appear in >50% of corpus (too generic)", () => {
    // 4 items, all share "thingie" → docfreq 4/4 → filtered as too generic
    const items: ClusterItem[] = [
      { id: "a", text: "thingie alpha beta" },
      { id: "b", text: "thingie alpha gamma" },
      { id: "c", text: "thingie delta epsilon" },
      { id: "d", text: "thingie zeta eta" },
    ];
    const clusters = clusterByKeywords(items, { minSize: 3 });
    // "thingie" should NOT be a cluster (too generic)
    expect(clusters.find(c => c.term === "thingie")).toBeUndefined();
  });

  test("greedy assignment: each item appears in at most one cluster", () => {
    const items: ClusterItem[] = [
      { id: "a", text: "session memory recall management" },
      { id: "b", text: "session memory snapshot recall" },
      { id: "c", text: "session memory archive management" },
      { id: "d", text: "memory management with custom tools" },
      { id: "e", text: "memory management toolkit advanced" },
      { id: "f", text: "memory management for sessions" },
    ];
    const clusters = clusterByKeywords(items, { minSize: 3 });
    const seenIds = new Set<string>();
    for (const c of clusters) {
      for (const item of c.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
      }
    }
  });

  test("returns empty for empty input", () => {
    expect(clusterByKeywords([], { minSize: 3 })).toEqual([]);
  });

  test("returns empty when no terms repeat enough", () => {
    const items: ClusterItem[] = [
      { id: "a", text: "wholly distinct alpha" },
      { id: "b", text: "wholly distinct beta" },
      { id: "c", text: "wholly distinct gamma" },
    ];
    // Each item has unique tokens after stopwords; nothing repeats 3 times.
    const clusters = clusterByKeywords(items, { minSize: 3 });
    expect(clusters.length).toBe(0);
  });

  test("stopwords (claude, code, skill, ai) don't form clusters", () => {
    const items: ClusterItem[] = [
      { id: "a", text: "claude code skill AI agent for foo" },
      { id: "b", text: "claude code skill AI agent for bar" },
      { id: "c", text: "claude code skill AI agent for baz" },
    ];
    const clusters = clusterByKeywords(items, { minSize: 3 });
    // None of the stopwords should anchor a cluster
    for (const c of clusters) {
      expect(["claude", "code", "skill", "ai", "agent"]).not.toContain(c.term);
    }
  });
});

describe("unclustered — orphan detection", () => {
  test("returns items not assigned to any cluster", () => {
    const items: ClusterItem[] = [
      { id: "a", text: "deploy docker container" },
      { id: "b", text: "deploy docker registry" },
      { id: "c", text: "deploy docker secrets" },
      { id: "d", text: "wholly unrelated text" },
    ];
    const clusters = clusterByKeywords(items, { minSize: 3 });
    const orphans = unclustered(items, clusters);
    expect(orphans.map(i => i.id)).toEqual(["d"]);
  });
});

describe("jaccard — set similarity", () => {
  test("identical sets → 1.0", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });
  test("disjoint sets → 0.0", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0);
  });
  test("two empty sets → 1.0 (convention)", () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
  });
  test("partial overlap", () => {
    // intersection {b}, union {a,b,c} → 1/3
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });
});

describe("skillFrequency — promote-to-core report", () => {
  test("flags skills that appear in ≥3 profiles", () => {
    const profileSkills = {
      backend: ["auth", "logging", "metrics"],
      frontend: ["auth", "logging", "tailwind"],
      "go-api": ["auth", "logging", "grpc"],
      research: ["pubmed"],
      core: ["should-be-excluded"], // core is ignored
    };
    const result = skillFrequency(profileSkills, { minProfiles: 3 });
    const ids = result.map(r => r.skill);
    expect(ids).toContain("auth");
    expect(ids).toContain("logging");
    expect(ids).not.toContain("metrics");      // only 1 profile
    expect(ids).not.toContain("should-be-excluded"); // in core
  });

  test("orders by descending profile count", () => {
    const profileSkills = {
      a: ["x", "y"],
      b: ["x", "y"],
      c: ["x"],
      d: ["x", "y"],   // y in 3 profiles, x in 4
    };
    const result = skillFrequency(profileSkills, { minProfiles: 3 });
    expect(result[0]?.skill).toBe("x");
    expect(result[0]?.profiles.length).toBeGreaterThan(result[1]?.profiles.length ?? 0);
  });

  test("excludes `full` (it's a kitchen-sink, not a real profile)", () => {
    const profileSkills = {
      full: ["x", "y", "z"],
      a: ["x"],
      b: ["x"],
    };
    const result = skillFrequency(profileSkills, { minProfiles: 2 });
    // x is in a, b, and full — but full is excluded, so count is 2.
    expect(result.find(r => r.skill === "x")?.profiles).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Embedding clustering — stub provider so tests are offline + deterministic
// ---------------------------------------------------------------------------

/**
 * Each text gets a vector that lives close to the vectors of texts sharing its
 * "topic tag" (first word). Lets us assert grouping without calling Voyage.
 */
function topicTagProvider(): EmbedProvider {
  // Map first token → distinct unit vector. Two texts share a topic iff their
  // first token matches → cosine ≈ 1; otherwise cosine ≈ 0.
  const axisOf = (text: string): number => {
    const tag = text.toLowerCase().split(/\s+/)[0] ?? "";
    let h = 0;
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 64;
    return h;
  };
  return {
    async embed(texts) {
      const dim = 64;
      return texts.map(t => {
        const v = new Array(dim).fill(0);
        v[axisOf(t)] = 1;
        return v;
      });
    },
  };
}

describe("clusterByEmbeddings — semantic grouping with stub provider", () => {
  test("groups items sharing a topic tag, splits unrelated ones", async () => {
    const items: ClusterItem[] = [
      { id: "a", text: "memory recall and context for sessions" },
      { id: "b", text: "memory snapshot and prune across runs" },
      { id: "c", text: "memory archive for projects" },
      { id: "d", text: "shop checkout cart for storefront" },
      { id: "e", text: "shop product catalog and search" },
      { id: "f", text: "shop seller dashboard for marketplaces" },
    ];
    const clusters = await clusterByEmbeddings(items, {
      minSize: 3, provider: topicTagProvider(), threshold: 0.9,
    });
    expect(clusters.length).toBe(2);
    const memorySet = new Set(clusters.find(c => c.items.some(i => i.id === "a"))!.items.map(i => i.id));
    expect(memorySet).toEqual(new Set(["a", "b", "c"]));
    const shopSet = new Set(clusters.find(c => c.items.some(i => i.id === "d"))!.items.map(i => i.id));
    expect(shopSet).toEqual(new Set(["d", "e", "f"]));
  });

  test("respects minSize — clusters below threshold are dropped", async () => {
    const items: ClusterItem[] = [
      { id: "a", text: "memory recall sessions" },
      { id: "b", text: "memory snapshot prune" },     // pair only — under minSize=3
      { id: "c", text: "wholly distinct gamma alone" },
    ];
    const clusters = await clusterByEmbeddings(items, {
      minSize: 3, provider: topicTagProvider(), threshold: 0.9,
    });
    expect(clusters.length).toBe(0);
  });

  test("returns [] when fewer items than minSize (no API call needed)", async () => {
    let called = false;
    const probe: EmbedProvider = {
      async embed(texts) { called = true; return texts.map(() => [1, 0, 0]); },
    };
    const result = await clusterByEmbeddings(
      [{ id: "x", text: "anything" }],
      { minSize: 3, provider: probe },
    );
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  test("derives a cluster term from the most-frequent non-stopword unigram", async () => {
    const items: ClusterItem[] = [
      { id: "a", text: "memory recall sessions" },
      { id: "b", text: "memory snapshot" },
      { id: "c", text: "memory archive" },
    ];
    const clusters = await clusterByEmbeddings(items, {
      minSize: 3, provider: topicTagProvider(), threshold: 0.9,
    });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.term).toBe("memory");
  });
});
