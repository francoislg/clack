import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  runVerificationChecks,
  type RunVerificationChecksDeps,
  type SpawnFn,
  type SpawnedChild,
} from "./runner.js";

let nextPid = 1000;

class FakeChild extends EventEmitter implements SpawnedChild {
  stdout: EventEmitter | null = new EventEmitter();
  stderr: EventEmitter | null = new EventEmitter();
  pid: number | undefined;
  killed = false;
  killSignal: NodeJS.Signals | undefined;

  constructor() {
    super();
    nextPid += 1;
    this.pid = nextPid;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.killSignal = signal;
    return true;
  }
}

interface Scenario {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delay?: boolean;
  noPid?: boolean;
}

interface SpawnedCall {
  command: string;
  cwd: string;
  shell: boolean;
  detached: boolean;
  stdio: ["ignore", "pipe", "pipe"];
}

interface GroupKill {
  pid: number;
  signal: NodeJS.Signals;
}

function makeDeps(
  scenarios: Scenario[],
  options: { killGraceMs?: number } = {},
): {
  deps: RunVerificationChecksDeps;
  logs: string[];
  spawned: SpawnedCall[];
  children: FakeChild[];
  groupKills: GroupKill[];
} {
  const logs: string[] = [];
  const spawned: SpawnedCall[] = [];
  const children: FakeChild[] = [];
  const groupKills: GroupKill[] = [];
  let time = 1000;

  const spawnFn: SpawnFn = (command, opts) => {
    spawned.push({
      command,
      cwd: opts.cwd,
      shell: opts.shell,
      detached: opts.detached,
      stdio: opts.stdio,
    });
    const idx = spawned.length - 1;
    const scenario = scenarios[idx] ?? { exitCode: 0 };
    const fake = new FakeChild();
    if (scenario.noPid) fake.pid = undefined;
    children.push(fake);

    queueMicrotask(() => {
      if (scenario.stdout) fake.stdout?.emit("data", Buffer.from(scenario.stdout));
      if (scenario.stderr) fake.stderr?.emit("data", Buffer.from(scenario.stderr));
      if (!scenario.delay) {
        fake.emit("close", scenario.exitCode ?? 0);
      }
    });

    return fake;
  };

  const deps: RunVerificationChecksDeps = {
    spawn: spawnFn,
    killGroup: (pid, signal) => {
      groupKills.push({ pid, signal });
      return true;
    },
    appendExecutionLog: (_branch, message) => logs.push(message),
    now: () => {
      time += 100;
      return time;
    },
    killGraceMs: options.killGraceMs,
  };

  return { deps, logs, spawned, children, groupKills };
}

