# Tasks: casual-talk-follow-channel-window

## 1. Engagement instructions

- [x] 1.1 In `src/plugins/casual-talk/engagement.ts`, extend the posting section so every top-level `deliver_to` entry (no `thread_ts`) also carries `channel_attention_level: "low"`, alongside the existing `attention_level`. State explicitly that a threaded entry (`thread_ts` present) must NOT set it (core ignores + warns).
- [x] 1.2 Update the `deliver_to` shape example so the top-level case shows `channel_attention_level`, and note the window follows the channel's top-level conversation about the post (ephemeral, decays on unrelated traffic).

## 2. Tests

- [x] 2.1 `engagement.test.ts`: assert the content mandates `channel_attention_level: "low"` on top-level posts and forbids it on threaded entries.
- [x] 2.2 `plugin.test.ts`: no change needed — its assertion checks only the `attention_level` mandate line, still present.

## 3. Verify

- [x] 3.1 `npx tsc --noEmit` (0 errors); `npx oxlint src/plugins/casual-talk` (clean); `npx vitest run src/plugins/casual-talk` (92 passed).
- [x] 3.2 `openspec validate casual-talk-follow-channel-window --strict` (valid).
