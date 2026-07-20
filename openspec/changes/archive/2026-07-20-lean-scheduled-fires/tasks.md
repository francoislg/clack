# Tasks — Lean Scheduled Fires

## 1. Casual-talk split: engagement topic + lean prompt

- [x] 1.1 Extract the static engagement guidance (Step 2 triage, Reacting subsection, Step 3 posting/termination, persona constraints) from `prompt.ts` into new `engagement.ts` content constant (no config-derived values — see design D2 for the static/dynamic split)
- [x] 1.2 Rewrite `buildPrompt` as the lean triggering prompt: KEEP the `random_roll` step, miss → skip, channels block, fallback-topics block, rate/die, and skip-strictness variant; ADD the hit directive (attach `casual-talk:engagement` + `response-rendering`) directly under the roll; REMOVE the Step 2 triage mechanics, Step 2 Reacting subsection, and Step 3 posting/termination mechanics (they move to `engagement.ts`)
- [x] 1.3 Register the `engagement` on-demand server (`autoload: false`, description) in `index.ts` with the topic instruction bound via the handle; no tools
- [x] 1.4 Update `prompt.ts` tests: lean assertions (mechanics absent, directive present, config blocks present); keep/extend the fallback-topics resolution tests (built-in∪custom dedup, custom-only, none → chip-in-only variant); add engagement-content tests (mechanics present, no config values, termination contract present only there)

## 2. Spec changes

- [x] 2.1 In `index.ts`, set spec `attachedTopics` to `["casual-talk"]` (drop `response-rendering`); `requiredTools` stays `["mcp__clack__random_roll"]`
- [x] 2.2 Update `plugin.test.ts`: assert `attachedTopics` is now `["casual-talk"]` (no `response-rendering`); confirm `requiredTools` remains `["mcp__clack__random_roll"]`

## 3. Skill-catalog gating for plugin-managed scheduled fires

- [x] 3.1 Thread the firing job's `pluginManaged` flag through the scheduled trigger context to the prompt-options supplier in `src/claude/index.ts` (no cron-job lookup at prompt-build; absent flag → fail open); omit `skillPluginsRegistry` + `userSkills` when scheduled + plugin-managed
- [x] 3.2 Tests beside the prompt-options supplier / prompt builder (`src/claude/` test files): plugin-managed scheduled fire prompt has no SKILL PACKS / USER SKILLS but keeps AVAILABLE INTEGRATIONS; user-created schedule (no `pluginManaged` flag) and interactive triggers unchanged

## 4. Verification

- [x] 4.1 Full suite (`npm test`), `npx tsc --noEmit`, `npx oxlint`, `npx oxfmt --check` green
- [x] 4.2 Sanity-measure: lean chatter prompt is 1,992 chars vs ~10.5k pre-change (−8.5k chars ≈ −2.1k tokens per fire); engagement topic content is 10.5k chars, loaded on hits only
- [x] 4.3 Topic-binding test (`plugin.test.ts`): engagement instruction registered under `topics/casual-talk:engagement/` with no tools on the server; the `attach_integration` instructions-only resolution path is core machinery covered by its own capability tests
