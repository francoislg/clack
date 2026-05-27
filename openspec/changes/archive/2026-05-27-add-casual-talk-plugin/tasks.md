## 0. Dependencies

- [x] 0.1 `channelless-cron-jobs` archived (`openspec/changes/archive/2026-05-27-channelless-cron-jobs/`). SDK accepts channelless specs; schema honors the rule.

## 1. Plugin scaffolding

- [x] 1.1 `src/plugins/casual-talk/index.ts` — plugin entry, capability gate, dictionary registration
- [x] 1.2 `src/plugins/casual-talk/types.ts` — `CasualTalkConfig`, `CasualTalkChannel`, `CasualTalkRate`, `CasualTalkWorkHours`, `normalizeChannel`
- [x] 1.3 Registered in `src/plugins/registry.ts` under `BUILTIN_PLUGINS["casual-talk"]`
- [x] 1.4 No imports outside `src/plugins/casual-talk/**` other than `../sdk.js` + third-party (`zod`, `@anthropic-ai/claude-agent-sdk`) — `textResult`/`errorResult` re-implemented locally in `helpers.ts`
- [x] 1.5 Test: plugin refuses to load when crons disabled — `plugin.test.ts` "refuses to load when cron scheduler is disabled"

## 2. Config schema, load/save, validation

- [x] 2.1 `src/plugins/casual-talk/config.ts` — Zod schema for `CasualTalkConfig`
- [x] 2.2 `loadConfig` / `saveConfig` using `sdk.readFile` / `sdk.writeFile`
- [x] 2.3 First-load behavior: `DEFAULT_CONFIG` seeded when file absent
- [x] 2.4 Validates `workHours.start < workHours.end`, ranges, days non-empty
- [x] 2.5 Validates `tz` via `Intl.DateTimeFormat({ timeZone })`
- [x] 2.6 Validates channel `id` via local Slack-channel-ID regex (re-implemented per isolation rules)
- [x] 2.7 Tests: schema accepts/rejects per documented invariants — `config.test.ts` (13 tests)

## 3. Heuristic and cron expression

- [x] 3.1 `src/plugins/casual-talk/heuristic.ts` — `resolveDie(config)`
- [x] 3.2 Named-rate → die mapping per spec
- [x] 3.3 `config.die` override; clamp to `>= 1`; round to nearest integer
- [x] 3.4 `buildCronExpression(workHours)` returning the fixed-cadence string
- [x] 3.5 Tests: every named rate × representative workHours produces expected die — `heuristic.test.ts` "resolveDie — named rates" block
- [x] 3.6 Tests: `die` override wins; clamp behavior; cron-expression builder — `heuristic.test.ts` "die override" + "buildCronExpression" blocks

## 4. Prompt assembly

- [x] 4.1 `src/plugins/casual-talk/prompt.ts` — `buildPrompt({ die, rateLabel, channels, smallTalkTopics })`
- [x] 4.2 Prompt structure: roll → skip-unless-1 → channels → topics → post_to delivery → submit_response terminator → persona constraints
- [x] 4.3 Tests: prompt includes resolved die, channel ids, promptSuggestions, topics — `prompt.test.ts`
- [x] 4.4 Tests: prompt states delivery via `post_to` and forbids submit_response-text — `prompt.test.ts` "explicitly tells Claude delivery is via post_to"

## 5. Persona topic

- [x] 5.1 `src/plugins/casual-talk/persona.ts` — `PERSONA_CONTENT` constant
- [x] 5.2 Plugin init calls `sdk.addTopicInstruction("user", "casual-talk", "persona", PERSONA_CONTENT)`
- [x] 5.3 Test: persona is registered exactly once — `plugin.test.ts` "registers persona under the casual-talk topic"
- [ ] 5.4 Manual verification (deferred — override path is the established cascading-config-resolver semantic, exercised by trivia)

## 6. On-demand management server

