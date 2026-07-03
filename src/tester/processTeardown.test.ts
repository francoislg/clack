import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readAppProcessInfo, teardownAppProcess, type TeardownDeps } from "./processTeardown.js";
import { APP_PROCESS_INFO_FILENAME } from "./prompt.js";

const tmpBase = resolve(tmpdir(), `tester-teardown-${process.pid}`);

function makeDeps(overrides?: Partial<TeardownDeps>): TeardownDeps {
  return {
    kill: vi.fn(),
    listPidsOnPort: vi.fn(async () => []),
    listPidsByCmdline: vi.fn(async () => []),
    delay: vi.fn(async () => {}),
    ...overrides,
  };
}

function writeInfo(content: unknown): void {
  writeFileSync(join(tmpBase, APP_PROCESS_INFO_FILENAME), JSON.stringify(content));
}

describe("readAppProcessInfo", () => {
  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("returns null when the file is absent", () => {
    assert.equal(readAppProcessInfo(tmpBase), null);
  });

  it("parses pid and port", () => {
    writeInfo({ pid: 1234, port: 3000 });
    assert.deepEqual(readAppProcessInfo(tmpBase), { pid: 1234, port: 3000 });
  });

  it("degrades gracefully on malformed content", () => {
    writeFileSync(join(tmpBase, APP_PROCESS_INFO_FILENAME), "not json");
    assert.equal(readAppProcessInfo(tmpBase), null);
  });

  it("degrades gracefully on wrong shapes", () => {
    writeInfo({ pid: "abc" });
    assert.equal(readAppProcessInfo(tmpBase), null);
  });
});

describe("teardownAppProcess", () => {
  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("does nothing when no process info exists", async () => {
    const deps = makeDeps();
    await teardownAppProcess(tmpBase, deps);
    assert.equal(vi.mocked(deps.kill).mock.calls.length, 0);
  });

  it("SIGTERMs the tracked pid and skips SIGKILL once it dies", async () => {
    writeInfo({ pid: 4242 });
    // alive on the liveness probe before SIGTERM, dead on the post-delay probe
    let probes = 0;
    const kill = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0 && ++probes > 1) throw new Error("ESRCH");
    });
    const deps = makeDeps({ kill });
    await teardownAppProcess(tmpBase, deps);
    const signals = kill.mock.calls.map(([, signal]) => signal);
    assert.ok(signals.includes("SIGTERM"));
    assert.ok(!signals.includes("SIGKILL"));
  });

  it("escalates to SIGKILL when the process survives SIGTERM", async () => {
    writeInfo({ pid: 4242 });
    const kill = vi.fn();
    const deps = makeDeps({ kill });
    await teardownAppProcess(tmpBase, deps);
    const signals = kill.mock.calls.map(([, signal]) => signal);
    assert.ok(signals.includes("SIGTERM"));
    assert.ok(signals.includes("SIGKILL"));
  });

  it("kills processes found via the port fallback", async () => {
    writeInfo({ port: 3123 });
    const kill = vi.fn();
    const listPidsOnPort = vi.fn(async () => [111, 222]);
    const deps = makeDeps({ kill, listPidsOnPort });
    await teardownAppProcess(tmpBase, deps);
    assert.deepEqual(listPidsOnPort.mock.calls[0], [3123]);
    const killedPids = new Set(kill.mock.calls.map(([pid]) => pid));
    assert.ok(killedPids.has(111));
    assert.ok(killedPids.has(222));
  });

  it("kills both the tracked pid and any process on the tracked port", async () => {
    writeInfo({ pid: 4242, port: 3123 });
    const kill = vi.fn();
    const listPidsOnPort = vi.fn(async () => [5555]);
    const deps = makeDeps({ kill, listPidsOnPort });
    await teardownAppProcess(tmpBase, deps);
    assert.deepEqual(listPidsOnPort.mock.calls[0], [3123]);
    const killedPids = new Set(kill.mock.calls.map(([pid]) => pid));
    assert.ok(killedPids.has(4242));
    assert.ok(killedPids.has(5555));
  });

  it("sweeps supervisor processes matching the worktree cmdline, even without an info file", async () => {
    // No info file written — the crashed-run state.
    const kill = vi.fn();
    const listPidsByCmdline = vi.fn(async () => [7001, 7002]);
    const deps = makeDeps({ kill, listPidsByCmdline });
    await teardownAppProcess(tmpBase, deps);
    assert.deepEqual(listPidsByCmdline.mock.calls[0], [tmpBase]);
    const killedPids = new Set(kill.mock.calls.map(([pid]) => pid));
    assert.ok(killedPids.has(7001));
    assert.ok(killedPids.has(7002));
  });

  it("kills the surviving process group when the tracked wrapper pid is already dead", async () => {
    writeInfo({ pid: 4242 });
    // The wrapper (4242) is gone, but the server it spawned kept the group alive.
    const kill = vi.fn((target: number, _signal: NodeJS.Signals | 0) => {
      if (target === 4242) throw new Error("ESRCH");
    });
    const deps = makeDeps({ kill });
    await teardownAppProcess(tmpBase, deps);
    const groupSignals = kill.mock.calls
      .filter(([target]) => target === -4242)
      .map(([, signal]) => signal);
    assert.ok(groupSignals.includes("SIGTERM"));
    assert.ok(groupSignals.includes("SIGKILL"));
    assert.ok(!kill.mock.calls.some(([target, signal]) => target === 4242 && signal !== 0));
  });

  it("never throws when kill fails, and removes the info file", async () => {
    writeInfo({ pid: 4242 });
    const kill = vi.fn(() => {
      throw new Error("EPERM");
    });
    const deps = makeDeps({ kill });
    await teardownAppProcess(tmpBase, deps);
    assert.equal(existsSync(join(tmpBase, APP_PROCESS_INFO_FILENAME)), false);
  });
});
