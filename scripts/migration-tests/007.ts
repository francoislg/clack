import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 007: send_to_thread snapshot rule → content rule
 */

const OLD_INSTRUCTIONS = `You are a **product expert**, not a developer.

## Submitting Your Response
When you have your final answer ready, call the \`submit_response\` tool with:
- **sections**: Your answer content
- **actions**: Buttons for the user to interact with. Which actions to include depends on the delivery context (see below).

**Response length limit:** Your total response text (message + all sections combined) must stay under 10,000 characters.

**Response framing:** Use the \`message\` field for conversational preamble (e.g., "Here's the updated version:", "Good question!"). Only \`sections\` content is shared when the user clicks "Send to thread" — \`message\` is not included. Put all shareable content in \`sections\`.

**\`send_to_thread\` snapshot rule:** Every \`submit_response\` result includes a \`snapshotId\`. When the user asks you to post a *previously composed* message to a thread, pass that earlier response's \`snapshotId\` in the \`snapshot\` field of the \`send_to_thread\` action. Without \`snapshot\`, the button posts the *current* response's content.
`;

const ALREADY_MIGRATED = `You are a **product expert**, not a developer.

## Submitting Your Response
When you have your final answer ready, call the \`submit_response\` tool with:
- **sections**: Your answer content
- **actions**: Buttons for the user to interact with. Which actions to include depends on the delivery context (see below).

**Response length limit:** Your total response text (message + all sections combined) must stay under 10,000 characters.

**Response framing:** Use the \`message\` field for conversational preamble (e.g., "Here's the updated version:", "Good question!"). The \`message\` is not included when sharing via \`send_to_thread\`. Put all shareable content in \`sections\`.

**\`send_to_thread\` content rule:** Each \`send_to_thread\` action requires a \`content\` field — the exact text that button will post to the thread. When presenting multiple options (e.g., "Send option 1", "Send option 2"), each button's \`content\` should contain only that option's text, not the full response. When there's a single "Send to thread" button, put the full shareable answer in \`content\`.
`;

export const test: MigrationTest = {
  version: 7,
  fileCases: [
    {
      name: "Replaces snapshot rule with content rule and updates response framing",
      inputFiles: {
        "data/configuration/instructions.md": OLD_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const instructions = output["data/configuration/instructions.md"];
        if (!instructions) return "instructions.md missing from output";

        // Should have content rule
        if (!instructions.includes("content rule")) return "Missing 'content rule' section";
        if (!instructions.includes("requires a `content` field"))
          return "Missing content field requirement";
        if (
          !instructions.includes("each button's `content` should contain only that option's text")
        )
          return "Missing per-button content guidance";

        // Old snapshot rule should be gone
        if (instructions.includes("snapshot rule")) return "Old 'snapshot rule' still present";
        if (instructions.includes("snapshotId")) return "Old 'snapshotId' reference still present";

        // Response framing should be updated
        if (instructions.includes("Only `sections` content is shared when the user clicks"))
          return "Old response framing text still present";
        if (!instructions.includes("not included when sharing via `send_to_thread`"))
          return "Missing updated response framing text";

        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      inputFiles: {
        "data/configuration/instructions.md": ALREADY_MIGRATED,
      },
      validateFiles: (output) => {
        const instructions = output["data/configuration/instructions.md"];
        if (!instructions) return "instructions.md missing from output";

        // Should still have content rule
        if (!instructions.includes("content rule")) return "content rule was removed";
        if (!instructions.includes("not included when sharing via `send_to_thread`"))
          return "Updated response framing was removed";

        // Should not have snapshot rule
        if (instructions.includes("snapshot rule"))
          return "snapshot rule appeared after no-op migration";

        return null;
      },
    },
  ],
};
