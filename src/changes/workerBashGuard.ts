import type {
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

const GIT_GLOBAL_FLAGS_WITH_ARG = new Set(["-C", "-c"]);

/**
 * Whether a shell command invokes `git push` as a git subcommand. Splits on
 * shell separators and, in each segment, finds `git` and its first non-flag
 * token — blocking only when that subcommand is `push`. Matches things like
 * `git push`, `git push --force-with-lease`, `git -C path push`, and
 * `cd x && git push`, while leaving `git fetch`/`pull`/`rebase`/`status` alone.
 *
 * This is a guardrail against accidental direct pushes (e.g. a raw force-push
 * fallback after a rebase), not a defense against deliberate obfuscation —
 * GitHub branch protection is the backstop for anything this misses.
 */
export function isGitPushCommand(command: string): boolean {
  const segments = command.split(/&&|\|\||[;|\n]/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const gitIdx = tokens.indexOf("git");
    if (gitIdx === -1) continue;

    let i = gitIdx + 1;
    while (i < tokens.length && tokens[i].startsWith("-")) {
      i += GIT_GLOBAL_FLAGS_WITH_ARG.has(tokens[i]) ? 2 : 1;
    }
    if (tokens[i] === "push") return true;
  }
  return false;
}

function extractCommand(toolInput: unknown): string {
  if (toolInput && typeof toolInput === "object" && "command" in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    return typeof command === "string" ? command : "";
  }
  return "";
}

/**
 * PreToolUse hook matcher that denies any `Bash` command invoking `git push`,
 * steering the worker to the `git_push` tool (which enforces protected-branch
 * and force-with-lease rules). Registered on every worker SDK invocation.
 */
export function buildWorkerBashGuardHook(): HookCallbackMatcher {
  return {
    matcher: "Bash",
    hooks: [
      async (input: HookInput): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== "PreToolUse") return { continue: true };
        if (input.tool_name !== "Bash") return { continue: true };
        if (!isGitPushCommand(extractCommand(input.tool_input))) return { continue: true };
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "Raw `git push` is disabled in worker mode. Use the git_push tool — it enforces the protected-branch refusal and force-with-lease rules. Pass force=true to git_push for a post-rebase force push.",
          },
        };
      },
    ],
  };
}
