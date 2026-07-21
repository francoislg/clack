## 0. De-risk before building

- [~] 0.1 Probe a real workspace: call `assistant.search.context` with `disable_semantic_search: true` and query `:bob:`, confirm the literal shortcode survives tokenization and matches message text containing it. Record the finding in design.md's Open Questions. **BLOCKED — needs a live bot token with the scope granted; deferred to 7.3.**
- [x] 0.2 Confirm the `action_token` field name and its location on the `message.im` and `app_mention` payloads as Bolt surfaces them; note whether Bolt's TypeScript types include it or an assertion is required.
- [x] 0.3 Decide and record whether the degraded tool shape appears in worker mode or is omitted there (design.md Open Question 2).

## 1. Config flag

- [x] 1.1 Add `allowPublicSearch` as an optional boolean to the fail-fast config zod schema in `src/configSchemas.ts`, beside `allowScheduledMessages`.
- [x] 1.2 Unit-test the schema: absent → `false`, `true` → `true`, non-boolean → formatted zod error.

## 2. Manifest generation

- [x] 2.1 Add `publicSearch: boolean` to `ConfigFeatures` and read `config.allowPublicSearch ?? false` in `getEnabledFeatures()` (`scripts/generate-manifest.ts`).
- [x] 2.2 Push `search:read.public` in `buildScopes()` when the feature is on, following the `mentions → app_mentions:read` pattern. Do not touch `CORE_SCOPES` or `buildEvents()`.
- [x] 2.3 Add manifest tests: scope present when enabled, absent when disabled/absent, and `bot_events` byte-identical across both.

## 3. action_token capture and threading

- [x] 3.1 Extract the `action_token` from `message`/`app_mention` payloads in `src/slack/handlers/` and carry it into session construction.
- [x] 3.2 Add the token to the tool context built in `src/tools/context.ts` as an optional field.
- [x] 3.3 Verify the token is not written to `data/sessions/` — add a persistence test asserting its absence from the serialized record.

## 4. search_messages tool

- [x] 4.1 Create the tool in `src/tools/query/`, calling `assistant.search.context` with fixed `disable_semantic_search: true`, `channel_types: "public_channel"`, `content_types: "messages"`.
- [x] 4.2 Map the Slack response to a Claude-facing result carrying message text, author, timestamp, and permalink; cap results per call and signal truncation.
- [x] 4.3 Handle `missing_scope` distinctly — return an error result naming the scope and the reinstall requirement, never an empty result set.
- [x] 4.4 Write the tool description: literal (non-semantic) matching, public channels only, supported Slack operators, the reaction-vs-text limit, and guidance to narrow with operators rather than paginate.
- [x] 4.5 Unit-test with the Slack client mocked at the boundary: fixed arguments asserted, operator pass-through, empty results, truncation, `missing_scope`.

## 5. Registration and gating

- [x] 5.1 Register `search_messages` in `src/tools/server.ts` only when `allowPublicSearch` is enabled, at the `member` role tier.
- [x] 5.2 Implement the degraded shape for sessions without an `action_token`: omit the `query` parameter and lead the description with the unavailability statement plus the supported triggers.
- [x] 5.3 Make the degraded tool return an error result naming direct messages and @mentions, making no Slack API call.
- [x] 5.4 Test gating across the matrix: flag off (absent entirely), flag on + token (full shape), flag on + no token (degraded shape), and the degraded invocation path.

## 6. Documentation

- [x] 6.1 Document `allowPublicSearch` in the config reference, stating prominently that enabling it requires re-uploading the manifest **and reinstalling the app to the workspace**.
- [x] 6.2 Note the trigger-mode limitation (no search from reactions or cron) and the reaction-vs-text boundary alongside the emoji-lore docs, so the two evidence paths are described together.
- [x] 6.3 Add a CLAUDE.md line covering the flag, the reinstall requirement, and the `action_token` dependency.

## 7. Verification

- [x] 7.1 `npx tsc`, `npx oxlint`, `npx oxfmt --check` clean on all touched files.
- [x] 7.2 `npm test` green.
- [~] 7.3 Manual end-to-end against a real workspace: enable the flag, regenerate the manifest, reinstall, then search for a known keyword from a DM and from an @mention; confirm a reaction-triggered session shows the degraded tool. **BLOCKED — needs a live workspace + reinstall; carries the still-open `:bob:` tokenization probe (0.1).**
- [x] 7.4 Run `graphify update .` and commit the regenerated graph alongside the code.
