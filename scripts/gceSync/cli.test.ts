import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, writeFileSync } from "node:fs";

import { serializeBaseline, withAgreement } from "./baseline.js";
import { applyPush, runPull } from "./cli.js";
import { planPull, type PullPlan, type PushPlan } from "./plan.js";
import {
  containerReadCheckCommand,
  pullArchiveCommand,
  pushApplyCommand,
} from "./remoteCommands.js";
import { pullArchive, pushArchive, runSsh, type VmTarget } from "./vm.js";

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("./vm.js", () => ({
  pullArchive: vi.fn(),
  pushArchive: vi.fn(),
  runSsh: vi.fn(),
  vmTargetFromEnv: vi.fn(),
}));
vi.mock("./remoteCommands.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./remoteCommands.js")>()),
  containerReadCheckCommand: vi.fn(),
  pullArchiveCommand: vi.fn(),
  pushApplyCommand: vi.fn(),
}));
vi.mock("./baseline.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./baseline.js")>()),
  serializeBaseline: vi.fn(),
  withAgreement: vi.fn(),
}));
vi.mock("./plan.js", () => ({
  planPull: vi.fn(),
  planPush: vi.fn(),
}));
vi.mock("./report.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./report.js")>()),
  formatPullPlan: vi.fn(),
}));

const target: VmTarget = { instance: "vm", zone: "z", mount: "/mnt/m" };
const baseline = new Map([["data/a.md", "base"]]);
const merged = new Map([["data/a.md", "merged"]]);
const local = new Map([["data/a.md", "local"]]);
const remote = new Map([["data/a.md", "vm"]]);

beforeEach(() => {
  vi.resetAllMocks();
});

function pushPlan(overrides: Partial<PushPlan>): PushPlan {
  return {
    create: [],
    replace: [],
    skipped: [],
    refused: [],
    vmOnly: [],
    inSync: [],
    agreed: new Map(),
    ...overrides,
  };
}

function pullPlan(overrides: Partial<PullPlan>): PullPlan {
  return {
    create: [],
    replace: [],
    pendingPush: [],
    localOnly: [],
    inSync: [],
    agreed: new Map(),
    ...overrides,
  };
}

describe("applyPush", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(withAgreement).mockReturnValue(merged);
    vi.mocked(serializeBaseline).mockReturnValue("serialized");
    vi.mocked(pushApplyCommand).mockReturnValue("apply-cmd");
    vi.mocked(containerReadCheckCommand).mockReturnValue("read-check-cmd");
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("pushes nothing and records no baseline when any file is refused", async () => {
    const plan = pushPlan({
      replace: ["data/ok.md"],
      refused: [{ path: "data/bad.md", classification: "changed-vm" }],
    });

    await applyPush(target, "/p", plan, new Map([["data/ok.md", "vm"]]), baseline, "/p/b.json");

    expect(pushArchive).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("passes the VM hash the plan saw to the remote re-check, then records the agreed baseline", async () => {
    const plan = pushPlan({
      replace: ["data/a.md"],
      create: ["data/new.md"],
      agreed: new Map([["data/a.md", "local"]]),
    });
    vi.mocked(runSsh).mockResolvedValue("");

    await applyPush(target, "/p", plan, new Map([["data/a.md", "vm"]]), baseline, "/p/b.json");

    expect(pushApplyCommand).toHaveBeenCalledWith(
      "/mnt/m",
      expect.any(String),
      [{ path: "data/a.md", expectedVmHash: "vm" }],
      ["data/new.md"],
    );
    expect(pushArchive).toHaveBeenCalledWith(
      target,
      "/p",
      ["data/a.md", "data/new.md"],
      "apply-cmd",
    );
    expect(withAgreement).toHaveBeenCalledWith(baseline, plan.agreed);
    expect(serializeBaseline).toHaveBeenCalledWith(merged);
    expect(writeFileSync).toHaveBeenCalledWith("/p/b.json", "serialized");
    expect(process.exitCode).toBeUndefined();
  });

  it("records no baseline when the transfer fails", async () => {
    vi.mocked(pushArchive).mockRejectedValue(new Error("ssh exited with code 255"));
    const plan = pushPlan({ create: ["data/new.md"] });

    await expect(applyPush(target, "/p", plan, new Map(), baseline, "/p/b.json")).rejects.toThrow(
      "ssh exited with code 255",
    );

    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("keeps a successful push successful when the read-access check can't reach the VM", async () => {
    vi.mocked(runSsh).mockRejectedValue(new Error("ssh exited with code 255"));
    const plan = pushPlan({ create: ["data/new.md"] });

    await applyPush(target, "/p", plan, new Map(), baseline, "/p/b.json");

    expect(writeFileSync).toHaveBeenCalledWith("/p/b.json", "serialized");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Could not verify container read access"),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("fails when the container user can't read a pushed file", async () => {
    vi.mocked(runSsh).mockResolvedValue("data/new.md\n");
    const plan = pushPlan({ create: ["data/new.md"] });

    await applyPush(target, "/p", plan, new Map(), baseline, "/p/b.json");

    expect(runSsh).toHaveBeenCalledWith(target, "read-check-cmd");
    expect(process.exitCode).toBe(1);
  });
});

describe("runPull", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(withAgreement).mockReturnValue(merged);
    vi.mocked(serializeBaseline).mockReturnValue("serialized");
    vi.mocked(pullArchiveCommand).mockReturnValue("pull-cmd");
  });

  it("writes nothing on a dry run", async () => {
    const plan = pullPlan({ replace: [{ path: "data/a.md", backup: true }] });

    vi.mocked(planPull).mockReturnValue(plan);

    await runPull(target, "/p", true, local, remote, baseline, "/p/b.json");

    expect(planPull).toHaveBeenCalledWith(local, remote, baseline);

    expect(copyFileSync).not.toHaveBeenCalled();
    expect(pullArchive).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("backs up locally edited copies and reports where before transferring, and records no baseline when the transfer fails", async () => {
    vi.mocked(pullArchive).mockRejectedValue(new Error("ssh exited with code 255"));
    const plan = pullPlan({
      replace: [
        { path: "data/a.md", backup: true },
        { path: "data/b.md", backup: false },
      ],
    });

    vi.mocked(planPull).mockReturnValue(plan);

    await expect(
      runPull(target, "/p", false, local, remote, baseline, "/p/b.json"),
    ).rejects.toThrow("ssh exited with code 255");

    expect(copyFileSync).toHaveBeenCalledTimes(1);
    expect(copyFileSync).toHaveBeenCalledWith(
      "/p/data/a.md",
      expect.stringMatching(/^\/p\/data\/\.gce-sync-backups\/pull-\d{8}-\d{6}\/data\/a\.md$/),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Local copies backed up to data/.gce-sync-backups/pull-"),
    );
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("records the agreed baseline after a successful transfer", async () => {
    const plan = pullPlan({
      create: ["data/new.md"],
      agreed: new Map([["data/new.md", "vm"]]),
    });

    vi.mocked(planPull).mockReturnValue(plan);

    await runPull(target, "/p", false, local, remote, baseline, "/p/b.json");

    expect(pullArchive).toHaveBeenCalledWith(target, "/p", ["data/new.md"], "pull-cmd");
    expect(withAgreement).toHaveBeenCalledWith(baseline, plan.agreed);
    expect(writeFileSync).toHaveBeenCalledWith("/p/b.json", "serialized");
  });
});
