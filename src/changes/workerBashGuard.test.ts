import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { HookInput, HookJSONOutput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { isGitPushCommand, buildWorkerBashGuardHook } from "./workerBashGuard.js";

function syncOut(out: HookJSONOutput): SyncHookJSONOutput {
  if ("async" in out) throw new Error("expected a synchronous hook output");
  return out;
}

describe("isGitPushCommand", () => {
  it("matches git push invocations", () => {
    for (const cmd of [
      "git push",
      "git push -u origin clack/fix/x",
      "git push --force-with-lease origin HEAD",
      "git push origin HEAD:master",
      "git -C /repo push",
      "cd /repo && git push",
      "git   push",
    ]) {
      assert.equal(isGitPushCommand(cmd), true, cmd);
    }
  });

  it("does not match non-push git commands", () => {
    for (const cmd of [
      "git fetch origin main",
      "git pull --rebase",
      "git rebase origin/main",
      "git status",
      "git add -A && git commit -m x",
      "git log --oneline",
    ]) {
      assert.equal(isGitPushCommand(cmd), false, cmd);
    }
  });
});

describe("buildWorkerBashGuardHook", () => {
  const signal = new AbortController().signal;

  function bashInput(command: string): HookInput {
    return {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_use_id: "x",
      session_id: "s",
      transcript_path: "/tmp/t",
      cwd: "/repo",
    } satisfies HookInput;
  }

  it("denies a Bash git push", async () => {
    const hook = buildWorkerBashGuardHook();
    const out = syncOut(
      await hook.hooks[0]!(bashInput("git push --force origin main"), "id", { signal }),
    );
    const hso = out.hookSpecificOutput;
    if (hso?.hookEventName !== "PreToolUse") throw new Error("expected a PreToolUse output");
    assert.equal(hso.permissionDecision, "deny");
  });

  it("allows a non-push Bash command", async () => {
    const hook = buildWorkerBashGuardHook();
    const out = syncOut(await hook.hooks[0]!(bashInput("git fetch origin main"), "id", { signal }));
    assert.equal(out.continue, true);
  });

  it("passes through non-PreToolUse hook events", async () => {
    const hook = buildWorkerBashGuardHook();
    const input = {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push" },
      tool_use_id: "x",
      tool_response: {},
      session_id: "s",
      transcript_path: "/tmp/t",
      cwd: "/repo",
    } satisfies HookInput;
    const out = syncOut(await hook.hooks[0]!(input, "id", { signal }));
    assert.equal(out.continue, true);
  });

  it("ignores non-Bash tools", async () => {
    const hook = buildWorkerBashGuardHook();
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { command: "git push" },
      tool_use_id: "x",
      session_id: "s",
      transcript_path: "/tmp/t",
      cwd: "/repo",
    } satisfies HookInput;
    const out = syncOut(await hook.hooks[0]!(input, "id", { signal }));
    assert.equal(out.continue, true);
  });
});
