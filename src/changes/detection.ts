import { getConfig, type Config, type RepositoryConfig } from "../config.js";
import type { TriggerType, FollowUpInfo, FollowUpCommand } from "./types.js";
import { runClaude } from "./execution.js";

// ============================================================================
// Change Request Detection
// ============================================================================

/**
 * Check if changes workflow is enabled for a specific trigger type
 */
export function isChangesEnabledForTrigger(
  triggerType: TriggerType,
  config: Config
): boolean {
  // Global changesWorkflow must be enabled
  if (!config.changesWorkflow?.enabled) {
    return false;
  }

  // Check trigger-specific config
  const triggerConfig = config[triggerType];
  return triggerConfig?.changesWorkflow?.enabled === true;
}

/**
 * Get repositories that support changes
 */
export function getChangeEnabledRepos(
  config: Config
): Array<{ name: string; description: string }> {
  return config.repositories
    .filter((r) => r.supportsChanges === true)
    .map((r) => ({ name: r.name, description: r.description }));
}

/**
 * Find the repository that supports changes.
 * If multiple repos support changes, returns null (Claude will need to determine).
 */
export function findChangeEnabledRepo(config: Config): RepositoryConfig | null {
  const enabledRepos = config.repositories.filter((r) => r.supportsChanges === true);

  if (enabledRepos.length === 1) {
    return enabledRepos[0];
  }

  return null; // Multiple or none - need Claude to determine or error
}

/**
 * Find a repository by name
 */
export function findRepoByName(
  name: string,
  config: Config
): RepositoryConfig | undefined {
  return config.repositories.find(
    (r) => r.name.toLowerCase() === name.toLowerCase()
  );
}

// ============================================================================
// Follow-up Command Detection
// ============================================================================

/**
 * System prompt for Claude to detect follow-up commands in change threads
 */
const FOLLOW_UP_DETECTION_PROMPT = `You are analyzing a message in an active code change thread where a PR has been created.

The user's message may be:
1. A **command** to act on the PR (merge, review feedback, close, or request additional changes)
2. A **question** about the code or changes (not an action request)

## Determine the Intent

**MERGE** - User wants to merge the PR:
- "merge", "merge it", "ship it", "lgtm", "looks good", "approve and merge"

**REVIEW** - User wants you to address PR feedback/comments:
- "review", "check comments", "address feedback", "fix the review comments"

**CLOSE** - User wants to close/abandon the PR without merging:
- "close", "abandon", "cancel", "never mind", "close the PR"
- Note: if user says "close and delete branch", include that in additionalInstructions

**UPDATE** - User is requesting additional code changes:
- Describes new changes, fixes, or modifications to make
- "also fix the tests", "add error handling too", "can you also update the docs"

**QUESTION** - User is asking about the code or changes (not requesting action):
- "how does this work?", "why did you change this?", "what does this do?"

## Output Format

If this is a COMMAND (merge, review, close, or update), output:
<follow-up-command>
  <command>{merge|review|close|update}</command>
  <instructions>{any additional context or instructions, empty if none}</instructions>
</follow-up-command>

If this is a QUESTION, output:
<question>true</question>

When uncertain, default to treating it as a question.`;

/**
 * Detect follow-up command using Claude semantic understanding
 */
export async function detectFollowUpCommand(
  message: string,
  worktreePath: string
): Promise<{ isCommand: boolean; info?: FollowUpInfo }> {
  const result = await runClaude({
    prompt: `Analyze this message in a change thread and determine the user's intent:\n\n"${message}"`,
    cwd: worktreePath,
    systemPrompt: FOLLOW_UP_DETECTION_PROMPT,
    allowedTools: [], // No tools needed for intent detection
    disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
    timeout: 1, // 1 minute for quick detection
  });

  if (!result.success) {
    // On error, treat as question (safer)
    return { isCommand: false };
  }

  // Check for follow-up command
  const commandMatch = result.text.match(/<follow-up-command>([\s\S]*?)<\/follow-up-command>/);
  if (commandMatch) {
    const content = commandMatch[1];
    const cmdMatch = content.match(/<command>([\s\S]*?)<\/command>/);
    const instrMatch = content.match(/<instructions>([\s\S]*?)<\/instructions>/);

    const command = cmdMatch?.[1]?.trim()?.toLowerCase();
    if (command && ["merge", "review", "close", "update"].includes(command)) {
      const instructions = instrMatch?.[1]?.trim();
      return {
        isCommand: true,
        info: {
          command: command as FollowUpCommand,
          additionalInstructions: instructions || message,
        },
      };
    }
  }

  // Check for explicit question tag
  const questionMatch = result.text.match(/<question>true<\/question>/);
  if (questionMatch) {
    return { isCommand: false };
  }

  // Default to question if uncertain
  return { isCommand: false };
}
