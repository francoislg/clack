## 1. Characterization gate (mandatory, gating)

- [ ] 1.1 Create era fixtures (pre-unified-log, first-wave unified-log, modern) + corrupt samples by synthesizing them from the existing `synthesizeMessagesFromLegacy` tests (do NOT rely on real `data/sessions/` files existing — see design Decision 0). Park them as inline test fixtures.
- [ ] 1.2 Add `src/sessions.loader.characterization.test.ts` snapshotting the exact `LoadedSession` each fixture produces today (trigger, messages incl. source canonicalization, defaults) and the quarantine outcome for corrupt files
- [ ] 1.3 Run against current code; confirm green. This is the ship/no-ship gate.

## 2. Era schemas + transforms (build alongside)

- [ ] 2.1 Define `modernZod` (`trigger + messages`), `firstWaveZod` (`messages[]` with `source:"initial"`), `preUnifiedZod` (`originalQuestion`/`refinements`/`lastAnswer`/`lastResponse`/`toolCallHistory`), each `.transform()`ing to the canonical `LoadedSession`
- [ ] 2.2 Encode the synthesis in the transforms: trigger reconstruction, source canonicalization (`initial`/`refinement` → `reply`/`choice`/`followup`), trigger-type normalization (`threadReply`→`autoRespond`, missing reaction emoji), defaults (`errors`/`threadContext`/`autoResponseActive`)
- [ ] 2.3 Compose `z.union([...])` with discrimination/order mirroring the current precedence (modern wins); unit-test each variant against the era fixtures

## 3. Cut over the load path

- [ ] 3.1 ONLY after the §2 schemas pass the gate alongside the old code: replace `synthesizeMessagesFromLegacy` + the second-pass shape check with `sessionUnion.safeParse(json)`; on failure run the existing quarantine branch verbatim. (Do not delete the old synthesis until 3.2 confirms parity — keep it reachable for revert.)
- [ ] 3.2 Re-run the characterization gate; confirm byte-for-byte parity across all eras + corrupt cases. If it cannot pass, STOP and revert (per design Decision 3)

## 4. Reuse the schema in query tools (DRY)

- [ ] 4.1 Export the modern session-context schema from `sessions.ts`; replace the hand-rolled `loadSession` `typeof` guards in `src/tools/query/findRecentInteractions.ts` and `src/tools/query/findSessionTranscript.ts` with a `safeParse` against it, preserving each tool's current return-null-on-bad-data behavior
- [ ] 4.2 Confirm both tools' existing tests stay green (they assert the null-on-corrupt path)

## 5. Green gate

- [ ] 5.1 `npx tsc` clean
- [ ] 5.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [ ] 5.3 `npm test` (vitest) green — characterization gate + existing session + query-tool tests
- [ ] 5.4 `graphify update .` (coordinate timing with concurrent sessions before staging `graphify-out/`)
