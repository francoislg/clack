import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getSlackClient } from "../../slack/app.js";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import { markUploaded, reservePath, type UploadedFileInfo } from "../../managedFiles/files.js";
import { TESTER_OWNER } from "../../managedFiles/roots.js";

const execFileAsync = promisify(execFile);

const GITHUB_DECLINE_NOTE =
  "GitHub delivery is not available (Slack-only in v1; the GitHub REST API cannot attach video " +
  "to a PR/issue comment — branch-commit or release-asset delivery is planned as a follow-up). " +
  "The recording was uploaded to the Slack thread instead.";

/**
 * Newest `.webm` under the recordings dir (the shared volume the sidecar writes to),
 * scanned recursively because the Playwright MCP nests per-session output folders.
 */
export function findLatestRecording(dir: string): string | null {
  if (!existsSync(dir)) return null;
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    if (!rel.endsWith(".webm")) continue;
    const full = join(dir, rel);
    try {
      const stat = statSync(full);
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { path: full, mtimeMs: stat.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  return newest?.path ?? null;
}

// Pace floor: mpdecimate drops at most this many consecutive duplicate frames, so a
// frozen stretch plays at ~1/(N+1) of real time instead of vanishing entirely.
const CONDENSE_MAX_CONSECUTIVE_DROPS = 12;

/** Transcode args that also condense idle video: duplicate frames (the browser sitting
 * frozen between actions) are dropped and the survivors re-timed to a uniform rate. */
export function buildTranscodeArgs(webmPath: string, mp4Path: string): string[] {
  return [
    "-y",
    "-i",
    webmPath,
    "-vf",
    `mpdecimate=max=${CONDENSE_MAX_CONSECUTIVE_DROPS},setpts=N/FRAME_RATE/TB`,
    mp4Path,
  ];
}

async function transcodeToMp4(webmPath: string, mp4Path: string): Promise<void> {
  await execFileAsync("ffmpeg", buildTranscodeArgs(webmPath, mp4Path));
}

/** The one Slack surface this tool touches — lets tests stub uploads without a full client. */
export interface RecordingUploader {
  filesUploadV2(options: {
    channel_id: string;
    thread_ts: string;
    file: Buffer;
    filename: string;
    title?: string;
  }): Promise<{
    ok?: boolean;
    files?: Array<{ files?: Array<{ id?: string; permalink?: string }> }>;
  }>;
}

export interface RecordAndUploadDeps {
  getSlackClient: () => RecordingUploader | null;
  findLatestRecording: (dir: string) => string | null;
  transcodeToMp4: (webmPath: string, mp4Path: string) => Promise<void>;
  reservePath: (opts: { root: "recordings"; owner: string; name: string }) => Promise<string>;
  markUploaded: (absPath: string, info: UploadedFileInfo) => Promise<void>;
}

export const defaultRecordAndUploadDeps: RecordAndUploadDeps = {
  getSlackClient,
  findLatestRecording,
  transcodeToMp4,
  reservePath: (opts) => reservePath(opts),
  markUploaded: (absPath, info) => markUploaded(absPath, info),
};

export function createRecordAndUploadTool(
  ctx: WorkerToolContext,
  deps: RecordAndUploadDeps = defaultRecordAndUploadDeps,
) {
  return tool(
    "record_and_upload",
    "Deliver the test-session recording: locates the video the Playwright sidecar recorded, " +
      "transcodes it to mp4, and uploads it to the Slack thread. Call this once, after the " +
      "browser session is closed (the video file is finalized on close).",
    {
      title: z.string().optional().describe("Title shown on the uploaded video in Slack"),
      video_file: z
        .string()
        .optional()
        .describe(
          "Path of a specific .webm inside the recordings directory. Omit to use the most recent recording.",
        ),
      target: z
        .enum(["slack", "github"])
        .optional()
        .describe(
          "Delivery target. Only 'slack' is supported; 'github' is declined with an explanation.",
        ),
    },
    async (args) => {
      const tester = ctx.config.tester;
      if (!tester?.recordingsDir) {
        return errorResult(
          "Tester recordings directory is not configured (config.tester.recordingsDir). Cannot locate the recording.",
        );
      }

      let webmPath: string | null;
      if (args.video_file) {
        const candidate = resolve(tester.recordingsDir, args.video_file);
        // path.relative-based containment: a bare startsWith would let a sibling dir
        // ("recordings-x") or "../" hop pass the prefix check.
        const rel = relative(resolve(tester.recordingsDir), candidate);
        if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
          return errorResult("video_file must be inside the recordings directory.");
        }
        webmPath = existsSync(candidate) ? candidate : null;
      } else {
        webmPath = deps.findLatestRecording(tester.recordingsDir);
      }
      if (!webmPath) {
        return errorResult(
          `Configuration error: no recording found under the shared recordings volume at "${tester.recordingsDir}". ` +
            "Verify the sidecar's recordVideo dir (docker/clack-playwright/config.json) is mounted at this path and the browser session was closed.",
        );
      }

      let mp4Path: string;
      try {
        mp4Path = await deps.reservePath({
          root: "recordings",
          owner: TESTER_OWNER,
          name: basename(webmPath).replace(/\.webm$/, ".mp4"),
        });
      } catch (error) {
        return errorResult(`Could not reserve the recording output path: ${errorMessage(error)}`);
      }

      try {
        await deps.transcodeToMp4(webmPath, mp4Path);
      } catch (error) {
        return errorResult(
          `webm→mp4 transcode failed (nothing was uploaded): ${errorMessage(error)}`,
        );
      }

      const client = deps.getSlackClient();
      if (!client) {
        return errorResult("Slack client not available");
      }

      const filename = `test-recording-${ctx.branchName.replace(/\//g, "-")}.mp4`;
      let uploaded: { id?: string; permalink?: string } | undefined;
      try {
        const result = await client.filesUploadV2({
          channel_id: ctx.channelId,
          thread_ts: ctx.threadTs,
          file: readFileSync(mp4Path),
          filename,
          ...(args.title && { title: args.title }),
        });
        uploaded = result.files?.[0]?.files?.[0];
      } catch (error) {
        return errorResult(
          `Slack upload failed — the recording was NOT delivered (local file kept at ${mp4Path}): ${errorMessage(error)}`,
        );
      }

      try {
        await deps.markUploaded(mp4Path, {
          fileId: uploaded?.id,
          permalink: uploaded?.permalink,
          channel: ctx.channelId,
          threadTs: ctx.threadTs,
        });
      } catch (error) {
        // Ledger bookkeeping only — the recording was delivered, so the tool still succeeds.
        logger.warn("Failed to record uploaded recording in the managed-files ledger:", error);
      }

      return textResult({
        success: true,
        uploaded: "slack",
        file: filename,
        ...(args.target === "github" && { note: GITHUB_DECLINE_NOTE }),
      });
    },
  );
}
