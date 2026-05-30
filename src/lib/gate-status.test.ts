import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  gateStatusDir,
  gateStatusFile,
  readAllGateStatus,
  readGateStatus,
} from "./gate-status";

let prevXdg: string | undefined;
let scratch: string;

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  scratch = mkdtempSync(join(tmpdir(), "cue-gate-status-test-"));
  process.env.XDG_CONFIG_HOME = scratch;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("gateStatusDir / gateStatusFile", () => {
  test("derives location from XDG_CONFIG_HOME", () => {
    expect(gateStatusDir()).toBe(join(scratch, "cue", "gate-status"));
  });

  test("composite selectors keep + characters but sanitize others", () => {
    expect(gateStatusFile("medusa-vite+backend")).toBe(
      join(scratch, "cue", "gate-status", "medusa-vite+backend.json"),
    );
    // Slashes / paths should not escape the directory.
    expect(gateStatusFile("../etc/passwd")).toBe(
      join(scratch, "cue", "gate-status", "___etc_passwd.json"),
    );
  });
});

describe("readGateStatus", () => {
  function writeRun(profile: string, body: object): void {
    const dir = gateStatusDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(gateStatusFile(profile), JSON.stringify(body));
  }

  test("returns null when no status file exists", () => {
    expect(readGateStatus("ghost")).toBeNull();
  });

  test("parses a well-formed status file", () => {
    writeRun("test", {
      ts: "2026-05-28T10:00:00Z",
      profile: "test",
      overall: "pass",
      results: [{ name: "tests-pass.sh", ok: true, exit: 0, stderr: "" }],
    });
    const run = readGateStatus("test");
    expect(run?.profile).toBe("test");
    expect(run?.overall).toBe("pass");
    expect(run?.results[0]?.name).toBe("tests-pass.sh");
  });

  test("rejects files missing required fields", () => {
    writeRun("test", { overall: "pass", results: [] }); // no ts / profile
    expect(readGateStatus("test")).toBeNull();
  });

  test("rejects malformed JSON gracefully", () => {
    const dir = gateStatusDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(gateStatusFile("test"), "{not json");
    expect(readGateStatus("test")).toBeNull();
  });
});

describe("readAllGateStatus", () => {
  test("returns empty array when dir doesn't exist", () => {
    expect(readAllGateStatus()).toEqual([]);
  });

  test("aggregates runs newest-first by ts", () => {
    const dir = gateStatusDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old.json"), JSON.stringify({
      ts: "2026-05-26T10:00:00Z", profile: "old", overall: "pass", results: [],
    }));
    writeFileSync(join(dir, "new.json"), JSON.stringify({
      ts: "2026-05-28T10:00:00Z", profile: "new", overall: "fail", results: [],
    }));
    writeFileSync(join(dir, "ignored.txt"), "not a status file");
    const runs = readAllGateStatus();
    expect(runs.map((r) => r.profile)).toEqual(["new", "old"]);
  });

  test("skips malformed files without crashing", () => {
    const dir = gateStatusDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.json"), "}}}");
    writeFileSync(join(dir, "ok.json"), JSON.stringify({
      ts: "2026-05-28T10:00:00Z", profile: "ok", overall: "pass", results: [],
    }));
    const runs = readAllGateStatus();
    expect(runs.length).toBe(1);
    expect(runs[0]?.profile).toBe("ok");
  });
});