describe("runVerificationChecks", () => {
  it("returns pass when all checks succeed, in declared order", async () => {
    const { deps, spawned } = makeDeps([{ exitCode: 0 }, { exitCode: 0 }]);
    const result = await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [
          { name: "a", command: "cmd-a", timeoutSeconds: 5 },
          { name: "b", command: "cmd-b", timeoutSeconds: 5 },
        ],
      },
      deps,
    );
    assert.equal(result.result, "pass");
    assert.equal(spawned.length, 2);
    assert.equal(spawned[0]!.command, "cmd-a");
    assert.equal(spawned[1]!.command, "cmd-b");
  });

  it("stops at the first failing check", async () => {
    const { deps, spawned } = makeDeps([{ exitCode: 1, stderr: "boom" }]);
    const result = await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [
          { name: "a", command: "cmd-a", timeoutSeconds: 5 },
          { name: "b", command: "cmd-b", timeoutSeconds: 5 },
        ],
      },
      deps,
    );
    assert.equal(result.result, "fail");
    assert.equal(spawned.length, 1);
    if (result.result === "fail") {
      assert.equal(result.failure.checkName, "a");
      assert.equal(result.failure.exitCode, 1);
      assert.ok(result.failure.output.includes("boom"));
    }
  });

  it("detects second check failing and skips subsequent", async () => {
    const { deps, spawned } = makeDeps([{ exitCode: 0 }, { exitCode: 2 }]);
    const result = await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [
          { name: "a", command: "cmd-a", timeoutSeconds: 5 },
          { name: "b", command: "cmd-b", timeoutSeconds: 5 },
          { name: "c", command: "cmd-c", timeoutSeconds: 5 },
        ],
      },
      deps,
    );
    assert.equal(result.result, "fail");
    assert.equal(spawned.length, 2);
    if (result.result === "fail") {
      assert.equal(result.failure.checkName, "b");
      assert.equal(result.failure.exitCode, 2);
    }
  });

  it("on timeout, sends SIGTERM to the process group via killGroup", async () => {
    const { deps, children, groupKills } = makeDeps([{ delay: true }], { killGraceMs: 10_000 });
    const promise = runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "slow", command: "sleep 100", timeoutSeconds: 0.01 }],
      },
      deps,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Process group received SIGTERM with the child's pid
    assert.equal(groupKills.length, 1);
    assert.equal(groupKills[0]!.pid, children[0]!.pid);
    assert.equal(groupKills[0]!.signal, "SIGTERM");
    // Direct child.kill is NOT used when pid is available
    assert.equal(children[0]!.killed, false);
    // Let the child close on its own so the promise resolves cleanly
    children[0]!.emit("close", null);
    const result = await promise;
    assert.equal(result.result, "fail");
    if (result.result === "fail") {
      assert.equal(result.failure.timedOut, true);
    }
  });

  it("escalates to SIGKILL after the grace window", async () => {
    const { deps, children, groupKills } = makeDeps([{ delay: true }], { killGraceMs: 20 });
    const promise = runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "slow", command: "sleep 100", timeoutSeconds: 0.01 }],
      },
      deps,
    );
    // Wait long enough for SIGTERM + grace + SIGKILL
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(groupKills.length, 2);
    assert.equal(groupKills[0]!.signal, "SIGTERM");
    assert.equal(groupKills[1]!.signal, "SIGKILL");
    children[0]!.emit("close", null);
    await promise;
  });

  it("hard-resolves when the child never closes after SIGKILL (leaked descendant scenario)", async () => {
    const { deps, groupKills } = makeDeps([{ delay: true }], { killGraceMs: 20 });
    const started = Date.now();
    const result = await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "wedged", command: "hang", timeoutSeconds: 0.01 }],
      },
      deps,
    );
    const elapsed = Date.now() - started;
    // We must have settled without the child ever emitting 'close':
    // timeout (10ms) + grace*2 (40ms) ≈ 50ms; allow generous slack for slow CI
    assert.ok(elapsed < 500, `expected hard-resolve under 500ms, got ${elapsed}ms`);
    assert.equal(result.result, "fail");
    if (result.result === "fail") {
      assert.equal(result.failure.timedOut, true);
    }
    // Both SIGTERM and SIGKILL should have been attempted
    assert.equal(groupKills.length, 2);
  });

  it("falls back to child.kill when pid is unavailable", async () => {
    const { deps, children, groupKills } = makeDeps([{ delay: true, noPid: true }], {
      killGraceMs: 10_000,
    });
    const promise = runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "slow", command: "sleep 100", timeoutSeconds: 0.01 }],
      },
      deps,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(groupKills.length, 0, "killGroup should not be called without a pid");
    assert.equal(children[0]!.killed, true);
    assert.equal(children[0]!.killSignal, "SIGTERM");
    children[0]!.emit("close", null);
    await promise;
  });

  it("spawns with detached and ignored stdin so descendants get a process group and /dev/null stdin", async () => {
    const { deps, spawned } = makeDeps([{ exitCode: 0 }]);
    await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "a", command: "cmd-a", timeoutSeconds: 5 }],
      },
      deps,
    );
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0]!.shell, true);
    assert.equal(spawned[0]!.detached, true);
    assert.deepEqual(spawned[0]!.stdio, ["ignore", "pipe", "pipe"]);
  });

  it("truncates output to the tail when over cap", async () => {
    const bigOutput = "X".repeat(200 * 1024);
    const { deps } = makeDeps([{ exitCode: 1, stdout: bigOutput }]);
    const result = await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "big", command: "cmd", timeoutSeconds: 5 }],
      },
      deps,
    );
    assert.equal(result.result, "fail");
    if (result.result === "fail") {
      assert.ok(result.failure.output.length <= 64 * 1024);
    }
  });

  it("reports spawn error as a failure", async () => {
    const deps: RunVerificationChecksDeps = {
      spawn: () => {
        throw new Error("ENOENT");
      },
      killGroup: () => true,
      appendExecutionLog: () => undefined,
      now: () => 0,
    };
    const result = await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "x", command: "nope", timeoutSeconds: 5 }],
      },
      deps,
    );
    assert.equal(result.result, "fail");
    if (result.result === "fail") {
      assert.ok(result.failure.output.includes("ENOENT"));
      assert.equal(result.failure.checkName, "x");
    }
  });

  it("reports async child 'error' events as a failure", async () => {
    const logs: string[] = [];
    const spawnFn: SpawnFn = () => {
      const fake = new FakeChild();
      queueMicrotask(() => fake.emit("error", new Error("pipe closed")));
      return fake;
    };
    const deps: RunVerificationChecksDeps = {
      spawn: spawnFn,
      killGroup: () => true,
      appendExecutionLog: (_branch, message) => logs.push(message),
      now: () => 0,
    };
    const result = await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "piped", command: "cmd", timeoutSeconds: 5 }],
      },
      deps,
    );
    assert.equal(result.result, "fail");
    if (result.result === "fail") {
      assert.equal(result.failure.checkName, "piped");
      assert.ok(result.failure.output.includes("pipe closed"));
      assert.equal(result.failure.exitCode, -1);
      assert.equal(result.failure.timedOut, false);
    }
  });

  it("logs start, pass, and fail events via appendExecutionLog", async () => {
    const { deps, logs } = makeDeps([{ exitCode: 0 }, { exitCode: 1 }]);
    await runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [
          { name: "a", command: "cmd-a", timeoutSeconds: 5 },
          { name: "b", command: "cmd-b", timeoutSeconds: 5 },
        ],
      },
      deps,
    );
    const joined = logs.join("\n");
    assert.ok(joined.includes("Verification: a — running"));
    assert.ok(joined.includes("Verification: a — passed"));
    assert.ok(joined.includes("Verification: b — running"));
    assert.ok(joined.includes("Verification: b — FAILED"));
  });
});
