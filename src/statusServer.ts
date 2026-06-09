import { createServer, type Server } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";
import { snapshot as activeRunsSnapshot, type ActiveRunInfo } from "./slack/activeRuns.js";
import { snapshotRunningChanges, type RunningChangeInfo } from "./changes/activeState.js";

export interface StatusPayload {
  version: string;
  uptimeSec: number;
  activeRuns: { count: number; runs: ActiveRunInfo[] };
  workers: { active: number; changes: RunningChangeInfo[] };
  busy: boolean;
}

export interface StatusDeps {
  activeRuns: () => { count: number; runs: ActiveRunInfo[] };
  runningChanges: () => { active: number; changes: RunningChangeInfo[] };
  uptimeSec: () => number;
  version: string;
}

/** Assemble the live status payload. `busy` is the union of the two work sources. */
export function buildStatus(deps: StatusDeps): StatusPayload {
  const activeRuns = deps.activeRuns();
  const workers = deps.runningChanges();
  return {
    version: deps.version,
    uptimeSec: Math.floor(deps.uptimeSec()),
    activeRuns,
    workers,
    busy: activeRuns.count > 0 || workers.active > 0,
  };
}

function readPackageVersion(): string {
  try {
    const path = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(path, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function defaultStatusDeps(): StatusDeps {
  return {
    activeRuns: activeRunsSnapshot,
    runningChanges: snapshotRunningChanges,
    uptimeSec: () => process.uptime(),
    version: readPackageVersion(),
  };
}

export type StatusRequestHandler = (
  req: { method?: string; url?: string },
  res: {
    writeHead: (status: number, headers: Record<string, string>) => void;
    end: (body: string) => void;
  },
) => void;

/** Build the request handler. Exposed for unit tests so the routing can be exercised
 * without binding a socket. */
export function createStatusHandler(deps: StatusDeps): StatusRequestHandler {
  return (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildStatus(deps)));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  };
}

/**
 * Start the loopback-bound runtime status server. Auxiliary to the bot: a bind failure
 * (e.g. port already in use) is logged and the bot keeps running — never fatal. Returns
 * the `Server` so callers can close it on shutdown, or `undefined` if construction threw.
 */
export function startStatusServer(
  deps: StatusDeps = defaultStatusDeps(),
  opts?: { port?: number; host?: string },
): Server | undefined {
  const port = opts?.port ?? Number(process.env.STATUS_PORT ?? 8787);
  const host = opts?.host ?? "127.0.0.1";
  try {
    const server = createServer(createStatusHandler(deps));
    server.on("error", (err) => {
      logger.error(`Status server error (status endpoint disabled): ${err}`);
    });
    server.listen(port, host, () => {
      logger.startup(`Status endpoint listening on http://${host}:${port}/status`);
    });
    return server;
  } catch (err) {
    logger.error(`Failed to start status server: ${err}`);
    return undefined;
  }
}