- [x] 6.1 `sdk.registerMcpServer("management", { autoload: false, description: ... })` in `index.ts`
- [x] 6.2 All 10 config-mutation tools bound via `management.registerTool(...)`
- [x] 6.3 Test: management server registered with `autoload: false`; all 10 tools bound there — `plugin.test.ts` "registers the management server" + "registers all 10 management tools"

## 7. Admin tools

- [x] 7.1 `set_casual_talk_config` — full replace, validate, save, soft restart (`tools/setConfig.ts`)
- [x] 7.2 `add_channel`, `remove_channel`, `set_channel_prompt_suggestion` (`tools/channels.ts`)
- [x] 7.3 `add_small_talk_topic`, `remove_small_talk_topic` (`tools/topics.ts`)
- [x] 7.4 `set_expected_rate` accepts `rate` OR `die` (`tools/rate.ts`)
- [x] 7.5 `set_work_hours` (`tools/workHours.ts`)
- [x] 7.6 `enable` / `disable` (idempotent) (`tools/toggle.ts`)
- [x] 7.7 Tool mapping labels per spec ("Adding casual-talk channel — {id}", etc.)
- [x] 7.8 Tests: per tool — success, validation, idempotency, soft-restart trigger, error responses — `tools/tools.test.ts` (19 tests across all 10 tools)

## 8. Cron-spec reconciliation

- [x] 8.1 `index.ts` builds the single `CronJobSpec` from the loaded config; skips when disabled or no channels
- [x] 8.2 Spec fields per design: channelless, `submitResponseMode: "skipped"`, `attachedTopics: ["casual-talk"]`, `requiredTools: ["mcp__clack__random_roll"]`, `name: "Casual chatter"`
- [x] 8.3 `sdk.reconcileCronJobs("casual-talk", specs)` invoked
- [x] 8.4 Test: reconcile produces channelless spec / empty / handles removal — `plugin.test.ts` "reconciles" + "removes a previously-reconciled spec"

## 9. i18n

- [x] 9.1 `src/plugins/casual-talk/i18n/strings.ts` — `en` and `fr` tables
- [x] 9.2 Plugin init calls `sdk.registerDictionary({ en, fr })`
- [x] 9.3 All direct-to-Slack strings (tool result messages) route through `sdk.t(key, vars?)`
- [x] 9.4 Tool descriptions and prompt content stay English
- [x] 9.5 Test: dictionary registration; `sdk.t` resolves a key — `plugin.test.ts` "registers the EN dictionary"

## 10. Soft-restart wiring

- [x] 10.1 Every mutating tool ends with `sdk.requestSoftRestart("casual-talk: <reason>")`
- [x] 10.2 Test: each mutating tool calls `requestSoftRestart` once on success / not on failures / not on idempotent no-ops — covered across `tools/tools.test.ts`

## 11. Documentation and operator visibility

- [x] 11.1 README updated with the new "Built-in Plugins" section describing casual-talk, config shape, expectedRate semantics, and the "rate is total" caveat
- [x] 11.2 `data/default_configuration/admin/casual-talk-admin.md` — admin-tier instruction describing the management tool surface, when to attach, and the "rate is total" reminder
- [x] 11.3 Home Tab plugin status section: the existing `getLoadedPlugins()` iteration surfaces casual-talk automatically (it's registered in `BUILTIN_PLUGINS` and produces a `PluginLoadResult` with `name: "casual-talk"`). No casual-talk-specific homeTab code needed.

## 12. Validation and smoke

- [x] 12.1 `openspec validate add-casual-talk-plugin --strict` passes
- [x] 12.2 `npx tsc` clean for casual-talk; `npm test` reports 4658 passed / 3 skipped (12 new tests for casual-talk in this round)
- [ ] 12.3 Manual smoke: enable plugin with 1 channel, fire the cron via a test harness, verify post or legitimate skip (deferred — requires a real Slack workspace + running app; covered by the unit-level integration tests in `plugin.test.ts`)
- [ ] 12.4 Manual smoke: switch `expectedRate` via the tool, observe soft restart, verify die changes (deferred — same)
