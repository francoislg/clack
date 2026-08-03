# Tasks — add-split-investigations

## 1. Config & State Foundation

- [x] 1.1 Add `investigations` block to config schemas (`config.ts`/`configSchemas.ts`): `{ enabled: boolean, emoji: string = "mag" }`, fail-fast zod; unit tests for absent/valid/invalid shapes
- [x] 1.2 Create `src/investigations/state.ts`: graceful zod reader/single-writer for `data/state/investigations.json` (`{ channel, open }`), in-memory index keyed `channel:threadTs`, mutation API (setChannel, openInvestigation, closeInvestigation, updateFollowedThreadMeta); expose a boot loader that rebuilds the index from disk, called from `src/index.ts` before Slack handler registration so the index is populated before any event arrives; unit tests incl. corrupt-file non-wipe and index rebuild on load
- [x] 1.3 Add `followedThreads` to `SessionContext` in `src/sessions.ts` (persisted; absent = no follows) + zod on the sessions loader path; DM-surface investigations reuse the existing `dmChannel`/`dmThreadTs` delivery fields (no new delivery fields), channel-surface investigations are normal thread-indexed sessions in the investigations channel; unit tests for persistence round-trip and legacy-session load

## 2. Bootstrap & Entry Points

- [x] 2.1 Create `src/investigations/bootstrap.ts`: surface resolution (channel-from-state | DM via existing DM plumbing), main-parent post, session creation with `followedThreads: [origin]`, thread-index registration, public-channel auto-join with degrade-to-follow on failure, breadcrumb post via `t()`; unit tests per surface + join-failure degrade
- [x] 2.2 Immediate first round: invoke `processMessage` on the new session with full-history drain (`lastInjectedTs` from 0); test that findings land in the main thread only
- [x] 2.3 Reaction handler `src/slack/handlers/investigateReaction.ts`: filter on `config.investigations.emoji`, thread resolution (newQuery idiom), dedup → ephemeral link to existing, unconfigured → owner DM + reactor ephemeral; register in `app.ts` gated on `enabled`; unit tests for trigger/dedup/unconfigured/disabled
- [x] 2.4 `start_investigation` tool in `src/tools/actions/` (it creates state, so it belongs with the action tools): surface arg, optional thread ref + subject, DM path works without configured channel, returns main-thread permalink on success OR an explicit `channelNotConfigured` signal when `surface: "channel"` and no channel is configured (so Claude tells the requester); register enabled-gated for all roles; unit tests incl. the unconfigured-channel signal
- [x] 2.5 Cycle guard shared by reaction handler and tools: reject threads in the investigations channel; unit test

## 3. Follow Pipeline (events, classifier, drain)

- [x] 3.1 Event routing: tee step at the channel-message handler registration (`src/slack/app.ts`, the same `message`/`message.channels`/`message.groups` path that feeds `src/slack/handlers/autoRespond.ts`) matching `(channel, thread_ts)` against the open-investigations index; non-destructive (auto-respond/mention/stop unaffected, same order); bot-message filter (`bot_id` present or `subtype: "bot_message"`); guard test asserting both pipelines fire on a followed+engaged thread
- [x] 3.2 `runInvestigationPreAnalysis` in `src/claude/preAnalysis.ts`: subject-keyed prompt, verdicts `respond|skip`, reuses `runClassifierQuery` scaffolding; unit tests for prompt selection and verdict parsing
- [x] 3.3 `followAndInteract` path: classifier per human message → `respond` drives a round (session resume via `sdkSessionId`), `skip` leaves message undrained; concurrent-round guard (reuse active-run append/skip); unit tests
- [x] 3.4 `follow` path: `pendingCount++` persist only, no Claude; unit test asserting zero classifier/query calls
- [x] 3.5 Drain-on-round: pre-turn drain of all followed threads via `conversations.replies(oldest: lastInjectedTs)`, attributed/timestamped injection into round context, cursor advance only on injected content; unit tests for cursor math, batching, and pending-count reset
- [x] 3.6 Boot reconciliation pass in `src/investigations/boot.ts`, registered via `sdk.onDelayedBoot` (fires after `cron.catchUp.delayMinutes`): one sweep of open investigations, classifier for `followAndInteract` threads with undrained messages; unit test for downtime-recovery

## 4. Lifecycle Tools & Delivery Context

- [x] 4.1 `follow_thread` / `unfollow_thread` / `list_followed_threads` / `close_investigation` tools in `src/tools/actions/`, registered (enabled-gated, all roles) only when the session is an open investigation (i.e. its `SessionContext` carries `followedThreads`); cycle guard (`follow_thread` rejects investigations-channel threads) + already-followed rejection; `close_investigation` removes from index (event routing stops immediately) and persists; unit tests per tool + gating behavior
- [x] 4.2 Investigation delivery context in `src/claude/promptBuilder.ts` (separate channel-surface and DM-surface blocks): write-surface statement, read-only followed threads enumerated with modes/pending counts, lifecycle tools named; unit tests asserting the correct block per surface and that pending counts appear when present

## 5. Home Tab

- [x] 5.1 Investigations section in `src/slack/homeTab.ts`: admin-gated, enabled-gated; channel picker (`conversations_select`, public+private, exclude bots) writing to state; unconfigured warning line; open-investigations list (permalink · followed count · starter) with Close buttons
- [x] 5.2 Action handlers for the picker and Close buttons in `src/slack/handlers/` (alongside the existing auto-respond channel-picker handler, registered in `src/slack/app.ts`): the `conversations_select` callback writes the channel to `data/state/investigations.json` via the state module; the Close button routes through the same state mutation as `close_investigation`; unit tests for render gating and actions

## 6. Manifest, i18n, Docs

- [x] 6.1 Conditional scopes/events in `scripts/generate-manifest.ts`: add an `investigations` flag to `getEnabledFeatures`/`ConfigFeatures`, add `channels:join` in `buildScopes` and `message.channels`/`message.groups` in `buildEvents` (deduped against the autoRespond additions) when enabled; manifest test asserting disabled output byte-identical
- [x] 6.2 i18n keys in `src/i18n/strings/en.ts` and `src/i18n/strings/fr.ts`: breadcrumb, DM-continuation parent, owner DM (unconfigured), reactor ephemerals, Home Tab section strings; parity test passes (no EN/FR identity except allowlist)
- [x] 6.3 Docs: (1) config-block description in `src/config.ts`/`configSchemas.ts` with the manifest-reupload + reinstall note (allowPublicSearch precedent); (2) CLAUDE.md architecture blurb (new subsection under Architecture describing the split primitive, two surfaces, follow modes, event routing)

## 7. Verification

- [x] 7.1 Integration test (`*.integration.test.ts`): full flow — react → bootstrap → first round → side message → classifier respond → round with drained delta → close → events stop routing
- [x] 7.2 `npx tsc --noEmit`, `npx oxlint`, `npm test` all green; `openspec validate add-split-investigations --strict`
