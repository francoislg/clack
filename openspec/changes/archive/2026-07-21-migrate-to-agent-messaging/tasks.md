## 0. De-risk / spike (before committing)

- [x] 0.1 Spike the Bolt 5 upgrade: `npm i @slack/bolt@5 @slack/web-api @slack/types@latest`, `npx tsc`, catalogue the breaking-change surface. **FINDINGS:** Bolt 5 requires web-api **^8** (bundles it) + Express 5; pinning web-api ^7 caused ~130 dual-WebClient-version errors (an artifact, not real breaks). The TRUE break surface after unifying on web-api ^8 is small: `ActionHandler` args now require `payload` (1 error, `trivia/clickHandlerInstaller`) + a `ChatStreamer` private-field test artifact. → target pairing is **Bolt 5 + web-api ^8**.
- [x] 0.2 Confirm Bolt 5's agent model. **FINDINGS:** `Assistant` class + `app.assistant()` survive unchanged (`assistant.ts` compiles clean → `dmType: "assistant"` unaffected). NO `app.agent()` / `sayStream` on `App` — agent messaging is plain event listeners (`app_home_opened` + `message.im`), matching the `agent.ts` design. Still needs a LIVE check for the `app_home_opened` (tab `"messages"`) payload shape and whether `assistant_thread_context_changed` fires under agent_view — deferred to 7.3.
- [x] 0.3 RESOLVED via the shipped fallback: session keying uses `threadTs || messageTs` (classic path), confirmed working live with thread continuity. The residual question — does Slack's `assistant.threads.*` accept that root — is scoped into the 8.2 probe.
- [x] 0.4 Confirmed: the workspace is irreversibly on `agent_view` and DMs WERE broken; operator chose fix-forward (task 1.1).

## 1. Stopgap (only if DMs are broken now)

- [~] 1.1 SKIPPED — DMs are down (0.4), but the operator chose to fix forward rather than run the `dmType: "classic"` stopgap. The broken-DM window is accepted until the agent handler ships.

## 2. Dependency upgrade (Bolt 4 → 5, web-api ≥ 7.18)

- [x] 2.1 Bumped `@slack/bolt` `^5.0.0`, `@slack/web-api` `^8.0.0`, `@slack/types` `^3.0.0` (Express 5.2.1 transitively); lockfile refreshed. `tsc` collapsed to exactly ONE error, as spike 0.1 predicted (the ChatStreamer error was a dual-version artifact and vanished once web-api unified on ^8).
- [x] 2.2 Fixed the single residual break in `trivia/answerTypes/clickHandlerInstaller.test.ts`: Bolt 5's `RespondFn` return type is no longer comparable to `Promise<void>`, which broke the narrowed action-args cast (surfaced misleadingly as "payload missing"). Made `MinimalActionArgs` a clean structural subset (like the sibling `hintButton.test.ts`) and moved `respond` to a runtime-only property. `assistant.ts` needed no change.
- [x] 2.3 Full suite green under Bolt 5: 7586 passed, 4 skipped.

## 3. Config + manifest: add the `"agent"` mode

- [x] 3.1 Added `"agent"` to `VALID_DM_TYPES` (`configSchemas.ts` + `config.ts` `DmType`) and the `DmType` union in `generate-manifest.ts`. Config tests: `dmType: "agent"` accepted, unknown dmType throws.
- [x] 3.2 `generate-manifest.ts` `"agent"` branch: emits `agent_view` + `agent_description` (messages tab already on via `messages_tab_enabled: features.directMessages`), keeps `assistant:write`, subscribes `message.im` + core `app_home_opened`, omits the assistant thread events. Assistant/classic branches untouched.
- [x] 3.3 `generate-manifest.test.ts`: agent asserts agent_view present / assistant_view absent / thread events absent / assistant:write present; assistant & classic assert no agent_view.

## 4. New agent DM handler (sibling to assistant/classic)

