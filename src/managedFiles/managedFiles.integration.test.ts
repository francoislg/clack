import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { createSlackClientMock } from "../slack/testSlackClient.js";
import { stub } from "../testStubs.js";
import type { QueryToolContext } from "../tools/types.js";
import { createUploadFileTool } from "../tools/query/uploadFile.js";
import { createFile, defaultFilesDeps, resolveOwnedFile, type FilesDeps } from "./files.js";
import { clearLedgerCache, loadLedger } from "./ledger.js";
import { getManagedRoots, TESTER_OWNER } from "./roots.js";
import { defaultSweepDeps, sweepManagedFiles, type SweepDeps } from "./sweep.js";

const paths = vi.hoisted(() => ({ tmp: "" }));

function testConfig(): Config {
  return stub<Config>({ tester: { recordingsDir: join(paths.tmp, "recordings") } });
}

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    getDownloadsDir: () => join(paths.tmp, "downloads"),
    getFileLedgerPath: () => join(paths.tmp, "state", "file-ledger.json"),
    getConfig: () => testConfig(),
  };
});

const HOUR_MS = 60 * 60 * 1000;

function filesDeps(overrides: Partial<FilesDeps> = {}): FilesDeps {
  return { ...defaultFilesDeps, getRoots: () => getManagedRoots(testConfig()), ...overrides };
}

