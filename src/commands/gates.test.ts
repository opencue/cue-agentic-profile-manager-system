import { describe, expect, test } from "bun:test";

import { parseArgs } from "./gates";

describe("gates parseArgs", () => {
  test("no args → help", () => {
    expect(parseArgs([]).sub).toBe("help");
    expect(parseArgs(["--help"]).sub).toBe("help");
    expect(parseArgs(["-h"]).sub).toBe("help");
  });

  test("unknown subcommand → help (no crash)", () => {
    expect(parseArgs(["whatever"]).sub).toBe("help");
  });

  test("list / run / status are the known subcommands", () => {
    expect(parseArgs(["list"]).sub).toBe("list");
    expect(parseArgs(["run"]).sub).toBe("run");
    expect(parseArgs(["status"]).sub).toBe("status");
  });

  test("--profile <name> threads through every subcommand", () => {
    expect(parseArgs(["list", "--profile", "rust"]).profile).toBe("rust");
    expect(parseArgs(["run", "--profile", "medusa-vite+backend"]).profile).toBe("medusa-vite+backend");
    expect(parseArgs(["status", "--profile", "skill-writer"]).profile).toBe("skill-writer");
  });

  test("flags --fail-fast / --all / --json toggle their fields", () => {
    expect(parseArgs(["run", "--fail-fast"]).failFast).toBe(true);
    expect(parseArgs(["status", "--all"]).all).toBe(true);
    expect(parseArgs(["status", "--json"]).json).toBe(true);
  });

  test("missing value after --profile yields null without crashing", () => {
    expect(parseArgs(["list", "--profile"]).profile).toBeNull();
  });
});
