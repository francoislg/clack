import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { checkSidecarReachable } from "./sidecar.js";
import { findLatestRecording } from "../tools/worker/recordAndUpload.js";

// Real-I/O smoke test for the tester recording pipeline: sidecar container →
// MCP-driven browser → .webm on the shared volume → ffmpeg mp4. Runs ONLY when
// TESTER_SMOKE=1 (set by scripts/tester-smoke.sh, which also owns the sidecar's
// docker lifecycle) so `npm test` and the pre-commit hook never require Docker.
const SMOKE_ENABLED = process.env.TESTER_SMOKE === "1";

const SIDECAR_URL = process.env.TESTER_SIDECAR_URL ?? "http://localhost:8931/mcp";
const RECORDINGS_DIR = resolve("data/tester/recordings");

const execFileAsync = promisify(execFile);

interface RpcCall {
  method: string;
  params?: object;
  id?: number;
}

async function rpc(
  call: RpcCall,
  sessionId?: string,
): Promise<{ body: string; sessionId: string | null }> {
  const response = await fetch(SIDECAR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId && { "mcp-session-id": sessionId }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...call }),
    signal: AbortSignal.timeout(90_000),
  });
  return { body: await response.text(), sessionId: response.headers.get("mcp-session-id") };
}

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!SMOKE_ENABLED)("tester recording pipeline (live sidecar)", () => {
  it(
    "drives a recorded browser session and lands a webm on the shared volume",
    { timeout: 120_000 },
    async () => {
      assert.equal(
        await checkSidecarReachable(SIDECAR_URL),
        true,
        `sidecar not reachable at ${SIDECAR_URL} — run via scripts/tester-smoke.sh`,
      );

      const startedAt = Date.now();

      const init = await rpc({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "tester-smoke", version: "1.0" },
        },
      });
      assert.ok(init.sessionId, "initialize returned no mcp-session-id");
      const sessionId = init.sessionId;

      await rpc({ method: "notifications/initialized" }, sessionId);

      const nav = await rpc(
        {
          id: 2,
          method: "tools/call",
          params: { name: "browser_navigate", arguments: { url: "https://example.com" } },
        },
        sessionId,
      );
      assert.ok(nav.body.includes("Example Domain"), `navigate failed: ${nav.body.slice(0, 300)}`);

      // Finalizes the video. Tolerated failure: the server may have already closed the
      // context when the previous HTTP transport disconnected — the video is written
      // either way, which is exactly what the poll below asserts.
      await rpc(
        { id: 3, method: "tools/call", params: { name: "browser_close", arguments: {} } },
        sessionId,
      ).catch(() => {});

      let webm: string | null = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const candidate = findLatestRecording(RECORDINGS_DIR);
        if (candidate && statSync(candidate).mtimeMs >= startedAt - 2000) {
          webm = candidate;
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }
      assert.ok(webm, `no fresh .webm landed under ${RECORDINGS_DIR}`);
      assert.ok(statSync(webm).size > 0, "recording is empty");

      if (await hasFfmpeg()) {
        const mp4 = webm.replace(/\.webm$/, ".mp4");
        await execFileAsync("ffmpeg", ["-y", "-i", webm, mp4]);
        assert.ok(existsSync(mp4) && statSync(mp4).size > 0, "transcode produced no mp4");
        rmSync(mp4, { force: true });
      } else {
        console.log(
          "ffmpeg not installed locally — transcode step skipped (verified in the image build)",
        );
      }

      rmSync(webm, { force: true });
    },
  );
});
