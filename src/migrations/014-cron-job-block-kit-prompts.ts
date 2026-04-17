import type { Migration } from "./types.js";

export const migration: Migration = {
  version: 14,
  name: "Rewrite cron-job prompts that reference old response-format vocabulary",
  priority: "enhancement",
  prompt: `The response format for Clack's \`submit_response\` tool changed: the payload used to carry \`sections: [{title?, body}]\` and \`post_to.content: string\`. It now carries a Slack Block Kit \`blocks\` array (curated subset: \`divider\`, \`header\`, \`section\`, \`context\`, \`image\`) and \`post_to.blocks: Block[]\`.

Review \`data/state/cron-jobs.json\` and rewrite ONLY the format-specific parts of each job's \`prompt\` field. Each job is an object in the \`jobs\` array and has fields including \`id\`, \`prompt\`, \`channel\`, \`cron\`, etc. — only the \`prompt\` string may be edited; every other field (including object key order) must remain byte-identical.

For each job:
1. Read the \`prompt\` text. If it contains NO format/layout/structure/markdown guidance (e.g. a pure tool-invocation prompt like "Call send_questions_instructions and follow the returned instructions exactly."), leave the \`prompt\` byte-identical.
2. If the \`prompt\` mentions \`sections\`, "section with title and body", "bold title", "bulleted list", "markdown headers (##)", \`post_to\` with \`content:\`, or any similar format-specific vocabulary, rewrite JUST that format guidance to the new vocabulary: use the \`blocks\` array with one \`section\` block (mrkdwn text) by default, and add \`header\`/\`divider\`/\`context\`/\`image\` blocks only when the content genuinely has structure. \`post_to\` actions carry \`blocks: Block[]\`, not \`content: string\`.
3. Preserve all other language in the prompt — scheduling intent, tool names, persona, step order, etc.
4. If you are uncertain whether a piece of text is format guidance or semantic content, leave it unchanged — false negatives are preferable to rewriting intent.

If the \`prompt\` already references \`blocks\` / Block Kit types correctly, leave it byte-identical.

Write \`data/state/cron-jobs.json\` back with 2-space indentation and a trailing newline. If no jobs need changes, skip the write entirely (do not rewrite the file) so re-running the migration is a no-op.

If \`data/state/cron-jobs.json\` does not exist, skip this migration silently.`,
  files: ["data/state/cron-jobs.json"],
};
