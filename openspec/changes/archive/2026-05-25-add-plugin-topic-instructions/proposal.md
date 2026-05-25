## Why

Plugins currently have two ways to ship instructions for Claude: bake them into a hardcoded prompt constant (uneditable without rebuilding) or register them via `sdk.addInstruction` (always-loaded for every session on the matching role tier, even when the plugin is dormant). Neither is right for content that is plugin-specific *and* worth letting admins tune — like the Trivia plugin's game-show persona, reveal tone, and season-finale wrap-up. We want a third option: plugin-scoped instructions that load only when the plugin is actually running, are overrideable via the existing two-tier `data/configuration/` cascade, and hot-reload on edit.

The cascading-config-resolver already supports topic-scoped instruction files (`{role}/topics/<topic>/*.md`) and virtual defaults — the wiring exists but no plugin uses it. This change exposes that mechanism to plugins so they can ship overrideable, on-demand instruction content.

## What Changes

- Extend the plugin SDK with `sdk.addTopicInstruction(role, topic, filename, content)` — same shape as `addInstruction`, but routes the content into a topic-keyed virtual-default map instead of the baseline one.
- Extend `sdk.reconcileCronJobs` (and the `CronJobSpec` type) with an `attachedTopics?: string[]` option so a plugin's own scheduled runs auto-load its topics without Claude having to call `attach_integration`.
- Persist `attachedTopics` on `CronJob` and propagate it through `cronScheduler.executeDynamicJob` → `processMessage` → `loadInstructions` so the role cascade resolves the listed topics in addition to baseline instructions.
- `loadInstructions` gains an optional `topics: string[]` input (today it's hardcoded `undefined`); the cascade resolver already accepts this — only the plumbing is new.
- Plugin instructions registered as topic instructions remain overrideable via `data/configuration/{role}/topics/<topic>/<plugin>__<filename>.md`. File overrides win over plugin-provided virtual defaults exactly like baseline instructions do today.
- Trivia plugin adopts the new mechanism for plugin-specific guidance:
  - `GAME_SHOW_PERSONA` moves to a `trivia` topic instruction (`user` role) — the persona becomes referenceable from both `SEND_QUESTIONS_INSTRUCTIONS` and `PROCESS_REVEAL_INSTRUCTIONS` without being inlined.
  - Reveal tone hints (currently inlined in `PROCESS_REVEAL_INSTRUCTIONS`) move to a separate file under the same topic.
  - Season-finale wrap-up tone moves to its own file under the same topic.
  - The trivia `question` and `reveal` cron specs declare `attachedTopics: ["trivia"]`.
  - **Files that must stay global / hardcoded** (out of scope for relocation): cheating-detection guidance, block-layout contracts (FIVE-BLOCK question structure, reveal block structure, Round Summary format) — these couple to tool contracts and must not drift per workspace.
- Document the new SDK surface in the plugin-authoring guide and add a "topic instructions" section to the admin home-tab discovery so admins can find the override files.

## Capabilities

### New Capabilities

- `plugin-topic-instructions`: SDK surface for plugins to register topic-scoped instruction content, the cron-spec option to auto-attach a plugin's topics, and the end-to-end wiring that delivers those instructions into the system prompt only when the topic is active.

### Modified Capabilities

- `clack-plugins`: Adds `addTopicInstruction` to the plugin SDK; existing `addInstruction` semantics unchanged.
- `cascading-config-resolver`: Clarifies that topic resolution is driven by an explicit `topics: string[]` input (not solely by `attach_integration` runtime activation); virtual-default semantics for topic files unchanged.
- `plugin-cron-reconciliation`: Cron specs accept `attachedTopics?: string[]`; reconciled jobs persist the field.
- `cron-messages`: `executeDynamicJob` forwards `job.attachedTopics` into `processMessage`.
- `instruction-system`: `loadInstructions` accepts an optional pre-attached topic list and merges it with topics activated mid-session by `attach_integration`.
- `trivia-scheduled-prompts`: `SEND_QUESTIONS_INSTRUCTIONS` and `PROCESS_REVEAL_INSTRUCTIONS` no longer inline the persona / reveal-tone / season-finale wording — they reference the topic-loaded instructions instead. Cheating detection and block-layout rules stay inline.

## Impact

- **Code**:
  - `src/plugins/sdk.ts` — new `addTopicInstruction` method on `ClackSdk`; new `attachedTopics` option in `CronJobSpec`.
  - `src/plugins/registry.ts` — collect topic instructions alongside baseline instructions in plugin load results.
  - `src/instructions.ts` — extend `buildVirtualDefaults` to populate topic entries (keyed by `${topicPrefix}${filename}`); extend `LoadInstructionsOptions` with `topics?: string[]`; pass through to `resolveInstructions`.
  - `src/cronJobs.ts` — `CronJob` schema gains `attachedTopics?: string[]`; reconciliation propagates the field.
  - `src/cronScheduler.ts` — `executeDynamicJob` passes `job.attachedTopics` into `processMessage`.
  - `src/slack/handlers/core.ts` (`processMessage` plumbing) — accept and forward a `preAttachedTopics` option into `loadInstructions`.
  - `src/plugins/trivia/index.ts` — register the new `trivia` topic instructions; pass `attachedTopics: ["trivia"]` when reconciling its cron jobs.
  - `src/plugins/trivia/prompts/scheduledPrompts.ts` — remove `GAME_SHOW_PERSONA` inline constant from the two exported prompts; rewrite references to point at the topic-loaded instruction. Cheating-detection text and layout rules stay put.
  - `data/default_configuration/user/topics/trivia/*.md` — new default files shipped via the plugin SDK (virtual defaults — no on-disk presence required, but documented for admin overrides).
- **APIs**: New `sdk.addTopicInstruction(role, topic, filename, content)`; new optional `attachedTopics` on `CronJobSpec` and `CronJob`.
- **Migrations**: None required — `attachedTopics` is optional everywhere and defaults to no topics.
- **Backwards compatibility**: No breaking changes. Existing plugins that don't call `addTopicInstruction` and don't pass `attachedTopics` behave identically. Existing trivia cron jobs already persisted without `attachedTopics` will pick up the field on next reconcile (the plugin reconciles every boot).
- **Tests**: New tests for SDK surface, virtual-default routing for topics, cron-job propagation of `attachedTopics`, and an integration test confirming a topic-tagged cron run resolves topic instructions in the system prompt. Trivia integration tests update to expect the persona content via topic loading rather than inline constant.
