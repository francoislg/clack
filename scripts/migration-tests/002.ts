import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 002: instruction updates (delivery context + workMode)
 */

const OLD_INSTRUCTIONS = `You are a **product expert**, not a developer.

You also have access to MCP integrations — use them to read and write data when relevant to the question.

While you cannot modify code directly, you CAN and SHOULD use MCP tools to take actions.

## Submitting Your Response
When you have your final answer ready, call the \`submit_response\` tool with:
- **sections**: Your answer content (one or more sections, each with an optional title and body)
- **actions**: Buttons for the user to interact with.

Common action patterns:
- Q&A answer: \`accept\`, \`edit\`, \`refine\`, \`reject\`
- Answer needing clarification: \`choice\` actions with options, plus \`refine\` and \`reject\`
- Casual conversation (greetings, compliments, jokes, chitchat): empty actions \`[]\` — no buttons needed
`;

const OLD_DEV_INSTRUCTIONS = `## Code Changes

When uncertain whether the user is asking a question or requesting a change, default to answering the question. However, when your answer identifies a bug or issue, offer a \`choice\` action (e.g. "Fix this bug") so the user can quickly request a fix.

### Auto-execute (\`auto: true\`)
`;

export const test: MigrationTest = {
  version: 2,
  fileCases: [
    {
      name: "Both files need updating",
      inputFiles: {
        "data/configuration/instructions.md": OLD_INSTRUCTIONS,
        "data/configuration/dev_instructions.md": OLD_DEV_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const instructions = output["data/configuration/instructions.md"];
        if (!instructions) return "instructions.md missing from output";

        // Should have delivery context section
        if (!instructions.includes("Actions by Delivery Context"))
          return "Missing 'Actions by Delivery Context' section";
        if (!instructions.includes("Ephemeral"))
          return "Missing 'Ephemeral' guidance";
        if (!instructions.includes("DM-first"))
          return "Missing 'DM-first' guidance";
        if (!instructions.includes("send_to_thread"))
          return "Missing 'send_to_thread' reference";
        if (!instructions.includes("Direct message"))
          return "Missing 'Direct message' guidance";
        if (!instructions.includes("Channel mention"))
          return "Missing 'Channel mention' guidance";

        // Old patterns should be replaced
        if (instructions.includes("Common action patterns"))
          return "Old 'Common action patterns' still present";

        // Actions line should be updated
        if (!instructions.includes("depends on the delivery context"))
          return "Missing updated actions description line";

        // Should have URL-to-MCP section
        if (!instructions.includes("URLs and MCP Tools"))
          return "Missing 'URLs and MCP Tools' section";
        if (!instructions.includes("Match the URL's domain"))
          return "Missing URL domain matching guidance";

        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        // Should have workMode: true
        if (!dev.includes("workMode: true"))
          return "Missing 'workMode: true' in dev_instructions";

        // Old text should be gone
        if (dev.includes('") so the user can quickly'))
          return "Old choice action text without workMode still present";

        return null;
      },
    },
    {
      name: "Only instructions.md exists (no dev_instructions.md)",
      inputFiles: {
        "data/configuration/instructions.md": OLD_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const instructions = output["data/configuration/instructions.md"];
        if (!instructions) return "instructions.md missing from output";

        if (!instructions.includes("Actions by Delivery Context"))
          return "Missing 'Actions by Delivery Context' section";

        if (!instructions.includes("URLs and MCP Tools"))
          return "Missing 'URLs and MCP Tools' section";

        return null;
      },
    },
    {
      name: "Only dev_instructions.md exists (no instructions.md)",
      inputFiles: {
        "data/configuration/dev_instructions.md": OLD_DEV_INSTRUCTIONS,
      },
      validateFiles: (output) => {
        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("workMode: true"))
          return "Missing 'workMode: true' in dev_instructions";

        return null;
      },
    },
    {
      name: "Already migrated — no-op",
      inputFiles: {
        "data/configuration/instructions.md": `You are a **product expert**.

## URLs and MCP Tools
When messages contain URLs, check whether one of your available MCP integrations can fetch data for that service. Match the URL's domain to your MCP tools. Decompose the URL into the identifiers needed by the appropriate tool and call that tool directly. Never try to open or fetch URLs directly — always go through the matching MCP tool.

## Submitting Your Response
When you have your final answer ready, call the \`submit_response\` tool with:
- **sections**: Your answer content
- **actions**: Buttons for the user to interact with. Which actions to include depends on the delivery context (see below).

### Actions by Delivery Context
Your prompt includes a \`DELIVERY CONTEXT\` block. Use it to decide which actions to include.

**Ephemeral** (reaction triggered):
- You MUST include \`accept\`, \`reject\`, and \`refine\`
`,
        "data/configuration/dev_instructions.md": `## Code Changes

When uncertain, offer a \`choice\` action (e.g. "Fix this bug") with \`workMode: true\` so the user can quickly request a fix.
`,
      },
      validateFiles: (output) => {
        const instructions = output["data/configuration/instructions.md"];
        if (!instructions) return "instructions.md missing from output";

        // Should still have delivery context (not removed or duplicated badly)
        if (!instructions.includes("Actions by Delivery Context"))
          return "Delivery context section was removed";

        if (!instructions.includes("URLs and MCP Tools"))
          return "URLs and MCP Tools section was removed";

        const dev = output["data/configuration/dev_instructions.md"];
        if (!dev) return "dev_instructions.md missing from output";

        if (!dev.includes("workMode: true"))
          return "workMode: true was removed";

        return null;
      },
    },
  ],
};
