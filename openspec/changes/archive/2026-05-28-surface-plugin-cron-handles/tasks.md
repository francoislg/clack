## 1. Pre-flight verification

- [x] 1.1 Grep the repo for any internal caller passing `all: true` to `list_scheduled_messages` (outside the tool's own definition and its tests). Confirm zero callers, OR list them so they can be updated in the same PR.
- [x] 1.2 Verify the plugin SDK exposes a way to query "plugin-owned cron jobs by `(plugin, specKey)`" or the broader "all plugin-owned jobs for this plugin". If not, add a thin SDK method (e.g., `sdk.findCronJobs({plugin})` returning `CronJob[]`) that wraps `findByPluginOwner(ownerKey)` from `src/cronJobs.ts` — per the plugin hard rule (`src/plugins/CLAUDE.md`), trivia code must not import `src/cronJobs.ts` directly.

## 2. Core: `list_scheduled_messages` scope reshape

- [x] 2.1 In `src/tools/query/listScheduledMessages.ts`, rename the `all` zod field to `includeOtherUsers` with the same admin-only semantics. Update the description string to reflect (a) the new default scope (caller + plugin-managed) and (b) that filters always apply within scope.
- [x] 2.2 Replace the dataset-selection branch. New shape: start from `getJobs()`, then narrow by scope. Default scope = `{j | j.createdBy === ctx.userId || (j.pluginManaged === true && j.createdBy === null)}`. When `includeOtherUsers === true && isAdmin`, scope = all jobs. Non-admins passing `includeOtherUsers: true` silently fall through to default scope (no error).
- [x] 2.3 Confirm the `channel` and `plugin` filters are applied AFTER scope resolution unchanged — they should already be order-independent post-refactor, but re-read to verify.
- [x] 2.4 Add unit tests in `src/tools/query/listScheduledMessages.test.ts` covering: default scope returns caller + plugin-managed (not other users'); `plugin: "trivia"` returns trivia plugin jobs for a non-admin; `includeOtherUsers: true` from admin adds other users' jobs; `includeOtherUsers: true` from non-admin is a silent no-op.
- [x] 2.5 Remove or update any existing test that asserts `all: true` semantics — migrate to `includeOtherUsers: true`.

## 3. Trivia: `list_games` exposes cron job UUIDs

- [x] 3.1 In `src/plugins/trivia/tools/games/listGames.ts`, accept an injected (or default) "find cron jobs" function sourced from the SDK helper from task 1.2. Make it constructor-style so tests can stub it.
- [x] 3.2 At the top of the tool handler, fetch all trivia plugin-managed jobs once and build a `Map<specKey, jobId>` index. Per the design's batching note, never call N×3 lookups.
- [x] 3.3 Per-entry: lookup `${game.name}:question`, `${game.name}:reveal`, and (when `prepCron` is set) `${game.name}:prep` in the index. Spread the resulting `questionJobId` / `revealJobId` / `prepJobId` onto the entry IF AND ONLY IF the lookup resolved a UUID.
- [x] 3.4 Update the `ListGamesEntry` interface to declare the three optional ID fields.
- [x] 3.5 Update the tool description (`DESCRIPTION` constant) to mention that the response now includes job UUIDs for use with `run_scheduled_message_now`.
- [x] 3.6 Add unit tests in `src/plugins/trivia/tools/games/listGames.test.ts` covering: question + reveal IDs surface for a game with two slots; prep ID surfaces when `prepCron` is set; IDs omitted when the lookup returns nothing (e.g., pre-reconcile state); disabled-but-registered games surface IDs when `includeDisabled: true`.

## 4. Wire-up + validation

- [x] 4.1 If task 1.2 added a new SDK method, register it in `src/plugins/sdk.ts` and update the SDK type definitions.
- [x] 4.2 Run `npx tsc` to verify type correctness.
- [x] 4.3 Run `npm test` to ensure existing tests still pass and the new tests are green.
- [x] 4.4 Run `npx oxlint src/tools/query/listScheduledMessages.ts src/plugins/trivia/tools/games/listGames.ts` and fix any lint issues.
- [x] 4.5 Run `npx oxfmt src/tools/query/listScheduledMessages.ts src/plugins/trivia/tools/games/listGames.ts` to format.

## 5. Manual verification

- [x] 5.1 Boot the bot locally with at least one trivia game configured (ideally one with `prepCron` set).
- [x] 5.2 In a DM, ask Claude to "list the trivia games". Confirm the response includes `questionJobId`, `revealJobId`, and `prepJobId` for the relevant game(s).
- [x] 5.3 In a DM, ask Claude to "list all plugin-managed scheduled messages". Confirm `list_scheduled_messages` returns the trivia jobs without requiring `all: true` (the flag no longer exists).
- [x] 5.4 As an admin, ask Claude to run the prep job using the surfaced `prepJobId`. Confirm the run fires and the result includes `expectedSkip: true` per the existing `run_scheduled_message_now` contract.
- [x] 5.5 As a non-admin user, confirm the default `list_scheduled_messages` shows plugin-managed jobs but `run_scheduled_message_now({id: <plugin-job-id>})` is denied per the existing Pattern A gate.

## 6. Spec validation

- [x] 6.1 Run `openspec validate surface-plugin-cron-handles --strict` and resolve any reported issues before marking the change ready for archive.
