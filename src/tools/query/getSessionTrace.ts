import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getSession } from "../../sessions.js";
import { getActiveChange } from "../../changes/activeState.js";
import { getRepositoriesDir } from "../../config.js";

/**
 * Derive the SDK's cwd-slug from a directory path.
 * The SDK stores sessions in ~/.claude/projects/{slug}/ where slug is
 * the absolute path with '/' replaced by '-'.
 */
function cwdToSlug(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

interface TraceEntry {
  type: string;
  subtype?: string;
  timestamp?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  content?: string;
}

function parseJsonlLine(line: string, verbose: boolean): TraceEntry | null {
  try {
    const obj = JSON.parse(line);
    const entry: TraceEntry = {
      type: obj.type ?? "unknown",
      subtype: obj.subtype,
      timestamp: obj.timestamp,
    };

    // Extract tool call info from assistant messages
    if (obj.type === "assistant" && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === "tool_use") {
          entry.toolName = block.name;
          if (verbose) {
            entry.toolArgs = block.input;
          }
        }
      }
    }

    // Extract text content (truncated)
    if (obj.type === "assistant" && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) {
          entry.content = block.text.substring(0, verbose ? 500 : 100);
        }
      }
    }

    if (obj.type === "result") {
      entry.subtype = obj.subtype;
      if (verbose && obj.result) {
        entry.content = String(obj.result).substring(0, 500);
      }
    }

    return entry;
  } catch {
    return null;
  }
}

export function createGetSessionTraceTool(_ctx: QueryToolContext) {
  return tool(
    "get_session_trace",
    "Retrieve the SDK conversation trace for a Clack session. Shows the full message flow including tool calls and results. Admin only.",
    {
      sessionId: z.string().describe("The Clack session ID to retrieve the trace for"),
      verbose: z.boolean().optional().describe("Include tool call args and truncated results (default: false)"),
      source: z.enum(["qa", "change"]).optional().describe("Which trace to retrieve: 'qa' (default) or 'change' execution trace"),
    },
    async ({ sessionId, verbose = false, source = "qa" }) => {
      const session = await getSession(sessionId);
      if (!session) {
        return textResult({ error: `Session ${sessionId} not found` });
      }

      // Determine which SDK session ID to use
      let sdkSessionId: string | undefined;
      if (source === "change") {
        const activeChange = getActiveChange(sessionId);
        sdkSessionId = activeChange?.sdkSessionId;
        if (!sdkSessionId) {
          return textResult({ error: "No change execution SDK session found for this session" });
        }
      } else {
        sdkSessionId = session.sdkSessionId;
        if (!sdkSessionId) {
          // Also report if a change session exists
          const activeChange = getActiveChange(sessionId);
          const hint = activeChange?.sdkSessionId
            ? ` (a change execution trace IS available — use source: "change")`
            : "";
          return textResult({ error: `No SDK session ID stored for this session${hint}` });
        }
      }

      // Determine the SDK session file path.
      // Q&A sessions use cwd=repos dir. Change sessions use cwd=worktree path.
      let cwd: string;
      if (source === "change") {
        const ac = getActiveChange(sessionId);
        cwd = ac?.worktree?.worktreePath ?? getRepositoriesDir();
      } else {
        cwd = getRepositoriesDir();
      }
      const slug = cwdToSlug(cwd);
      const sessionFile = resolve(homedir(), ".claude", "projects", slug, `${sdkSessionId}.jsonl`);

      let content: string;
      try {
        content = await readFile(sessionFile, "utf-8");
      } catch {
        return textResult({ error: `SDK session file not found at ${sessionFile}. The session trace may have been cleaned up.` });
      }

      const lines = content.split("\n").filter((l) => l.trim());
      const entries: TraceEntry[] = [];

      for (const line of lines) {
        const entry = parseJsonlLine(line, verbose);
        if (entry) entries.push(entry);
      }

      return textResult({
        sessionId,
        sdkSessionId,
        source,
        totalMessages: entries.length,
        trace: entries,
      });
    },
  );
}
