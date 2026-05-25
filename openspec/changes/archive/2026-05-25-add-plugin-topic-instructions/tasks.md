## 1. Plugin SDK surface

- [x] 1.1 Extend `ClackSdk` interface in `src/plugins/sdk.ts` with `addTopicInstruction(role: RoleDir, topic: string, filename: string, content: string): void`. Implementation pushes a record onto the same `instructions` array used by `addInstruction`, with `filename` set to `topics/${topic}/${pluginName}__${filename}.md`.
- [x] 1.2 Add inline JSDoc on `addTopicInstruction` explaining the override path (`data/configuration/<role>/topics/<topic>/<pluginName>__<filename>.md`) and that the topic is loaded only when active for a session.
- [x] 1.3 Extend the `CronJobSpec` interface (same file) with an optional `attachedTopics?: string[]` field, with a JSDoc note linking to the `plugin-topic-instructions` capability.
- [x] 1.4 Add unit tests in `src/plugins/sdk.test.ts` (or create the file if absent) covering: filename prefixing, role-keyed storage, multiple topics from one plugin, two plugins on the same topic, baseline `addInstruction` unaffected.

## 2. Plugin load result + virtual-defaults routing

- [x] 2.1 In `src/instructions.ts`, update `buildVirtualDefaults()` so a plugin instruction whose filename begins with `topics/` is stored at the same key in the per-role map. (No filtering change needed in `buildVirtualDefaults` itself if the SDK already prefixes; verify the existing code at `src/instructions.ts:57-66` preserves the key unchanged. Add a comment confirming topic-keyed entries flow through.)
- [x] 2.2 Add a unit test in `src/instructions.test.ts` (or extend an existing test file) that registers a plugin with one baseline instruction and one topic instruction, calls `buildVirtualDefaults()` (via `loadInstructions` integration), and verifies both keys appear in the resulting `VirtualDefaults` map under the right shape.

## 3. loadInstructions accepts pre-attached topics

- [x] 3.1 Extend `LoadInstructionsOptions` in `src/instructions.ts` with an optional `topics?: string[]` field.
- [x] 3.2 Update `loadInstructions()` to convert the `topics` array to a `Set<string>` and pass it through to `resolveInstructions(roleChain, activeTopics, virtualDefaults)`. When `topics` is absent or empty, pass `undefined` to preserve byte-identical behavior.
- [x] 3.3 Add tests in `src/instructions.test.ts` for: absent `topics` (byte-identical to today), empty `topics: []` (byte-identical), single pre-attached topic (resolves topic section), pre-attached + runtime-attached merge (will require a small refactor in step 4 to surface runtime topics — see notes).
- [x] 3.4 Audit every existing caller of `loadInstructions` (use `LSP findReferences` or grep) to confirm none accidentally pass an unexpected `topics` value; all current callers should leave it absent. (Only caller is `src/claude/promptBuilder.ts:buildSystemPrompt`, now updated to thread `options.preAttachedTopics`.)

## 4. processMessage propagates pre-attached topics

