import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  runVerificationChecks,
  type RunVerificationChecksDeps,
  type SpawnFn,
  type SpawnedChild,
} from "./runner.js";

class FakeChild extends EventEmitter implements SpawnedChild {
  stdout: EventEmitter | null = new EventEmitter();
  stderr: EventEmitter | null = new EventEmitter();
  killed = false;
  killSignal: NodeJS.Signals | undefined;

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
}

function makeDeps(scenarios: Scenario[]): {
  deps: RunVerificationChecksDeps;
  logs: string[];
  spawned: { command: string; cwd: string }[];
  children: FakeChild[];
} {
  const logs: string[] = [];
  const spawned: { command: string; cwd: string }[] = [];
  const children: FakeChild[] = [];
  let time = 1000;

  const spawnFn: SpawnFn = (command, options) => {
    spawned.push({ command, cwd: options.cwd });
    const idx = spawned.length - 1;
    const scenario = scenarios[idx] ?? { exitCode: 0 };
    const fake = new FakeChild();
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
    appendExecutionLog: (_branch, message) => logs.push(message),
    now: () => {
      time += 100;
      return time;
    },
  };

  return { deps, logs, spawned, children };
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

  it("kills the child on timeout and reports timedOut:true", async () => {
    const { deps, children } = makeDeps([{ delay: true }]);
    const promise = runVerificationChecks(
      {
        worktreePath: "/wt",
        branchName: "b",
        checks: [{ name: "slow", command: "sleep 100", timeoutSeconds: 0.01 }],
      },
      deps,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    children[0]!.emit("close", null);
    const result = await promise;
    assert.equal(result.result, "fail");
    assert.equal(children[0]!.killed, true);
    assert.equal(children[0]!.killSignal, "SIGTERM");
    if (result.result === "fail") {
      assert.equal(result.failure.timedOut, true);
    }
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
