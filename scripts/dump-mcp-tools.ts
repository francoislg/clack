#!/usr/bin/env npx tsx
/**
 * Connects to each MCP server in data/mcp.json, calls tools/list,
 * and dumps every tool name + input schema. Use this to discover
 * the real parameter names for tool label interpolation.
 * Pinned stdio entries (package + version) are installed into data/mcp_packages/ like at boot.
 *
 * Usage:
 *   npx tsx scripts/dump-mcp-tools.ts              # all servers
 *   npx tsx scripts/dump-mcp-tools.ts statsig       # one server
 *   npx tsx scripts/dump-mcp-tools.ts --json        # machine-readable output
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { z } from "zod";
import { truncate } from "../src/text.js";
import { parseStdioEntry } from "../src/mcpPinned.js";
import { ensureInstalled, pinnedSpawnConfig } from "../src/mcpInstaller.js";
import {
  isRemoteEntry,
  type McpConfig,
  type McpRemoteConfig,
  type McpServerEntry,
} from "../src/mcp.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StdioSpawnConfig = ReturnType<typeof pinnedSpawnConfig>;

const toolSchemaZod = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z
    .looseObject({
      properties: z.record(z.string(), z.looseObject({ type: z.unknown().optional() })).optional(),
      required: z.array(z.string()).optional(),
    })
    .optional(),
});

type ToolSchema = z.infer<typeof toolSchemaZod>;

const jsonRpcMessageZod = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

type JsonRpcMessage = z.infer<typeof jsonRpcMessageZod>;

const toolsListResultZod = z.looseObject({ tools: z.array(toolSchemaZod) });

type ToolsListOutcome = { tools: ToolSchema[] } | { error: Error };

/** Reads the tools out of a tools/list reply, or the reason it cannot. */
function toolsListOutcome(msg: JsonRpcMessage): ToolsListOutcome {
  if (msg.error !== undefined) {
    return { error: new Error(`tools/list failed: ${JSON.stringify(msg.error)}`) };
  }
  const parsed = toolsListResultZod.safeParse(msg.result);
  if (parsed.success) return { tools: parsed.data.tools };
  return {
    error: new Error(
      `Unexpected tools/list result (${z.prettifyError(parsed.error)}): ${truncate(JSON.stringify(msg.result), 500)}`,
    ),
  };
}

/** Parses one JSON-RPC line; undefined when it is not a JSON-RPC message. */
function parseJsonRpcLine(line: string): JsonRpcMessage | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = jsonRpcMessageZod.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Env var substitution (matches src/mcp.ts behavior)
// ---------------------------------------------------------------------------

function substituteEnvVars(obj?: Record<string, string>): Record<string, string> | undefined {
  if (!obj) return undefined;
  const result: Record<string, string> = {};
  // Load .env file if present
  const envPath = resolve(process.cwd(), "data/auth/.env");
  const dotEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) dotEnv[match[1].trim()] = match[2].trim();
    }
  }

  for (const [key, val] of Object.entries(obj)) {
    result[key] = val.replace(/\$\{(\w+)\}/g, (_m, name) => {
      return process.env[name] ?? dotEnv[name] ?? "";
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Stdio MCP client (minimal JSON-RPC over stdin/stdout)
// ---------------------------------------------------------------------------

async function connectStdio(config: StdioSpawnConfig): Promise<ToolSchema[]> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...config.env };
    const child = spawn(config.command, config.args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let pending = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout waiting for MCP server response"));
    }, 30_000);

    const finish = (outcome: ToolsListOutcome) => {
      clearTimeout(timeout);
      child.kill();
      if ("tools" in outcome) resolve(outcome.tools);
      else reject(outcome.error);
    };

    const send = (message: object) => child.stdin.write(JSON.stringify(message) + "\n");

    // initialize (id 1) → notifications/initialized + tools/list (id 2) → tools
    const handleMessage = (msg: JsonRpcMessage) => {
      if (msg.id === 1 && msg.error !== undefined) {
        finish({ error: new Error(`initialize failed: ${JSON.stringify(msg.error)}`) });
      } else if (msg.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (msg.id === 2) {
        finish(toolsListOutcome(msg));
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const lines = (pending + chunk.toString()).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const msg = parseJsonRpcLine(line);
        if (msg) handleMessage(msg);
      }
    });

    child.stdin.on("error", (err) => finish({ error: err }));

    child.stderr.on("data", (_chunk: Buffer) => {
      // Some servers print init messages to stderr; ignore
    });

    child.on("error", (err) => finish({ error: err }));

    child.on("close", (code) => {
      const last = parseJsonRpcLine(pending);
      if (last) handleMessage(last);
      finish({ error: new Error(`MCP server exited with code ${code} before listing its tools`) });
    });

    // Send initialize; tools/list follows once the server answers it
    const initMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "dump-mcp-tools", version: "1.0.0" },
      },
    });
    child.stdin.write(initMsg + "\n");
  });
}