function downloads(...segments: string[]): string {
  return join(paths.tmp, "downloads", ...segments);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function makeContext(sessionId: string, slackClient: QueryToolContext["slackClient"]) {
  return stub<QueryToolContext>({
    mode: "query",
    userId: "U1",
    role: "member",
    session: { sessionId, channelId: "C1", threadTs: "1.000001" },
    slackClient,
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
  });
}

beforeEach(async () => {
  paths.tmp = await mkdtemp(join(tmpdir(), "clack-managed-files-"));
  clearLedgerCache();
});

afterEach(async () => {
  clearLedgerCache();
  await rm(paths.tmp, { recursive: true, force: true });
});

describe("managed files (integration)", () => {
  it("createFile writes into the owner folder, records it, and de-duplicates names", async () => {
    const deps = filesDeps();
    const first = await createFile(
      { root: "downloads", owner: "S1", name: "report.csv", data: "a,b\n" },
      deps,
    );
    const second = await createFile(
      { root: "downloads", owner: "S1", name: "report.csv", data: "c,d\n" },
      deps,
    );

    expect(first).toBe(downloads("S1", "report.csv"));
    expect(second).toBe(downloads("S1", "report-1.csv"));
    expect(await readFile(first, "utf-8")).toBe("a,b\n");
    expect(await readFile(second, "utf-8")).toBe("c,d\n");

    const ledger = await loadLedger();
    expect(ledger.map((e) => ({ root: e.root, path: e.path, owner: e.owner }))).toEqual([
      { root: "downloads", path: "S1/report.csv", owner: "S1" },
      { root: "downloads", path: "S1/report-1.csv", owner: "S1" },
    ]);
  });

  it("resolveOwnedFile tags external files and refuses paths outside the owner folder", async () => {
    await mkdir(downloads("S1"), { recursive: true });
    await mkdir(downloads("S2"), { recursive: true });
    await writeFile(downloads("S1", "export.csv"), "x,y\n");
    const outsideDir = join(paths.tmp, "outside");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.csv"), "secret\n");
    await symlink(join(outsideDir, "secret.csv"), downloads("S1", "link.csv"));
    const deps = filesDeps();

    const owned = await resolveOwnedFile({ owner: "S1", path: "export.csv" }, deps);
    expect(owned).toEqual({ ok: true, path: await deps.realpath(downloads("S1", "export.csv")) });
    const ledger = await loadLedger();
    expect(ledger).toEqual([
      expect.objectContaining({ root: "downloads", path: "S1/export.csv", owner: "S1" }),
    ]);

    const crossOwner = await resolveOwnedFile({ owner: "S2", path: "../S1/export.csv" }, deps);
    expect(crossOwner.ok).toBe(false);

    const viaSymlink = await resolveOwnedFile({ owner: "S1", path: "link.csv" }, deps);
    expect(viaSymlink.ok).toBe(false);

    expect(await loadLedger()).toHaveLength(1);
  });

  it("upload_file sends the on-disk bytes and records the upload in the ledger", async () => {
    await mkdir(downloads("S1"), { recursive: true });
    const bytes = Buffer.from("id,name\n1,alpha\n2,beta\n");
    await writeFile(downloads("S1", "export.csv"), bytes);
    const client = createSlackClientMock();
    client.filesUploadV2.mockResolvedValue({
      ok: true,
      files: [{ ok: true, files: [{ id: "F1", permalink: "https://x/F1" }] }],
    });

    const tool = createUploadFileTool(makeContext("S1", client));
    const result = await tool.handler(
      {
        content: undefined,
        file_path: "export.csv",
        filename: undefined,
        title: undefined,
        channel: undefined,
        thread_ts: undefined,
      },
      {},
    );

    expect(result.isError).toBeFalsy();
    expect(client.filesUploadV2).toHaveBeenCalledTimes(1);
    const uploadArgs = client.filesUploadV2.mock.calls[0][0];
    expect(uploadArgs).toMatchObject({
      channel_id: "C1",
      thread_ts: "1.000001",
      filename: "export.csv",
    });
    expect(uploadArgs).toHaveProperty("file", bytes);

    const ledger = await loadLedger();
    expect(ledger).toEqual([
      expect.objectContaining({
        root: "downloads",
        path: "S1/export.csv",
        owner: "S1",
        uploadedAt: expect.any(String),
        fileId: "F1",
        permalink: "https://x/F1",
      }),
    ]);
  });

  it("sweep deletes expired files, keeps live owners' files, tags recordings, and prunes folders", async () => {
    const start = new Date();
    const sweepAt = new Date(start.getTime() + 8 * 24 * HOUR_MS);

    await mkdir(downloads("S1"), { recursive: true });
    await writeFile(downloads("S1", "export.csv"), "a\n");
    const client = createSlackClientMock();
    client.filesUploadV2.mockResolvedValue({
      ok: true,
      files: [{ ok: true, files: [{ id: "F1", permalink: "https://x/F1" }] }],
    });
    const uploaded = await createUploadFileTool(makeContext("S1", client)).handler(
      {
        content: undefined,
        file_path: "export.csv",
        filename: undefined,
        title: undefined,
        channel: undefined,
        thread_ts: undefined,
      },
      {},
    );
    expect(uploaded.isError).toBeFalsy();

    const thirtyHoursEarlier = new Date(sweepAt.getTime() - 30 * HOUR_MS);
    const stale = await createFile(
      { root: "downloads", owner: "S2", name: "draft.csv", data: "b\n" },
      filesDeps({ now: () => thirtyHoursEarlier }),
    );

    const live = await createFile(
      { root: "downloads", owner: "S3", name: "keep.csv", data: "c\n" },
      filesDeps({ now: () => new Date(start.getTime() - 30 * 24 * HOUR_MS) }),
    );

    const recordingDir = join(paths.tmp, "recordings", "run1");
    await mkdir(recordingDir, { recursive: true });
    const recording = join(recordingDir, "video.webm");
    await writeFile(recording, "webm");
    const recent = new Date(sweepAt.getTime() - HOUR_MS);
    await utimes(recording, recent, recent);

    const sentinel = join(paths.tmp, "outside", "sentinel.txt");
    await mkdir(join(paths.tmp, "outside"), { recursive: true });
    await writeFile(sentinel, "keep");

    const isOwnerLive = vi.fn<SweepDeps["isOwnerLive"]>(async (_root, owner) => owner === "S3");
    const result = await sweepManagedFiles({
      ...defaultSweepDeps(),
      now: () => sweepAt,
      isOwnerLive,
    });

    expect([...result.deleted].sort()).toEqual([
      "downloads/S1/export.csv",
      "downloads/S2/draft.csv",
    ]);
    expect(result.tagged).toBe(1);
    expect(await exists(downloads("S1", "export.csv"))).toBe(false);
    expect(await exists(stale)).toBe(false);
    expect(await exists(live)).toBe(true);
    expect(await exists(recording)).toBe(true);
    expect(await exists(downloads("S1"))).toBe(false);
    expect(await exists(downloads("S2"))).toBe(false);
    expect(await exists(downloads("S3"))).toBe(true);
    expect(await exists(downloads())).toBe(true);
    expect(await exists(join(paths.tmp, "recordings"))).toBe(true);
    expect(await readFile(sentinel, "utf-8")).toBe("keep");

    const ledger = await loadLedger();
    expect(ledger.map((e) => ({ root: e.root, path: e.path, owner: e.owner }))).toEqual(
      expect.arrayContaining([
        { root: "downloads", path: "S3/keep.csv", owner: "S3" },
        { root: "recordings", path: "run1/video.webm", owner: TESTER_OWNER },
      ]),
    );
    expect(ledger).toHaveLength(2);
  });
});
