import { createServer, type Server } from "http";
import { timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";
import { snapshot as activeRunsSnapshot, type ActiveRunInfo } from "./slack/activeRuns.js";
import { snapshotRunningChanges, type RunningChangeInfo } from "./changes/activeState.js";
import { buildSystemPrompt } from "./claude/promptBuilder.js";
import type { UserRole } from "./roles.js";

export interface StatusPayload {
  version: string;
  uptimeSec: number;
  activeRuns: { count: number; runs: ActiveRunInfo[] };
  workers: { active: number; changes: RunningChangeInfo[] };
  busy: boolean;
}

export interface PromptRenderParams {
  role: UserRole;
  changesWorkflowEnabled: boolean;
  workMode: boolean;
  preAttachedTopics: string[];
}

export interface StatusDeps {
  activeRuns: () => { count: number; runs: ActiveRunInfo[] };
  runningChanges: () => { active: number; changes: RunningChangeInfo[] };
  uptimeSec: () => number;
  version: string;
  renderSystemPrompt: (params: PromptRenderParams) => string;
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
    renderSystemPrompt: (params) =>
      buildSystemPrompt({
        role: params.role,
        changesWorkflowEnabled: params.changesWorkflowEnabled,
        workMode: params.workMode,
        preAttachedTopics: params.preAttachedTopics,
      }),
  };
}

export type StatusRequestHandler = (
  req: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
  },
  res: {
    writeHead: (status: number, headers: Record<string, string>) => void;
    end: (body: string) => void;
  },
) => void;

/** Constant-time token check. Accepts `Authorization: Bearer <token>` or `x-status-token`. */
function isAuthorized(
  headers: Record<string, string | string[] | undefined> | undefined,
  token: string,
): boolean {
  const auth = headers?.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const headerToken = headers?.["x-status-token"];
  const presented = bearer ?? (typeof headerToken === "string" ? headerToken : undefined);
  if (presented === undefined) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build the request handler. Exposed for unit tests so the routing can be exercised
 * without binding a socket. */
const VALID_ROLES: ReadonlySet<string> = new Set(["member", "dev", "admin", "owner"]);

export function createStatusHandler(deps: StatusDeps, token?: string): StatusRequestHandler {
  const promptToken = token !== undefined && token.length > 0 ? token : undefined;
  return (req, res) => {
    const [path = "", query = ""] = (req.url ?? "").split("?");
    if (req.method === "GET" && path === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildStatus(deps)));
      return;
    }
    if (req.method === "GET" && path === "/prompt") {
      if (promptToken === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: "prompt endpoint disabled — set STATUS_TOKEN to enable it" }),
        );
        return;
      }
      if (!isAuthorized(req.headers, promptToken)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const params = new URLSearchParams(query);
      const role = params.get("role") ?? "member";
      if (!VALID_ROLES.has(role)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: `invalid role '${role}' — one of: member, dev, admin, owner` }),
        );
        return;
      }
      const topics = (params.get("topics") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      let prompt: string;
      try {
        prompt = deps.renderSystemPrompt({
          role: role as UserRole,
          changesWorkflowEnabled: params.get("changesWorkflow") === "1",
          workMode: params.get("workMode") === "1",
          preAttachedTopics: topics,
        });
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `prompt render failed: ${err}` }));
        return;
      }
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "x-prompt-chars": String(prompt.length),
      });
      res.end(prompt);
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
  opts?: { port?: number; host?: string; token?: string },
): Server | undefined {
  const port = opts?.port ?? Number(process.env.STATUS_PORT ?? 8787);
  const host = opts?.host ?? "127.0.0.1";
  const token = opts?.token ?? process.env.STATUS_TOKEN;
  try {
    const server = createServer(createStatusHandler(deps, token));
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
