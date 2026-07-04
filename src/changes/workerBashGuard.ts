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

const DOCKER_CONTROL_PLANE_PATTERNS = [
  /clack-docker-proxy/i,
  /:2375\b/,
  /\/var\/run\/docker\.sock/,
];

/**
 * Whether a shell command references the tester-services docker control plane (the
 * socket proxy's container name, the docker API port, or the raw socket). The proxy
 * filters endpoints, not payloads, so an agent reaching it directly could create
 * containers the core-code guards (image allowlist, name prefix) never see. Like the
 * git-push guard this blocks casual/accidental access, not deliberate obfuscation —
 * the residual risk is documented in docs/tester-services.md.
 */
export function isDockerControlPlaneCommand(command: string): boolean {
  return DOCKER_CONTROL_PLANE_PATTERNS.some((pattern) => pattern.test(command));
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
        const command = extractCommand(input.tool_input);
        if (isGitPushCommand(command)) {
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason:
                "Raw `git push` is disabled in worker mode. Use the git_push tool — it enforces the protected-branch refusal and force-with-lease rules. Pass force=true to git_push for a post-rebase force push.",
            },
          };
        }
        if (isDockerControlPlaneCommand(command)) {
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason:
                "Direct access to the docker control plane (socket proxy, docker API port, or docker socket) is not allowed. Tester services are provisioned for you before the run — see the TEST SERVICES section; you never need to talk to docker.",
            },
          };
        }
        return { continue: true };
      },
    ],
  };
}
