/**
 * Minimal MCP (Model Context Protocol) server over stdio JSON-RPC.
 *
 * Why custom rather than @modelcontextprotocol/sdk: the protocol surface
 * we need is tiny (initialize, tools/list, tools/call), the SDK adds a
 * runtime dep, and the stdio wire format is just newline-delimited JSON.
 * Keeping it in-house means cue's MCP server has zero extra installs.
 *
 * Each line on stdin is one JSON-RPC 2.0 request. Each line on stdout is
 * one response. Everything else (logs, errors) goes to stderr so it
 * doesn't pollute the wire.
 *
 * Tools surface the same data the dashboard's `/api/v1/*` endpoints
 * return — same handlers, same shapes — so Claude can query cue state
 * directly via tool calls without going through HTTP.
 */

import {
  handleActiveSessions,
  handleGates,
  handlePairs,
  handleProfiles,
  handleSkillReport,
  handleStatus,
  handleTelemetryTimeline,
  handleTriggerGaps,
  type ApiResult,
} from "./dashboard-server";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Convert MCP tool args → URLSearchParams, then invoke the handler. */
  handler: (args: Record<string, unknown>) => Promise<ApiResult<unknown>>;
}

/** Build URLSearchParams from a simple flat object. Numbers + booleans stringify. */
function toParams(obj: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    p.set(k, String(v));
  }
  return p;
}

const TOOLS: ToolSpec[] = [
  {
    name: "cue_status",
    description:
      "Active cue profile for the current working directory: name, description, " +
      "skill/MCP/plugin counts, recent gate result, doctor warnings, and total " +
      "session count. Use this to answer 'what is cue currently doing?'",
    inputSchema: { type: "object", properties: {} },
    handler: () => handleStatus(),
  },
  {
    name: "cue_skill_report",
    description:
      "Per-skill activation table for a profile in a telemetry window. Shows " +
      "which declared skills actually fired (active) vs. which never fire " +
      "(zombie). Pass profile to target a specific selector; otherwise uses " +
      "the directory's pin. Use to find dead weight to prune.",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", description: "Profile selector (omit to use the active pin)" },
        since:   { type: "string", description: "Window in days (e.g. \"30\"). Default 30." },
      },
    },
    handler: (args) => handleSkillReport(toParams(args)),
  },
  {
    name: "cue_pair_suggestions",
    description:
      "\"You usually pair X with Y\" — empirical pair affinity mined from local " +
      "composite picks (e.g. medusa-vite+backend). Returns ranked partner " +
      "profiles per source profile. Use to suggest profile combinations.",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", description: "Limit results to a single source profile" },
      },
    },
    handler: (args) => handlePairs(toParams(args)),
  },
  {
    name: "cue_gates",
    description:
      "Quality-gate run results. Pass all=true for every profile's most-recent " +
      "run, or profile=<name> for one specific profile. Each result carries the " +
      "overall pass/fail and per-gate stderr (first ~2KB).",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string" },
        all:     { type: "boolean", description: "Return runs across all profiles" },
      },
    },
    handler: (args) => handleGates(toParams(args)),
  },
  {
    name: "cue_trigger_gaps",
    description:
      "Skills whose trigger phrases appear in user prompts but produced no " +
      "skill_hit event. Indicates routing weakness — the skill should have " +
      "fired and didn't. Returns up to N ranked rows with sample triggers.",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string" },
        since:   { type: "string", description: "Window in days. Default 30." },
      },
    },
    handler: (args) => handleTriggerGaps(toParams(args)),
  },
  {
    name: "cue_list_profiles",
    description:
      "Every installed profile (builtins + shared installs from `cue share " +
      "install`) with the materialized CLAUDE.md byte size when available. Use " +
      "to enumerate profiles or compare per-profile token cost.",
    inputSchema: { type: "object", properties: {} },
    handler: () => handleProfiles(),
  },
  {
    name: "cue_active_sessions",
    description:
      "Every cue-launched Claude/Codex agent currently running on this machine. " +
      "Returns pid, profile, agent kind, cwd, and start time per session. " +
      "Use to answer 'what agents are running right now?' Linux-only (uses /proc).",
    inputSchema: { type: "object", properties: {} },
    handler: () => handleActiveSessions(),
  },
  {
    name: "cue_telemetry_timeline",
    description:
      "Per-profile session counts over a window. Closest cue has to a usage " +
      "timeline. Pass since=<days>; default 30.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string" },
      },
    },
    handler: (args) => handleTelemetryTimeline(toParams(args)),
  },
];

const SERVER_INFO = {
  name: "cue",
  version: "0.10.0",
};

/** Dispatcher — exported for in-process tests (no stdio needed). */
export async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  // Notifications (no `id`) get no response per JSON-RPC 2.0.
  const isNotification = req.id === undefined;
  const respond = (result: unknown): JsonRpcResponse | null =>
    isNotification ? null : { jsonrpc: "2.0", id: req.id ?? null, result };
  const fail = (code: number, message: string, data?: unknown): JsonRpcResponse | null =>
    isNotification ? null : { jsonrpc: "2.0", id: req.id ?? null, error: { code, message, data } };

  switch (req.method) {
    case "initialize":
      return respond({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "initialized":
    case "notifications/initialized":
      // Client-side ACK; no response expected.
      return null;

    case "tools/list":
      return respond({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name, description, inputSchema,
        })),
      });

    case "tools/call": {
      const params = req.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32601, `Unknown tool: ${name}`);
      try {
        const result = await tool.handler(args);
        // MCP tools return `content` (array of { type, text }) plus
        // `isError`. We emit a single text block of pretty JSON so the
        // model sees the full structured response.
        return respond({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.ok,
        });
      } catch (err) {
        return fail(-32603, `Tool ${name} threw: ${(err as Error).message}`);
      }
    }

    case "ping":
      return respond({});

    default:
      return fail(-32601, `Method not found: ${req.method}`);
  }
}

/**
 * Run the stdio loop. Reads newline-delimited JSON-RPC from stdin, writes
 * responses to stdout. Anything that breaks framing (logs, errors) goes
 * to stderr so the protocol stream stays clean.
 *
 * Returns when stdin closes. Never throws — every error path becomes an
 * error response or a stderr line.
 */
export async function runStdioServer(): Promise<void> {
  process.stderr.write(`cue mcp ready (stdio)\n`);

  let buffer = "";
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line) as JsonRpcRequest;
      } catch (err) {
        process.stderr.write(`cue mcp: bad JSON: ${(err as Error).message}\n`);
        continue;
      }
      let res: JsonRpcResponse | null;
      try {
        res = await dispatch(req);
      } catch (err) {
        res = {
          jsonrpc: "2.0",
          id: req.id ?? null,
          error: { code: -32603, message: `Internal: ${(err as Error).message}` },
        };
      }
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    }
  }
}

/** Exposed for `cue mcp tools` (and tests) — flat list of registered names. */
export function listToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}
