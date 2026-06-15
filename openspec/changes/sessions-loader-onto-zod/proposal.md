## Why

`src/sessions.ts` is the gnarliest validation surface in the codebase and was deliberately excluded from `persisted-state-loaders-onto-zod`. Its load path accepts **three distinct on-disk eras** (pre-unified-log, first-wave unified-log, current `trigger + messages`) and runs ~95 lines of `synthesizeMessagesFromLegacy` (~374–469) reconstructing triggers/messages from legacy fields, canonicalizing user-message sources (`"initial"`/`"refinement"` → `"reply"`/`"choice"`/`"followup"`), normalizing trigger types (`threadReply` → `autoRespond`, missing reaction emoji), and defaulting `errors`/`threadContext`/`autoResponseActive`. It degrades gracefully (log + quarantine corrupt files).

This is the **optional, gated Change 4** of the sweep — isolated because the synthesis is fragile and high-risk; bundling it with the clean loaders (Change 3) would endanger restore-from-disk for real saved sessions. Only worth doing for the consistency payoff, and only behind a strong characterization gate.

## What Changes

- Model the three on-disk shapes as a zod input union, with `.transform()` chains performing the legacy→modern synthesis (trigger reconstruction, source canonicalization, trigger-type normalization, defaults).
- Replace the imperative `synthesizeMessagesFromLegacy` + second-pass shape check with `schema.safeParse()` → on success the transform yields the modern shape; on failure, log + quarantine exactly as today.
- Reuse `src/plugins/zodResult.ts` for any error formatting; preserve the corrupt-file quarantine path verbatim.
- Two query tools, `src/tools/query/findRecentInteractions.ts` and `src/tools/query/findSessionTranscript.ts`, independently re-parse the same on-disk session-context shape with their own `typeof` guards (`loadSession`). Export the session-context zod schema from `sessions.ts` and have both tools reuse it, so the on-disk shape has exactly one validator (DRY). These read the modern shape only — they need not re-derive the legacy synthesis.

## Capabilities

### Modified Capabilities

- `session-management` / `worker-session-restore`: session load/synthesis is schema-driven; ALL three legacy shapes still parse to the identical modern structure, byte-for-byte.

## Impact

- Code: `src/sessions.ts` load path; `src/tools/query/findRecentInteractions.ts` + `findSessionTranscript.ts` repointed to the exported session-context schema.
- Risk: HIGHEST in the sweep. Easy to drop an edge case (missing reaction emoji, `initial`/`refinement` source remap, `threadReply`→`autoRespond`). Gate: a characterization test over real fixtures from each era must pass unchanged BEFORE and after — written first, same as Change 1's gate. If parity can't be proven, do not ship; leave the hand-rolled synthesis in place.
- Depends on: `collapse-trivia-config-validation-onto-zod` (for `src/zodResult.ts`); sequenced after `persisted-state-loaders-onto-zod`. OPTIONAL — may be dropped if risk outweighs the consistency benefit. Stub proposal — `design`/`tasks` to be written only if the team commits to it.
