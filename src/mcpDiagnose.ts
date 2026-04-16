import { spawn } from "child_process";

const DIAGNOSE_TIMEOUT_MS = 15_000;

interface StdioConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface RemoteConfig {
  type: "sse" | "http";
  url: string;
  headers?: Record<string, string>;
}

export type DiagnosableConfig = StdioConfig | RemoteConfig;

export async function diagnoseMcpServer(config: DiagnosableConfig): Promise<string> {
  if ("url" in config) {
    return diagnoseHttp(config);
  }
  return diagnoseStdio(config);
}

function diagnoseStdio(config: StdioConfig): Promise<string> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...config.env };
    const child = spawn(config.command, config.args ?? [], {
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let listed = false;

    const timeout = setTimeout(() => {
      child.kill();
      resolve(`timed out after ${DIAGNOSE_TIMEOUT_MS}ms${stderr ? `: ${stderr.trim()}` : ""}`);
    }, DIAGNOSE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result) {
            listed = true;
            clearTimeout(timeout);
            child.kill();
            resolve("handshake succeeded but SDK reported failure — check tool list");
            return;
          }
        } catch {
          // not a complete JSON line yet
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve(`spawn error: ${err.message}`);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (listed) return;
      const trimmed = stderr.trim();
      if (trimmed) {
        resolve(`exit ${code ?? "?"}: ${trimmed}`);
      } else {
        resolve(`exited with code ${code ?? "?"} (no stderr)`);
      }
    });

    const init = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "clack-diagnose", version: "1.0.0" },
      },
    });
    const list = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    child.stdin.write(init + "\n");
    child.stdin.write(list + "\n");
  });
}

async function diagnoseHttp(config: RemoteConfig): Promise<string> {
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...config.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "clack-diagnose", version: "1.0.0" },
        },
      }),
      signal: AbortSignal.timeout(DIAGNOSE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
    }
    return "handshake succeeded but SDK reported failure";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
