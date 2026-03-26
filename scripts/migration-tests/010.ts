import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 010: rename send_to_thread → post_to in instruction overrides
 */

const INSTRUCTIONS_WITH_OLD_NAME = `You are a helpful assistant.

## Submitting Your Response
When you have your final answer ready, call the \`submit_response\` tool.

**Response framing:** The \`message\` is not included when sharing via \`send_to_thread\`. Put all shareable content in \`sections\`.

**\`send_to_thread\` content rule:** Each \`send_to_thread\` action requires a \`content\` field — the exact text that button will post to the thread. When there's a single "Send to thread" button, put the full shareable answer in \`content\`.
`;

const SUBMIT_RESPONSE_WITH_OLD_NAME = `## Actions by Delivery Context

**DM** (reaction triggered, answer delivered via DM):
- Include \`send_to_thread\` (lets the user share to the original channel thread)
`;

const ALREADY_MIGRATED_INSTRUCTIONS = `You are a helpful assistant.

## Submitting Your Response
When you have your final answer ready, call the \`submit_response\` tool.

**Response framing:** The \`message\` is not included when sharing via \`post_to\`. Put all shareable content in \`sections\`.

**\`post_to\` content rule:** Each \`post_to\` action requires a \`content\` field — the exact text to post. When there's a single \`post_to\` action, put the full shareable answer in \`content\`.
`;

export const test: MigrationTest = {
  version: 10,
  fileCases: [
    {
      name: "Renames send_to_thread to post_to in instructions.md",
      inputFiles: {
        "data/configuration/instructions.md": INSTRUCTIONS_WITH_OLD_NAME,
      },
      validateFiles: (output) => {
        const instructions = output["data/configuration/instructions.md"];
        if (!instructions) return "instructions.md missing from output";

        if (instructions.includes("send_to_thread"))
          return "Old 'send_to_thread' references still present";
        if (instructions.includes("Send to thread"))
          return "Old 'Send to thread' label still present";
        if (!instructions.includes("post_to"))
          return "Missing 'post_to' references";

        return null;
      },
    },
    {
      name: "Renames send_to_thread to post_to in submit-response.md",
      inputFiles: {
        "data/configuration/user/submit-response.md": SUBMIT_RESPONSE_WITH_OLD_NAME,
      },
      validateFiles: (output) => {
        const submitResponse = output["data/configuration/user/submit-response.md"];
        if (!submitResponse) return "submit-response.md missing from output";

        if (submitResponse.includes("send_to_thread"))
          return "Old 'send_to_thread' references still present";
        if (!submitResponse.includes("post_to"))
          return "Missing 'post_to' references";

        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      inputFiles: {
        "data/configuration/instructions.md": ALREADY_MIGRATED_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const instructions = output["data/configuration/instructions.md"];
        if (!instructions) return "instructions.md missing from output";

        if (instructions.includes("send_to_thread"))
          return "send_to_thread appeared after no-op migration";
        if (!instructions.includes("post_to"))
          return "post_to was removed";

        return null;
      },
    },
    {
      name: "No override files — skip gracefully",
      inputFiles: {},
      validateFiles: (_output) => {
        // Migration should complete without error when files don't exist
        return null;
      },
    },
  ],
};
