import type { MigrationTest } from "./types.js";

/**
 * Tests for migration 014: rewrite cron-job prompts that reference the
 * legacy response-format vocabulary (sections/title/body/post_to.content)
 * to the new Block Kit `blocks` vocabulary.
 *
 * Because migration 014 is Claude-powered (runs the engine's LLM prompt
 * against data/state/cron-jobs.json), these cases exercise the shape of
 * the file and the idempotency guarantee — the LLM output is not asserted
 * character-for-character, only structural properties.
 */

const FORMAT_AGNOSTIC_PROMPT =
  "Call send_questions_instructions and follow the returned instructions exactly.";

const FORMAT_SPECIFIC_PROMPT =
  "Ask the team what they worked on yesterday. Respond with a section that has a bold title and a bulleted list of items underneath.";

const ALREADY_MIGRATED_PROMPT =
  "Ask the team what they worked on yesterday. Respond with a single section block whose mrkdwn text summarises the answers.";

export const test: MigrationTest = {
  version: 14,
  fileCases: [
    {
      name: "format-agnostic prompt is left byte-identical",
      inputFiles: {
        "data/state/cron-jobs.json": JSON.stringify(
          {
            jobs: [
              {
                id: "job-agnostic",
                cron: "0 9 * * 1-5",
                channel: "C001",
                prompt: FORMAT_AGNOSTIC_PROMPT,
              },
            ],
          },
          null,
          2,
        ),
      },
      validateFiles: (output) => {
        const raw = output["data/state/cron-jobs.json"];
        if (!raw) return "cron-jobs.json missing from output";
        const data = JSON.parse(raw) as { jobs: { prompt: string }[] };
        if (data.jobs[0]?.prompt !== FORMAT_AGNOSTIC_PROMPT) {
          return `format-agnostic prompt was modified. Got: ${data.jobs[0]?.prompt}`;
        }
        return null;
      },
    },
    {
      name: "format-specific prompt is rewritten to reference the blocks vocabulary",
      inputFiles: {
        "data/state/cron-jobs.json": JSON.stringify(
          {
            jobs: [
              {
                id: "job-formatted",
                cron: "0 9 * * 1-5",
                channel: "C001",
                prompt: FORMAT_SPECIFIC_PROMPT,
              },
            ],
          },
          null,
          2,
        ),
      },
      validateFiles: (output) => {
        const raw = output["data/state/cron-jobs.json"];
        if (!raw) return "cron-jobs.json missing from output";
        const data = JSON.parse(raw) as {
          jobs: { id: string; prompt: string }[];
        };
        const job = data.jobs[0];
        if (!job) return "job entry missing from output";
        // Non-format fields preserved
        if (job.id !== "job-formatted") return `job id changed: ${job.id}`;
        // Prompt should reference the new blocks vocabulary or at least no longer
        // talk about "section with a bold title" as a cooked-in directive.
        const mentionsBlocks = /\bblocks?\b|section block|mrkdwn|block kit/i.test(job.prompt);
        const stillHasLegacyDirective =
          /bold title.*bulleted list|sections? with.*title.*body/i.test(job.prompt);
        if (!mentionsBlocks && stillHasLegacyDirective) {
          return `prompt still references legacy format without mentioning blocks vocabulary. Got: ${job.prompt}`;
        }
        return null;
      },
    },
    {
      name: "prompt already referencing blocks vocabulary is left byte-identical",
      inputFiles: {
        "data/state/cron-jobs.json": JSON.stringify(
          {
            jobs: [
              {
                id: "job-already-migrated",
                cron: "0 9 * * 1-5",
                channel: "C001",
                prompt: ALREADY_MIGRATED_PROMPT,
              },
            ],
          },
          null,
          2,
        ),
      },
      validateFiles: (output) => {
        const raw = output["data/state/cron-jobs.json"];
        if (!raw) return "cron-jobs.json missing from output";
        const data = JSON.parse(raw) as { jobs: { prompt: string }[] };
        if (data.jobs[0]?.prompt !== ALREADY_MIGRATED_PROMPT) {
          return `already-migrated prompt was modified. Got: ${data.jobs[0]?.prompt}`;
        }
        return null;
      },
    },
    {
      name: "file does not exist — skip gracefully",
      inputFiles: {},
      validateFiles: (_output) => {
        // Nothing to assert — migration should not create the file if absent.
        return null;
      },
    },
  ],
};
