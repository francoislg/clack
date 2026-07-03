import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  buildTranscodeArgs,
  createRecordAndUploadTool,
  findLatestRecording,
  type RecordAndUploadDeps,
} from "./recordAndUpload.js";
import { parseToolResult } from "../testHelpers.js";
import { makeWorkerCtx, makeWorkerConfig } from "./testCtx.js";
import type { WorkerToolContext } from "../types.js";

const tmpBase = resolve(tmpdir(), `record-upload-${process.pid}`);

function makeTesterCtx(overrides?: Partial<WorkerToolContext>): WorkerToolContext {
  const config = makeWorkerConfig();
  config.tester = {
    enabled: true,
    sidecarUrl: "http://sidecar/mcp",
    recordingsDir: tmpBase,
  };
  return makeWorkerCtx({ kind: "test", config, ...overrides });
}

interface UploadCall {
  channel_id?: string;
  thread_ts?: string;
  filename?: string;
  title?: string;
}

function makeDeps(overrides?: Partial<RecordAndUploadDeps>): RecordAndUploadDeps & {
  uploads: UploadCall[];
} {
  const uploads: UploadCall[] = [];
  const deps: RecordAndUploadDeps = {
    getSlackClient: () => ({
      filesUploadV2: async (args) => {
        uploads.push(args);
        return { ok: true };
      },
    }),
    findLatestRecording: vi.fn(() => join(tmpBase, "session.webm")),
    transcodeToMp4: vi.fn(async (webm: string) => webm.replace(/\.webm$/, ".mp4")),
    ...overrides,
  };
  return Object.assign(deps, { uploads });
}

describe("findLatestRecording", () => {
  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(join(tmpBase, "nested"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("returns null for a missing directory", () => {
    assert.equal(findLatestRecording(join(tmpBase, "nope")), null);
  });

  it("returns null when no webm exists", () => {
    writeFileSync(join(tmpBase, "notes.txt"), "hi");
    assert.equal(findLatestRecording(tmpBase), null);
  });

  it("finds the newest webm recursively", () => {
    const older = join(tmpBase, "old.webm");
    const newer = join(tmpBase, "nested", "new.webm");
    writeFileSync(older, "a");
    writeFileSync(newer, "b");
    const past = new Date(Date.now() - 60_000);
    utimesSync(older, past, past);
    assert.equal(findLatestRecording(tmpBase), newer);
  });
});

describe("buildTranscodeArgs", () => {
  it("condenses idle frames with a pace-floored mpdecimate/setpts chain", () => {
    const args = buildTranscodeArgs("/rec/in.webm", "/rec/in.mp4");
    assert.ok(args.includes("-y"));
    assert.equal(args[args.indexOf("-i") + 1], "/rec/in.webm");
    assert.equal(args[args.indexOf("-vf") + 1], "mpdecimate=max=12,setpts=N/FRAME_RATE/TB");
    assert.equal(args[args.length - 1], "/rec/in.mp4");
  });
});

describe("record_and_upload tool", () => {
  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(join(tmpBase, "session.webm"), "video-bytes");
    writeFileSync(join(tmpBase, "session.mp4"), "mp4-bytes");
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("transcodes then uploads the mp4 to the originating thread", async () => {
    const deps = makeDeps();
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: "Login flow", video_file: undefined, target: undefined },
      { sessionId: "t" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(parsed.uploaded, "slack");
    assert.equal(vi.mocked(deps.transcodeToMp4).mock.calls[0][0], join(tmpBase, "session.webm"));
    assert.equal(deps.uploads.length, 1);
    assert.equal(deps.uploads[0].channel_id, "C123");
    assert.equal(deps.uploads[0].thread_ts, "1.0");
    assert.equal(deps.uploads[0].title, "Login flow");
    assert.ok(deps.uploads[0].filename?.endsWith(".mp4"));
  });

  it("declines a GitHub target with an explanation while still uploading to Slack", async () => {
    const deps = makeDeps();
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: undefined, target: "github" },
      { sessionId: "t" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.ok(String(parsed.note).includes("GitHub delivery is not available"));
    assert.equal(deps.uploads.length, 1);
  });

  it("rejects a video_file that escapes the recordings directory", async () => {
    const deps = makeDeps();
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: "../record-upload-sibling/evil.webm", target: undefined },
      { sessionId: "t" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("inside the recordings directory"));
    assert.equal(deps.uploads.length, 0);
  });

  it("rejects '.' (the recordings directory itself) as a video_file", async () => {
    const deps = makeDeps();
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: ".", target: undefined },
      { sessionId: "t" },
    );

    assert.equal(result.isError, true);
    assert.equal(deps.uploads.length, 0);
  });

  it("accepts an explicit video_file nested inside the recordings directory", async () => {
    mkdirSync(join(tmpBase, "session-1"), { recursive: true });
    writeFileSync(join(tmpBase, "session-1", "run.webm"), "video-bytes");
    writeFileSync(join(tmpBase, "session-1", "run.mp4"), "mp4-bytes");
    const deps = makeDeps();
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: "session-1/run.webm", target: undefined },
      { sessionId: "t" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.success, true);
    assert.equal(
      vi.mocked(deps.transcodeToMp4).mock.calls[0][0],
      join(tmpBase, "session-1", "run.webm"),
    );
  });

  it("errors as a configuration problem when no recording exists on the volume", async () => {
    const deps = makeDeps({ findLatestRecording: vi.fn(() => null) });
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: undefined, target: undefined },
      { sessionId: "t" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("Configuration error"));
    assert.ok(parsed.error.includes(tmpBase));
    assert.equal(deps.uploads.length, 0);
  });

  it("uploads nothing when the transcode fails", async () => {
    const deps = makeDeps({
      transcodeToMp4: vi.fn(async () => {
        throw new Error("ffmpeg exploded");
      }),
    });
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: undefined, target: undefined },
      { sessionId: "t" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("transcode failed"));
    assert.equal(deps.uploads.length, 0);
  });

  it("narrates a Slack upload failure without claiming delivery", async () => {
    const deps = makeDeps();
    deps.getSlackClient = () => ({
      filesUploadV2: async () => {
        throw new Error("upload_error");
      },
    });
    const toolDef = createRecordAndUploadTool(makeTesterCtx(), deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: undefined, target: undefined },
      { sessionId: "t" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("NOT delivered"));
  });

  it("errors when the recordings dir is not configured", async () => {
    const config = makeWorkerConfig();
    config.tester = { enabled: true };
    const ctx = makeWorkerCtx({ kind: "test", config });
    const deps = makeDeps();
    const toolDef = createRecordAndUploadTool(ctx, deps);

    const result = await toolDef.handler(
      { title: undefined, video_file: undefined, target: undefined },
      { sessionId: "t" },
    );

    assert.equal(result.isError, true);
  });
});
