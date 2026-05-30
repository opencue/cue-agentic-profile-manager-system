import { describe, expect, test } from "bun:test";

import { dispatch, listToolNames } from "./mcp-server";

describe("mcp dispatcher", () => {
  test("initialize returns capabilities + serverInfo", async () => {
    const res = await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res?.id).toBe(1);
    const result = res?.result as { protocolVersion: string; capabilities: object; serverInfo: { name: string } };
    expect(result.protocolVersion).toBeDefined();
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo.name).toBe("cue");
  });

  test("notifications (no id) get no response", async () => {
    const res = await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res).toBeNull();
  });

  test("tools/list returns the registered tools with schemas", async () => {
    const res = await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const result = res?.result as { tools: { name: string; description: string; inputSchema: object }[] };
    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.tools.every((t) => typeof t.name === "string" && t.name.length > 0)).toBe(true);
    expect(result.tools.every((t) => typeof t.description === "string")).toBe(true);
    expect(result.tools.every((t) => typeof t.inputSchema === "object")).toBe(true);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("cue_status");
    expect(names).toContain("cue_skill_report");
    expect(names).toContain("cue_list_profiles");
  });

  test("tools/call with an unknown name returns a JSON-RPC error", async () => {
    const res = await dispatch({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });
    expect(res?.error?.code).toBe(-32601);
    expect(res?.error?.message).toContain("no_such_tool");
  });

  test("tools/call cue_status returns content[] with JSON text", async () => {
    const res = await dispatch({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "cue_status", arguments: {} },
    });
    const result = res?.result as { content: { type: string; text: string }[]; isError: boolean };
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    // The text should be valid JSON with an `ok` boolean.
    const inner = JSON.parse(result.content[0]?.text ?? "{}") as { ok: boolean };
    expect(typeof inner.ok).toBe("boolean");
  });

  test("ping responds to ping", async () => {
    const res = await dispatch({ jsonrpc: "2.0", id: 5, method: "ping" });
    expect(res?.result).toEqual({});
  });

  test("unknown method returns -32601", async () => {
    const res = await dispatch({ jsonrpc: "2.0", id: 6, method: "nope" });
    expect(res?.error?.code).toBe(-32601);
  });
});

describe("listToolNames", () => {
  test("returns at least the core endpoints", () => {
    const names = listToolNames();
    expect(names).toContain("cue_status");
    expect(names).toContain("cue_pair_suggestions");
    expect(names).toContain("cue_gates");
    expect(names).toContain("cue_trigger_gaps");
  });
});
