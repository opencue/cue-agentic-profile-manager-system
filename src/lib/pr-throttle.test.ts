import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadDb, saveDb,
  isThrottled, canPostMore, todayCount,
  recordOpened, recordOptOut, recordSkipped, updateEntryState,
  filterByState, hasRecordedOptOut,
  DEFAULT_COOLDOWN_DAYS, DAILY_CAP,
} from "./pr-throttle";

let dbPath: string;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cue-throttle-"));
  dbPath = join(tmp, "pr-opened.json");
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("loadDb / saveDb", () => {
  test("missing file returns empty DB", () => {
    expect(loadDb(dbPath)).toEqual({ version: 1, history: [] });
  });

  test("save then load round-trips", () => {
    const db = recordOpened({ version: 1, history: [] }, {
      repo: "a/b", rulesFixed: ["R001"], prNumber: 1, prUrl: "https://example/pr/1", fork: "me/b", branch: "x",
    });
    saveDb(db, dbPath);
    expect(existsSync(dbPath)).toBe(true);
    const reloaded = loadDb(dbPath);
    expect(reloaded.history).toHaveLength(1);
    expect(reloaded.history[0]!.repo).toBe("a/b");
  });

  test("corrupt file is treated as empty (no throw)", () => {
    saveDb({ version: 99 as any, history: "not an array" as any }, dbPath);
    const reloaded = loadDb(dbPath);
    expect(reloaded.history).toEqual([]);
  });
});

describe("isThrottled", () => {
  test("never-seen repo is not throttled", () => {
    const db = { version: 1 as const, history: [] };
    expect(isThrottled(db, "new/repo")).toBeNull();
  });

  test("recently opened repo is throttled (cooldown)", () => {
    const db = recordOpened({ version: 1, history: [] }, {
      repo: "a/b", rulesFixed: [], prNumber: 1, prUrl: "x", fork: "me/b", branch: "y",
    });
    const reason = isThrottled(db, "a/b");
    expect(reason).toMatch(/cooldown/);
    expect(reason).toMatch(/state=open/);
  });

  test("opted-out repo is permanently throttled", () => {
    const db = recordOptOut({ version: 1, history: [] }, "a/b");
    expect(isThrottled(db, "a/b")).toMatch(/cue: ignore/);
  });

  test("entry older than cooldownDays does not throttle", () => {
    const longAgo = new Date(Date.now() - (DEFAULT_COOLDOWN_DAYS + 1) * 24 * 3600 * 1000).toISOString();
    const db = { version: 1 as const, history: [{ repo: "a/b", state: "skipped" as const, openedAt: longAgo }] };
    expect(isThrottled(db, "a/b")).toBeNull();
  });

  test("custom cooldownDays is respected", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
    const db = { version: 1 as const, history: [{ repo: "a/b", state: "skipped" as const, openedAt: fourDaysAgo }] };
    expect(isThrottled(db, "a/b", 3)).toBeNull();  // 4d > 3d cooldown → free
    expect(isThrottled(db, "a/b", 10)).toMatch(/cooldown/);  // 4d < 10d → throttled
  });
});

describe("canPostMore / todayCount", () => {
  test("empty DB → full headroom", () => {
    const { ok, remaining, cap } = canPostMore({ version: 1, history: [] });
    expect(ok).toBe(true);
    expect(remaining).toBe(DAILY_CAP);
    expect(cap).toBe(DAILY_CAP);
  });

  test("counts only state=open within last 24h", () => {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const db = {
      version: 1 as const,
      history: [
        { repo: "a/1", state: "open" as const, openedAt: now, prNumber: 1 },
        { repo: "a/2", state: "open" as const, openedAt: now, prNumber: 2 },
        { repo: "a/3", state: "open" as const, openedAt: yesterday, prNumber: 3 },  // too old
        { repo: "a/4", state: "skipped" as const, openedAt: now },                 // not opened
        { repo: "a/5", state: "opted-out" as const, openedAt: now },               // not opened
      ],
    };
    expect(todayCount(db)).toBe(2);
    expect(canPostMore(db).remaining).toBe(DAILY_CAP - 2);
  });

  test("at the cap, canPostMore returns ok=false", () => {
    const now = new Date().toISOString();
    const history = Array.from({ length: DAILY_CAP }, (_, i) => ({
      repo: `a/${i}`, state: "open" as const, openedAt: now, prNumber: i + 1,
    }));
    const db = { version: 1 as const, history };
    expect(canPostMore(db).ok).toBe(false);
    expect(canPostMore(db).remaining).toBe(0);
  });
});

describe("mutations + helpers", () => {
  test("recordOptOut + hasRecordedOptOut round-trip", () => {
    const db = recordOptOut({ version: 1, history: [] }, "a/b");
    expect(hasRecordedOptOut(db, "a/b")).toBe(true);
    expect(hasRecordedOptOut(db, "x/y")).toBe(false);
  });

  test("recordSkipped writes a skipped entry with the reason", () => {
    const db = recordSkipped({ version: 1, history: [] }, "a/b", "no fixes");
    expect(db.history[0]!.state).toBe("skipped");
    expect(db.history[0]!.reason).toBe("no fixes");
  });

  test("updateEntryState mutates by prNumber match", () => {
    let db = recordOpened({ version: 1, history: [] }, {
      repo: "a/b", rulesFixed: [], prNumber: 42, prUrl: "x", fork: "me/b", branch: "y",
    });
    db = updateEntryState(db, { repo: "a/b", prNumber: 42 }, "merged", { cleanedAt: "2026-05-24T00:00:00Z" });
    expect(db.history[0]!.state).toBe("merged");
    expect(db.history[0]!.cleanedAt).toBe("2026-05-24T00:00:00Z");
  });

  test("filterByState returns only matching entries", () => {
    let db: any = { version: 1, history: [] };
    db = recordOpened(db, { repo: "a/1", rulesFixed: [], prNumber: 1, prUrl: "x", fork: "me/1", branch: "y" });
    db = recordOptOut(db, "a/2");
    db = recordSkipped(db, "a/3", "no fixes");
    expect(filterByState(db, ["open"]).map((e: any) => e.repo)).toEqual(["a/1"]);
    expect(filterByState(db, ["open", "skipped"]).map((e: any) => e.repo).sort()).toEqual(["a/1", "a/3"]);
  });
});
