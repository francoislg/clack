import { z } from "zod";
import { basename } from "node:path";
import { stat, readFile } from "node:fs/promises";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { logger } from "../../logger.js";
import { resolveOwnedFile, markUploaded, type UploadedFileInfo } from "../../managedFiles/files.js";

const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface UploadFileDeps {
  resolveOwnedFile: (opts: {
    owner: string;
    path: string;
  }) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  markUploaded: (absPath: string, info: UploadedFileInfo) => Promise<void>;
  stat: (path: string) => Promise<{ isFile(): boolean; size: number }>;
  readFile: (path: string) => Promise<Buffer>;
}

export const defaultUploadFileDeps: UploadFileDeps = {
  resolveOwnedFile: (opts) => resolveOwnedFile(opts),
  markUploaded: (absPath, info) => markUploaded(absPath, info),
  stat: (path) => stat(path),
  readFile: (path) => readFile(path),
};

type UploadSource =
  | {
      ok: true;
      payload: { content: string } | { file: Buffer };
      filename: string;
      absPath?: string;
    }
  | { ok: false; error: string };

async function resolveFileSource(
  ctx: QueryToolContext,
  deps: UploadFileDeps,
  filePath: string,
  filename: string | undefined,
): Promise<UploadSource> {
  try {
    return await readOwnedFile(ctx, deps, filePath, filename);
  } catch (error) {
    logger.error(`Failed to read file for upload: ${filePath}`, error);
    return { ok: false, error: `Could not read file: ${filePath}` };
  }
}

async function readOwnedFile(
  ctx: QueryToolContext,
  deps: UploadFileDeps,
  filePath: string,
  filename: string | undefined,
): Promise<UploadSource> {
  const resolved = await deps.resolveOwnedFile({ owner: ctx.session.sessionId, path: filePath });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const info = await deps.stat(resolved.path);
  if (!info.isFile()) return { ok: false, error: `Not a file: ${filePath}` };
  if (info.size === 0) return { ok: false, error: `File is empty: ${filePath}` };
  if (info.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error:
        `File is too large (${Math.round(info.size / (1024 * 1024))}MB). ` +
        `Maximum is ${MAX_FILE_BYTES / (1024 * 1024)}MB. Export a narrower query.`,
    };
  }

  const file = await deps.readFile(resolved.path);
  return {
    ok: true,
    payload: { file },
    filename: filename ?? basename(resolved.path),
    absPath: resolved.path,
  };
}

function resolveContentSource(content: string, filename: string | undefined): UploadSource {
  if (!content.trim()) return { ok: false, error: "Content must be non-empty" };

  const contentBytes = Buffer.byteLength(content, "utf-8");
  if (contentBytes > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      error:
        `Content is too large (${Math.round(contentBytes / 1024)}KB) to pass inline. ` +
        `Maximum is ${MAX_CONTENT_BYTES / 1024}KB. If the data is already a file in this session's downloads folder (e.g. an export), upload it with file_path instead; otherwise summarize or split it.`,
    };
  }
  if (!filename) return { ok: false, error: "filename is required with content" };

  return { ok: true, payload: { content }, filename };
}

export function createUploadFileTool(
  ctx: QueryToolContext,
  deps: UploadFileDeps = defaultUploadFileDeps,
) {
  return tool(
    "upload_file",
    "Upload a file to Slack as an attachment. Pass exactly one of `content` or `file_path`. " +
      "`content`: small generated content (CSV, JSON, Markdown, code, config), up to 64KB. " +
      "`file_path`: a file already in this session's downloads folder — where exports such as Metabase's are saved — up to 50MB; its bytes go straight to Slack. " +
      "An export's result already carries its row count and a preview, so don't Read an export to re-type it as `content`; if you must inspect one, Read a slice (offset/limit). " +
      "Use this when the user asks for exportable data, when displaying file contents, or when a response is too large for a chat message. " +
      "You must still call submit_response after uploading to explain what you uploaded.",
    {
      content: z
        .string()
        .optional()
        .describe("The file content to upload — small generated content only"),
      file_path: z
        .string()
        .optional()
        .describe(
          "Path of a file in this session's downloads folder (absolute, or relative to it) — e.g. the file_path an export returned",
        ),
      filename: z
        .string()
        .optional()
        .describe(
          "Filename with extension, e.g. 'report.csv'. Required with content; defaults to the file's name with file_path",
        ),
      title: z.string().optional().describe("Display title in Slack (defaults to filename)"),
      channel: z
        .string()
        .optional()
        .describe(
          "Target channel ID. Only provide when the user explicitly asked to upload to a DIFFERENT channel than the current one. Omit to upload to the current channel.",
        ),
      thread_ts: z
        .string()
        .optional()
        .describe(
          "Target thread timestamp. Only provide when the user explicitly asked to post in a DIFFERENT thread than the current one (e.g. they shared a Slack message URL). Never fabricate this — omit it to post in the current thread.",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("File upload requires a Slack connection");
      }

      const hasContent = args.content !== undefined;
      const hasFilePath = args.file_path !== undefined;
      if (hasContent === hasFilePath) {
        return errorResult("Pass exactly one of content or file_path");
      }

      const source =
        args.file_path !== undefined
          ? await resolveFileSource(ctx, deps, args.file_path, args.filename)
          : resolveContentSource(args.content ?? "", args.filename);
      if (!source.ok) return errorResult(source.error);

      const channelId = args.channel ?? ctx.session.channelId;
      const threadTs =
        args.thread_ts ?? (channelId === ctx.session.channelId ? ctx.session.threadTs : undefined);

      let file: { id?: string; permalink?: string } | undefined;
      try {
        const uploadArgs = {
          channel_id: channelId,
          ...source.payload,
          filename: source.filename,
          title: args.title ?? source.filename,
        };
        const result = await ctx.slackClient.filesUploadV2(
          threadTs ? { ...uploadArgs, thread_ts: threadTs } : uploadArgs,
        );
        file = result.files?.[0]?.files?.[0];
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        logger.error("Failed to upload file to Slack:", error);
        return errorResult(`Failed to upload file to Slack: ${message}`);
      }

      if (source.absPath) {
        try {
          await deps.markUploaded(source.absPath, {
            fileId: file?.id,
            permalink: file?.permalink,
            channel: channelId,
            threadTs,
          });
        } catch (error) {
          logger.warn("Failed to record uploaded file in the managed-files ledger:", error);
        }
      }

      return textResult({
        ok: true,
        file_id: file?.id ?? null,
        permalink: file?.permalink ?? null,
      });
    },
  );
}
