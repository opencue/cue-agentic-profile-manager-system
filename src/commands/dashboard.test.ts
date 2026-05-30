import { describe, expect, test } from "bun:test";

import { parseArgs } from "./dashboard";
import { createHandler } from "../lib/dashboard-server";

describe("dashboard parseArgs", () => {
  test("defaults are 127.0.0.1:7891", () => {
    const a = parseArgs([]);
    expect(a.host).toBe("127.0.0.1");
    expect(a.port).toBe(7891);
    expect(a.noOpen).toBe(false);
    expect(a.once).toBe(false);
  });

  test("flags parse", () => {
    const a = parseArgs(["--port", "9000", "--host", "0.0.0.0", "--no-open", "--once"]);
    expect(a.port).toBe(9000);
    expect(a.host).toBe("0.0.0.0");
    expect(a.noOpen).toBe(true);
    expect(a.once).toBe(true);
  });

  test("invalid port falls back to default", () => {
    expect(parseArgs(["--port", "garbage"]).port).toBe(7891);
    expect(parseArgs(["--port", "70000"]).port).toBe(7891); // > 65535
  });

  test("--help short-circuits", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

describe("dashboard handler routing", () => {
  test("unknown /api/v1/ path returns 404 envelope", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/api/v1/nope"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "not-found" });
  });

  test("known endpoint shape returns envelope (or telemetry-disabled error)", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/api/v1/skill-report?profile=foo"));
    const body = (await res.json()) as { ok: boolean };
    expect(typeof body.ok).toBe("boolean");
  });

  test("/api/v1/status returns ok envelope (works even without telemetry)", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/api/v1/status"));
    const body = (await res.json()) as { ok: boolean; data?: { telemetryEnabled: boolean } };
    expect(body.ok).toBe(true);
    expect(typeof body.data?.telemetryEnabled).toBe("boolean");
  });

  test("non-api path: JSON discovery when no web build, static file otherwise", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/somethingelse"));
    const ct = res.headers.get("Content-Type") ?? "";
    if (ct.startsWith("application/json")) {
      // No web/dist/ — handler returns the discovery envelope.
      const body = (await res.json()) as { ok: boolean; data: { api: string[] } };
      expect(body.ok).toBe(true);
      expect(body.data.api).toContain("/api/v1/status");
    } else {
      // web/dist/index.html exists — SPA fallback served. Just confirm
      // we got HTML, not a 500.
      expect(res.status).toBe(200);
      expect(ct).toContain("text/html");
    }
  });
});