- [x] 4.1 Extend `ProcessMessageParams` in `src/slack/handlers/core.ts` (and any downstream type files) with `preAttachedTopics?: string[]`.
- [x] 4.2 Inside `processMessage`, when constructing the call to `loadInstructions`, union `preAttachedTopics` with any topics resolved from session state (the existing `attach_integration` machinery) and pass the result via `LoadInstructionsOptions.topics`.
- [x] 4.3 Locate the runtime-topic source (likely `src/sessions.ts` or wherever `attach_integration` mutates session state) and confirm it surfaces an array we can union with — adjust if needed. (Per design.md decision #4, runtime `attach_integration` injects topic content through the tool result, not through `loadInstructions`. No union needed — pre-attached topics enter via the system prompt, runtime topics via tool-result delta.)
- [x] 4.4 Add an integration test that calls `processMessage` with `preAttachedTopics: ["trivia"]` and asserts the system prompt passed to the Claude SDK contains a `=== TOPIC: trivia ===` section.

## 5. CronJob persistence

- [x] 5.1 Extend the `CronJob` Zod schema and TypeScript type in `src/cronJobs.ts` with `attachedTopics?: z.array(z.string()).optional()`. (No Zod schema in this codebase — used the TS interface directly, same pattern as other fields.)
- [x] 5.2 Confirm the serializer omits the field when absent and emits the array when present (existing JSON write path; verify no `delete` logic stomps it). (Spread-conditional in `createJob`; full state written via `saveState` which serializes the in-memory object as-is.)
- [x] 5.3 Update `src/cronJobs.test.ts` with cases for: round-trip of a job with `attachedTopics`, load of a legacy job without the field, and persistence of the field after `createCronJob`.

## 6. Reconcile applies attachedTopics

- [x] 6.1 In the reconcile path (likely `src/cronJobs.ts` `reconcileCronJobs` or near `createJob`/`updateJob`), apply `spec.attachedTopics` on create (set the field if present) and on in-place update (overwrite the persisted field with the spec value, OR clear it when the spec omits the field — per the spec's "clears the persisted field" scenario).
- [x] 6.2 Test cases in `src/cronJobs.test.ts`: new job persists `attachedTopics`; re-reconcile overwrites; re-reconcile without the field clears it; admin-disabled job still gets `attachedTopics` updated; field-removal does not corrupt unrelated fields.

## 7. Scheduler forwards attachedTopics

- [x] 7.1 In `src/cronScheduler.ts`, inside `executeDynamicJob`, pass `job.attachedTopics` into the `processMessage` call as `preAttachedTopics: job.attachedTopics`.
- [x] 7.2 Test in `src/cronScheduler.test.ts`: a job with `attachedTopics: ["trivia"]` reaches `processMessage` with the right value; a job without the field passes `undefined`.

## 8. Trivia plugin adopts the new SDK

- [x] 8.1 In `src/plugins/trivia/index.ts`, add three calls in the plugin init: `sdk.addTopicInstruction("user", "trivia", "persona", PERSONA_CONTENT)`, `sdk.addTopicInstruction("user", "trivia", "reveal-tone", REVEAL_TONE_CONTENT)`, `sdk.addTopicInstruction("user", "trivia", "finale-tone", FINALE_TONE_CONTENT)`. Place these registrations near the existing `sdk.addInstruction("user", "trivia-check", ...)` call.
- [x] 8.2 Add a new file `src/plugins/trivia/prompts/topicInstructions.ts` exporting the three content strings (`PERSONA_CONTENT`, `REVEAL_TONE_CONTENT`, `FINALE_TONE_CONTENT`). The persona string SHALL be byte-identical to the current `GAME_SHOW_PERSONA` constant.
- [x] 8.3 In `src/plugins/trivia/prompts/scheduledPrompts.ts`: delete the `GAME_SHOW_PERSONA` constant. Replace its two interpolations (line 415 region in `SEND_QUESTIONS_INSTRUCTIONS`, line 607 region in `PROCESS_REVEAL_INSTRUCTIONS`) with a short reference line ("Your persona, tone, and season-finale style are described in the `trivia` topic of your system instructions.").
- [x] 8.4 In the same file: extract the reveal-tone phrasing currently inline in `PROCESS_REVEAL_INSTRUCTIONS` (the "punchy", "use your persona", and explanatory tone hints around line 644) into the `REVEAL_TONE_CONTENT` constant. Trim the inline prompt text to a short reference.
- [x] 8.5 Same file: extract the season-finale wrap-up tone (the lines around 651 and 662 instructing Claude how to phrase the closing-season section) into `FINALE_TONE_CONTENT`. Replace the inline text with a short reference ("Use the season-finale tone described in the `trivia` topic when `seasonStatus.isLastFireOfSeason` is true.").
- [x] 8.6 Verify the layout rules (FIVE-BLOCK question structure, reveal block structure, Round Summary block format) and the cheating-detection text remain inlined and untouched.

## 9. Trivia cron specs declare the topic

- [x] 9.1 In `src/plugins/trivia/domain/buildGameSpecs.ts`, set `attachedTopics: ["trivia"]` on every `CronJobSpec` returned (both `<name>:question` and `<name>:reveal`).
- [x] 9.2 Update existing tests in `src/plugins/trivia/domain/buildGameSpecs.test.ts` to assert `attachedTopics: ["trivia"]` on both spec shapes.

## 10. Trivia integration tests

- [x] 10.1 Update `src/plugins/trivia/prompts/scheduledPrompts.test.ts` and `scheduledPrompts.choice.test.ts` to reflect the removal of inline persona from the exported prompt constants. Snapshot tests that assert the literal string must be updated; remove any assertion that the persona substring appears inline.
- [x] 10.2 Add a new integration test that simulates a trivia cron fire end-to-end (or as close as possible without hitting Slack): build the system prompt with `roleOverride: "system"` + `attachedTopics: ["trivia"]`, assert the assembled prompt contains the persona content under a `=== TOPIC: trivia ===` header.
- [x] 10.3 Add a regression test verifying admin override: write a file to a temp `data/configuration/user/topics/trivia/trivia__persona.md`, re-run the assembly, assert the override content wins.

## 11. Home Tab listings include plugin-contributed topic files

- [x] 11.1 Verify the existing `listRoleTopicDirFiles` helper in `src/cascadingConfigResolver.ts` already handles plugin virtual defaults correctly (per `Topic File Discovery in Home Tab`). If gaps exist, extend it to emit the `plugin` and `plugin-customized` source labels for topic files.
- [x] 11.2 If the Home Tab UI does not yet surface topic files (per the existing capability requirement), confirm at least that the MCP `list_config_files` tool exposes the new plugin-contributed topic entries with the right source labels. Add a test covering this case.

## 12. Documentation

- [x] 12.1 Update `CLAUDE.md` (project root) to document the new `addTopicInstruction` SDK method and the `attachedTopics` field on `CronJobSpec`. Place these in the existing "Instruction System (two-tier)" section.
- [x] 12.2 Document the override path convention `data/configuration/<role>/topics/<topic>/<plugin>__<filename>.md` in the same section.
- [x] 12.3 Add a one-line note clarifying which trivia content moved to the `trivia` topic (persona, reveal-tone, finale-tone) and which content remains inline (cheating detection, layout rules).

## 13. Validation and verification

- [x] 13.1 Run `npm run build` and `npx tsc` to confirm zero TypeScript errors.
- [x] 13.2 Run `npm test` to confirm all tests pass.
- [x] 13.3 Run `npx oxlint src/` and `npx oxfmt --check src/` to confirm formatting and linting pass.
- [x] 13.4 Run `openspec validate add-plugin-topic-instructions --strict` to confirm the change artifacts validate.
- [x] 13.5 Manually trigger a trivia cron job (via the Home Tab "Run now" affordance or `run_scheduled_message_now`) and inspect the persisted session's system prompt to confirm the `=== TOPIC: trivia ===` section is present and contains the expected content.
- [x] 13.6 Create a temporary override file at `data/configuration/user/topics/trivia/trivia__persona.md` with distinctive text, trigger another run, and confirm the persona changes accordingly. Remove the override after testing.