// ---------------------------------------------------------------------------
// HTTP/SSE MCP client (Streamable HTTP transport)
// ---------------------------------------------------------------------------

async function connectHttp(config: McpRemoteConfig): Promise<ToolSchema[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...substituteEnvVars(config.headers),
  };

  // Initialize
  await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "dump-mcp-tools", version: "1.0.0" },
      },
    }),
  });

  // List tools
  const response = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  const contentType = response.headers.get("content-type") ?? "";

  const text = await response.text();
  const msg = contentType.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => parseJsonRpcLine(line.slice(6)))
        .find((m) => m?.id === 2)
    : parseJsonRpcLine(text);
  if (!msg) throw new Error(`No tools/list reply in response: ${truncate(text, 500)}`);

  const outcome = toolsListOutcome(msg);
  if ("error" in outcome) throw outcome.error;
  return outcome.tools;
}

/** Connects to one mcp.json server, installing a pinned stdio entry first, and lists its tools. */
async function listServerTools(name: string, server: McpServerEntry): Promise<ToolSchema[]> {
  if (isRemoteEntry(server)) return connectHttp(server);

  const parsed = parseStdioEntry(name, server, substituteEnvVars);
  if (parsed.kind === "pinned") {
    const { binPath } = await ensureInstalled(name, parsed.entry.package, parsed.entry.version);
    return connectStdio(pinnedSpawnConfig(parsed.entry, binPath));
  }
  if ("command" in parsed.config) {
    return connectStdio({
      command: parsed.config.command,
      args: parsed.config.args ?? [],
      env: parsed.config.env,
    });
  }
  throw new Error(`MCP entry '${name}': unsupported stdio config`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const filterServer = args.find((a) => !a.startsWith("--"));

  const mcpPath = join(process.cwd(), "data/mcp.json");
  if (!existsSync(mcpPath)) {
    console.error("No data/mcp.json found");
    process.exit(1);
  }

  const config: McpConfig = JSON.parse(readFileSync(mcpPath, "utf-8"));
  if (!config.mcpServers) {
    console.error("No mcpServers in mcp.json");
    process.exit(1);
  }

  const allResults: Record<string, ToolSchema[]> = {};

  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (filterServer && name !== filterServer) continue;

    if (!jsonOutput) console.log(`\n${"=".repeat(60)}\n  ${name}\n${"=".repeat(60)}`);

    try {
      const tools = await listServerTools(name, server);
      allResults[name] = tools;

      if (!jsonOutput) {
        tools.sort((a, b) => a.name.localeCompare(b.name));
        for (const tool of tools) {
          const props = tool.inputSchema?.properties ?? {};
          const required = new Set(tool.inputSchema?.required ?? []);
          const params = Object.entries(props)
            .map(
              ([k, v]) =>
                `${k}${required.has(k) ? "*" : ""}: ${typeof v.type === "string" ? v.type : (JSON.stringify(v.type) ?? "?")}`,
            )
            .join(", ");

          console.log(`\n  ${tool.name}(${params})`);
          if (tool.description) {
            const desc = truncate(tool.description, 100);
            console.log(`    ${desc}`);
          }
        }
        console.log(`\n  Total: ${tools.length} tools`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (jsonOutput) allResults[name] = [];
      console.error(jsonOutput ? `${name}: ERROR: ${msg}` : `  ERROR: ${msg}`);
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(allResults, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
