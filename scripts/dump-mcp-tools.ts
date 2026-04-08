#!/usr/bin/env npx tsx
/**
 * Connects to each MCP server in data/mcp.json, calls tools/list,
 * and dumps every tool name + input schema. Use this to discover
 * the real parameter names for tool label interpolation.
 *
 * Usage:
 *   npx tsx scripts/dump-mcp-tools.ts              # all servers
 *   npx tsx scripts/dump-mcp-tools.ts statsig       # one server
 *   npx tsx scripts/dump-mcp-tools.ts --json        # machine-readable output
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { truncate } from "../src/text.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpStdioConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpRemoteConfig {
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
}

type McpServerEntry = McpStdioConfig | McpRemoteConfig;

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

interface ToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
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

async function connectStdio(config: McpStdioConfig): Promise<ToolSchema[]> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...substituteEnvVars(config.env) };
    const child = spawn(config.command, config.args ?? [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout waiting for MCP server response"));
    }, 30_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      // Look for complete JSON-RPC responses
      const lines = stdout.split("\n");
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            clearTimeout(timeout);
            child.kill();
            resolve(msg.result.tools as ToolSchema[]);
            return;
          }
        } catch {
          // Not a complete JSON line yet
        }
      }
    });

    child.stderr.on("data", (_chunk: Buffer) => {
      // Some servers print init messages to stderr; ignore
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`MCP server exited with code ${code}`));
      }
    });

    // Send initialize + tools/list
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
    const listMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    child.stdin.write(initMsg + "\n");
    child.stdin.write(listMsg + "\n");
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

  if (contentType.includes("text/event-stream")) {
    // SSE response — parse event stream
    const text = await response.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.result?.tools) return msg.result.tools as ToolSchema[];
        } catch {
          // skip
        }
      }
    }
    throw new Error("No tools/list result in SSE stream");
  } else {
    // JSON response
    const msg = (await response.json()) as { result?: { tools?: ToolSchema[] } };
    if (msg.result?.tools) return msg.result.tools;
    throw new Error(`Unexpected response: ${JSON.stringify(msg)}`);
  }
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
      let tools: ToolSchema[];
      if (server.type === "sse" || server.type === "http") {
        tools = await connectHttp(server as McpRemoteConfig);
      } else {
        tools = await connectStdio(server as McpStdioConfig);
      }

      allResults[name] = tools;

      if (!jsonOutput) {
        tools.sort((a, b) => a.name.localeCompare(b.name));
        for (const tool of tools) {
          const props = tool.inputSchema?.properties ?? {};
          const required = new Set(tool.inputSchema?.required ?? []);
          const params = Object.entries(props)
            .map(([k, v]) => `${k}${required.has(k) ? "*" : ""}: ${v.type}`)
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
      if (jsonOutput) {
        allResults[name] = [];
      } else {
        console.error(`  ERROR: ${msg}`);
      }
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
