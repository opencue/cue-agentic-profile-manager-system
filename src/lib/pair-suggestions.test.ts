import { describe, expect, test } from "bun:test";

import {
  computeAffinityMap,
  parseComposite,
  suggestPartnersFor,
  suggestionsByProfile,
} from "./pair-suggestions";

const row = (profile: string, ts = "2026-05-28T00:00:00Z"): string =>
  JSON.stringify({ ts, profile, cwd: "/x", session_id: `${ts}-${profile}` });

const lines = (...rows: string[]) => () => rows;

describe("parseComposite", () => {
  test("splits on + and trims empties", () => {
    expect(parseComposite("a+b+c")).toEqual(["a", "b", "c"]);
    expect(parseComposite("a")).toEqual(["a"]);
    expect(parseComposite("+a+ +b+")).toEqual(["a", "b"]);
    expect(parseComposite("")).toEqual([]);
  });
});

describe("computeAffinityMap", () => {
  test("ignores rows without a profile field", () => {
    const reader = lines(
      JSON.stringify({ ts: "t", cwd: "/x", session_id: "s" }), // no profile
      row("a"),
    );
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(1);
  });

  test("counts solo picks toward `picks` but never as partners", () => {
    const reader = lines(row("a"), row("a"), row("a"));
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(3);
    expect(m.get("a")?.partners.size).toBe(0);
  });

  test("composite picks contribute pairwise co-occurrence in both directions", () => {
    const reader = lines(row("a+b"), row("a+b"), row("a+c"));
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(3);
    expect(m.get("b")?.picks).toBe(2);
    expect(m.get("c")?.picks).toBe(1);
    expect(m.get("a")?.partners.get("b")).toBe(2);
    expect(m.get("a")?.partners.get("c")).toBe(1);
    expect(m.get("b")?.partners.get("a")).toBe(2);
    expect(m.get("c")?.partners.get("a")).toBe(1);
  });

  test("malformed JSONL lines are skipped, valid ones still aggregate", () => {
    const reader = lines("{this is not json", row("a+b"), "", "   ", row("a"));
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(2);
    expect(m.get("b")?.picks).toBe(1);
  });
});

describe("suggestPartnersFor", () => {
  test("returns top partners sorted by affinity DESC (after default 0.5 floor)", () => {
    // a picked 15 times: 9 with b (60%, passes), 5 with c (33%, below floor),
    //                    1 with d (7%, below floor). Default minAffinity=0.5
    //                    so only b makes the cut.
    const reader = lines(
      ...Array(9).fill(row("a+b")),
      ...Array(5).fill(row("a+c")),
      row("a+d"),
    );
    const m = computeAffinityMap(reader);
    const sug = suggestPartnersFor("a", m);
    expect(sug.map((s) => s.name)).toEqual(["b"]);
    expect(sug[0]!.affinity).toBeCloseTo(9 / 15, 3);
  });

  test("sort tie-break: equal affinity → higher count, then alpha", () => {
    // a picked 4 times: 2 with b (50%), 2 with c (50%), 2 with d (50%) —
    // all three tie on affinity 0.5. Tie-break is count DESC then name asc.
    // All have count=2, so order should be alphabetical: b, c, d.
    const reader = lines(
      row("a+b+c"),
      row("a+b+c"),
      row("a+d"),
      row("a+d"),
    );
    const m = computeAffinityMap(reader);
    const sug = suggestPartnersFor("a", m);
    expect(sug.map((s) => s.name)).toEqual(["b", "c", "d"]);
  });

  test("filters by minCount and minAffinity", () => {
    const reader = lines(
      ...Array(9).fill(row("a+b")),
      ...Array(5).fill(row("a+c")),
      row("a+d"),
    );
    const m = computeAffinityMap(reader);
    // Force c out via affinity floor: c affinity is 5/15 ≈ 0.33
    expect(suggestPartnersFor("a", m, { minAffinity: 0.4 }).map((s) => s.name)).toEqual(["b"]);
    // Force d in via count floor relaxation (d count=1)
    expect(
      suggestPartnersFor("a", m, { minCount: 1, minAffinity: 0 }).map((s) => s.name),
    ).toEqual(["b", "c", "d"]);
  });

  test("returns empty when profile has fewer picks than minCount", () => {
    const reader = lines(row("a+b"));
    const m = computeAffinityMap(reader);
    expect(suggestPartnersFor("a", m, { minCount: 5 })).toEqual([]);
  });

  test("returns empty for unknown profile", () => {
    const m = computeAffinityMap(lines(row("a")));
    expect(suggestPartnersFor("ghost", m)).toEqual([]);
  });

  test("respects limit", () => {
    // a picked 3 times, each composite includes one of b/c/d — each partner
    // has count=1, affinity=1/3 ≈ 0.33. We override the floors to admit
    // all three so the limit truncation is the only filter left.
    const reader = lines(row("a+b"), row("a+c"), row("a+d"));
    const m = computeAffinityMap(reader);
    const relaxed = { minCount: 1, minAffinity: 0 };
    expect(suggestPartnersFor("a", m, relaxed).length).toBe(3);
    expect(suggestPartnersFor("a", m, { ...relaxed, limit: 2 }).length).toBe(2);
  });
});

describe("suggestionsByProfile", () => {
  test("returns one entry per profile with non-empty suggestions", () => {
    const reader = lines(
      ...Array(3).fill(row("a+b")),
      ...Array(3).fill(row("a+b")),
      row("solo"),
    );
    const m = computeAffinityMap(reader);
    const all = suggestionsByProfile(m);
    expect([...all.keys()].sort()).toEqual(["a", "b"]);
    expect(all.get("a")?.[0]?.name).toBe("b");
    expect(all.get("b")?.[0]?.name).toBe("a");
    expect(all.get("solo")).toBeUndefined();
  });
});
