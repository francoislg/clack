## 1. SDK: Hidden flag in tool mapping

- [x] 1.1 Add optional `hidden?: boolean` to `ToolEntryObject` in `src/streaming/toolMappingLoader.ts`
- [x] 1.2 Update `src/plugins/sdk.ts` `ToolMapping` type to re-export the extended `ToolEntryObject` (it already does — verify no changes needed)
- [x] 1.3 Update the tool-mapping resolver so mappings with `hidden: true` are merged into the resolved hidden-tools set at load time
- [x] 1.4 Add a unit test in `src/streaming/toolMappingLoader.test.ts` verifying a plugin-registered tool with `hidden: true` is treated as hidden

## 2. SDK: Remove `requireToolsForScheduled`

- [x] 2.1 Remove the `requireToolsForScheduled` method from the `ClackSdk` interface and factory in `src/plugins/sdk.ts`
- [x] 2.2 Remove `scheduledRequiredTools` from `PluginLoadResult` in `src/plugins/sdk.ts`
- [x] 2.3 Remove the union/merge logic in `src/cronScheduler.ts` (`computeEffectiveRequiredTools`) that consulted the plugin's `scheduledRequiredTools`
- [x] 2.4 Remove the corresponding tests in `src/plugins/sdk.test.ts`
- [x] 2.5 Remove the `sdk.requireToolsForScheduled(["submit_answers"])` call from `src/plugins/trivia/index.ts`

## 3. Trivia plugin: Cheat tracking data layer

- [x] 3.1 Add `cheatAttempts?: number` to `TriviaUser` in `src/plugins/trivia/types.ts`
- [x] 3.2 Add a `CheatReport` type `{ cheaterUserId, questionId, reason, evidence?, detectedAt }` to `src/plugins/trivia/types.ts`
- [x] 3.3 Extend `TriviaDataLayer` with `loadCheats()` and `saveCheat(report)` methods
- [x] 3.4 Implement `loadCheats`/`saveCheat` in `createSdkDataLayer` (writes to `cheats.json` in the plugin data dir)
- [x] 3.5 Implement `loadCheats`/`saveCheat` in `createFileDataLayer` and `createInMemoryDataLayer` for parity
- [x] 3.6 Add a helper in the data layer that atomically increments a user's `cheatAttempts` (load users, bump field, save users)

## 4. Trivia plugin: `save_cheating` tool

- [x] 4.1 Create `src/plugins/trivia/saveCheating.ts` exporting `createSaveCheatingTool(data)` with args `{ cheaterUserId, questionId, reason, evidence? }`
- [x] 4.2 Tool description MUST instruct Claude that the cheater is always the author of the evidence, that third-party reports are rejected, and that the call must be silent (no mention in user-facing output)
- [x] 4.3 Handler appends a `CheatReport`, increments the user's `cheatAttempts`, and returns `{ totalAttempts, notifyOwner: true }`
- [x] 4.4 Register the tool in `src/plugins/trivia/index.ts` with `minRole: "member"` and mapping `{ label: "Reviewing response", hidden: true }`
- [x] 4.5 Add `src/plugins/trivia/saveCheating.test.ts` covering: first cheat initializes counter, subsequent cheats increment, report is appended, bad args rejected

## 5. Trivia plugin: Instruction tools

- [x] 5.1 Create `src/plugins/trivia/sendQuestionsInstructions.ts` exporting `createSendQuestionsInstructionsTool()` that returns the Game Show question-posting prompt as text; no args; description per spec
- [x] 5.2 Create `src/plugins/trivia/processResponsesInstructions.ts` exporting `createProcessResponsesInstructionsTool()` that returns the Game Show answer-reveal prompt (incl. cheat-detection + `<@ASKER_ID>` placeholder); no args; description per spec
- [x] 5.3 Create `src/plugins/trivia/createSchedulesInstructions.ts` exporting `createCreateSchedulesInstructionsTool()` that returns the setup recipe (duplicate check, asker-ID substitution, both schedule definitions); no args; description per spec
- [x] 5.4 Extract shared step sequence (category pick → novelty check → difficulty gate → save) as a TS constant so both the question-posting prompt and any future user-triggered flow can compose from one source (even though the user-triggered flow is being removed — still useful for single-source)
- [x] 5.5 Register all three tools in `src/plugins/trivia/index.ts` with `minRole: "admin"` and descriptive visible mappings (`"Fetching trivia setup instructions"`, `"Fetching question-posting instructions"`, `"Fetching response-processing instructions"`)
- [x] 5.6 Add tests verifying each tool returns a non-empty string and that the recipe references the expected tool names, `requiredTools` lists, and the `<@ASKER_ID>` placeholder

## 6. Trivia plugin: Remove legacy instruction block, ship trivia-check

- [x] 6.1 Delete the `TRIVIA_INSTRUCTIONS` constant and the `sdk.addInstruction("user", "instructions", TRIVIA_INSTRUCTIONS)` call from `src/plugins/trivia/index.ts`
- [x] 6.2 Confirm no other code references `TRIVIA_INSTRUCTIONS`
- [x] 6.3 Create `src/plugins/trivia/triviaCheckInstruction.ts` exporting a `TRIVIA_CHECK_INSTRUCTION` constant; seed it from the current `data/configuration/user/trivia-check.md` content
- [x] 6.4 Update the instruction text to use `save_cheating` for persistence (steps: detect → call save_cheating with `{ cheaterUserId, questionId, reason, evidence }` → DM the owner via `submit_response` + `post_to`). Remove the "counter on user" manual bookkeeping now that `save_cheating` handles it
- [x] 6.5 Register in `src/plugins/trivia/index.ts`: `sdk.addInstruction("user", "trivia-check", TRIVIA_CHECK_INSTRUCTION)`
- [x] 6.6 Verify the existing `data/configuration/user/trivia-check.md` still overrides the plugin default via the cascading config resolver (no behavior regression for current deployment); note that admins can either delete the override to pick up the plugin default or keep a customized version

## 7. Type-check, tests, and spec validation

- [x] 7.1 Run `npx tsc` and resolve any type errors introduced by SDK changes
- [x] 7.2 Run `npm test` — all existing tests green; new tests from sections 3, 4, 5 pass
- [x] 7.3 Run `openspec validate trivia-instruction-tools --strict`
- [ ] 7.4 Manual smoke test: load the plugin locally, call each of the three instruction tools via the MCP catalog, verify output is complete and coherent
- [ ] 7.5 Manual smoke test: from an admin session, ask Clack to "set up trivia in #test-channel" and verify two cron jobs are created with thin prompts, correct `requiredTools`, and the current asker's ID baked into Schedule B
- [ ] 7.6 Manual smoke test: invoke `save_cheating` via a dev session; confirm no task card renders, `cheats.json` is updated, user counter is incremented, and the return payload carries `notifyOwner: true`
