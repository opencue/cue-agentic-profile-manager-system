/**
 * `cue mcp` — boot the MCP stdio server so Claude (or any MCP client)
 * can query cue's data directly as tool calls.
 *
 * Subcommands:
 *   cue mcp                    Start the stdio server (default; for MCP clients).
 *   cue mcp tools              Print the registered tool names.
 *   cue mcp install            Print the snippet to add to ~/.claude.json.
 *   cue mcp test <toolName>    Smoke a single tool from the shell.
 */

import { dispatch, listToolNames, runStdioServer } from "../lib/mcp-server";

interface ParsedArgs {
  sub: "serve" | "tools" | "install" | "test" | "help";
  positional: string[];
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    sub: "serve",
    positional: [],
    json: false,
    help: false,
  };
  if (argv.length === 0) return out;
  const first = argv[0]!;
  if (first === "--help" || first === "-h") { out.help = true; return out; }
  if (first === "tools" || first === "install" || first === "test") {
    out.sub = first;
  } else if (first === "serve") {
    out.sub = "serve";
  } else {
    out.positional.push(first);
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) out.positional.push(a);
  }
  return out;
}

function helpText(): string {
  return [
    "cue mcp — MCP (Model Context Protocol) server for cue",
    "",
    "Lets Claude query cue's data directly via tool calls — active profile,",
    "skill activation, pair suggestions, quality gates, trigger gaps, etc.",
    "Same data the dashboard renders, exposed over stdio JSON-RPC.",
    "",
    "Usage:",
    "  cue mcp                    Start the stdio server (default; for MCP clients)",
    "  cue mcp tools              List available tools",
    "  cue mcp install            Print the snippet to register cue with Claude Code",
    "  cue mcp test <tool> [json] Invoke one tool and pretty-print the response",
    "",
    "Examples:",
    "  cue mcp test cue_status",
    "  cue mcp test cue_skill_report '{\"profile\":\"skill-writer\"}'",
    "  cue mcp install >> ~/.claude.json   # then re-merge the JSON",
    "",
  ].join("\n");
}

function installSnippet(): string {
  // Resolve the path users should put in their Claude Code config. Claude
  // Code spawns the MCP server via execvp(command, [command, ...args]),
  // so `command` MUST be a single executable name (not "bun /path/to/file").
  // For the typical bun-run-from-source install, set command="bun" and
  // prepend the script path to args. For an installed `cue` binary,
  // command IS the binary and args is just ["mcp"].
  const binPath = process.argv[1] ?? "";
  const installed = binPath.endsWith("/cue");
  const entry = installed
    ? { command: binPath, args: ["mcp"], env: {} }
    : { command: "bun", args: [binPath || "src/index.ts", "mcp"], env: {} };
  return JSON.stringify({ mcpServers: { cue: entry } }, null, 2);
}

async function runTools(args: ParsedArgs): Promise<number> {
  const names = listToolNames();
  if (args.json) {
    process.stdout.write(JSON.stringify(names, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(`cue mcp exposes ${names.length} tools:\n`);
  for (const n of names) process.stdout.write(`  ${n}\n`);
  process.stdout.write(`\nInvoke one: cue mcp test <toolName>\n`);
  return 0;
}

async function runInstall(): Promise<number> {
  process.stdout.write(
    "Add this to ~/.claude.json (merge into the existing mcpServers block):\n\n",
  );
  process.stdout.write(installSnippet() + "\n\n");
  process.stdout.write(
    "Or, from a Claude Code session:\n" +
    `  /mcp add cue ${process.argv[1] ?? "<cue-bin>"} mcp\n`,
  );
  return 0;
}

async function runTest(args: ParsedArgs): Promise<number> {
  const toolName = args.positional[0];
  if (!toolName) {
    process.stderr.write("cue mcp test: missing <toolName>. Run `cue mcp tools` to list them.\n");
    return 1;
  }
  let toolArgs: Record<string, unknown> = {};
  if (args.positional[1]) {
    try {
      toolArgs = JSON.parse(args.positional[1]);
    } catch (err) {
      process.stderr.write(`cue mcp test: bad JSON args: ${(err as Error).message}\n`);
      return 1;
    }
  }
  const res = await dispatch({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: toolArgs },
  });
  if (!res) {
    process.stderr.write("cue mcp test: tool produced no response\n");
    return 1;
  }
  if (res.error) {
    process.stderr.write(`cue mcp test: ${res.error.message}\n`);
    return 1;
  }
  // tools/call returns { content: [{type, text}], isError }
  const result = res.result as { content?: { type: string; text: string }[]; isError?: boolean };
  for (const block of result.content ?? []) {
    process.stdout.write((block.text ?? "") + "\n");
  }
  return result.isError ? 1 : 0;
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }
  switch (args.sub) {
    case "tools":   return runTools(args);
    case "install": return runInstall();
    case "test":    return runTest(args);
    case "serve":
    default:
      await runStdioServer();
      return 0;
  }
}