- [x] 4.1 Converged via reuse (no duplication): `agent.ts` calls classicDm's exported `handleClassicDmEvent` for the message path rather than copying the normalization/filter/stop logic.
- [x] 4.2 Added `src/slack/handlers/agent.ts` `registerAgent`: `app.message` (im) → shared DM handler (`thread_ts` optional); `app_home_opened` (tab `"messages"`) listener in place. **MVP scope:** greeting / suggested-prompts / live status via `assistant.threads.*` are deferred (their agent_view payload shape needs live confirmation, and greeting-on-every-open risks spam) — the answer path is the deliverable.
- [x] 4.3 Routed `dmType === "agent"` → `registerAgent` in `app.ts` (beside classic/assistant); wired into `AppDeps`. Routing test added.
- [x] 4.4 Satisfied by the classicDm reuse: `processMessage` keys the DM session by `threadTs || messageTs`, so a `thread_ts`-less agent turn keys to its own ts. No `SessionContext` change.
- [x] 4.5 RESOLVED as a deliberate drop: no confirmed agent_view equivalent of `assistant_thread_context_changed`, so `assistantCurrentChannelId` stays unset under agent mode (downstream already treats it as optional). Greeting likewise DROPPED (spammy on every tab-open; `agent_description` + static prompts fill the role). The remaining polish is phase 8.
- [x] 4.6 Added `agent.test.ts`: message routed through the shared handler; `app_home_opened` acts only on the messages tab. `assistant.test.ts` untouched.

## 5. Search tool cleanup (typed assistant.search.context)

- [~] 5.1 SKIPPED — web-api 8.0.0 still does NOT type `client.assistant.search.context` (verified: `c.assistant.search` is undefined). `searchMessages.ts` keeps the `apiCall` workaround; no code change, behavior-neutral.
- [~] 5.2 N/A — 5.1 skipped.

## 6. Documentation

- [x] 6.1 README `dmType` section updated to the three-way split (assistant legacy/deprecating, agent = agent_view/Bolt 5/irreversible, classic view-agnostic) with the restart+re-upload / reinstall-only-on-new-scope nuance.
- [x] 6.2 CLAUDE.md DM-mode note rewritten: three siblings + boot routing, agent_view event/scope consequences, Bolt 5 + web-api ^8 baseline, classic as the in-workspace fallback.

## 7. Verification

- [x] 7.1 `npx tsc`, `npx oxlint`, `npx oxfmt --check` clean (enforced by the pre-commit hook on commit `381d8e8`).
- [x] 7.2 `npm test` green (full suite ran in the same hook).
- [~] 7.3 Live e2e PARTIAL: DM Q&A confirmed answering with thread continuity; @mention confirmed. Remaining live checks (manifest re-upload with prompts, probe results) fold into phase 8.
- [x] 7.4 `graphify update .` run and graph committed with the code (`381d8e8`).

## 8. Polish increment (probe-gated — see design.md "Polish increment")

- [x] 8.1 Populated `agent_view.suggested_prompts` in `generate-manifest.ts` from the i18n source-of-truth (`AGENT_SUGGESTED_PROMPTS` = capabilities / debug / funny; channel-context prompt omitted). Added `generate-manifest.test.ts` case asserting non-empty, well-formed prompts. `slack-app-manifest.json` regenerated. tsc/oxlint/oxfmt/tests green. **Operator action: re-upload the manifest** (no reinstall — no new scope).
- [x] 8.2 Live probe DONE (deployed twice — `debug` logs are inert in prod's `info`, so the probe was promoted to `info` for the second run). Answers from real traffic: (i) a turn-1 DM carries **no** `thread_ts` (`has_thread_ts=false`); (ii) `setStatus` **accepts the bare message ts** (`from=message-ts`) — the auto-open claim holds; (iii) `setTitle` **works** with the same root; bonus — `app_home_opened` payload keys are `type,user,channel,tab,event_ts` (no thread/context), confirming the channel-context drop. Probe correctly skipped `message_changed` edits and channel messages. Instrumentation removed in 8.3.
- [x] 8.3 IMPLEMENTED (probe said yes; the title was explicitly wanted). Added optional `DmTurnHooks` (`onTurnStart`/`onTurnEnd`) to the shared `handleClassicDmEvent`, fired only after every filter passes with the resolved `threadRoot = thread_ts || ts`; classic passes none. `agent.ts` supplies `agentTurnHooks`: `setStatus(thinking)` on start, `setStatus("")` + truncated `setTitle` on end — each call best-effort (logged + swallowed). Removed the temporary probe. Tests: `classicDm.test.ts` (hook ordering, filtered/stop no-fire, `onTurnEnd` in `finally` on throw) + `agent.test.ts` (status/title args, failure-swallow). tsc/oxlint/oxfmt/full-suite green.
