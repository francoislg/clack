## 1. Gate

- [x] 1.1 Confirm the existing `blocks` test is green; ensure it (or a new case) round-trips `encodeActionValue` → `decodeActionValue` for every `Action` type and asserts the non-encoded `{ sessionId: value }` fallback — this is the parity gate
- [x] 1.2 Confirm the `homeTab` / `userSkillsHomeActions` modal tests cover the bad-metadata paths; add a case if a graceful `null`/`false` path is untested

## 2. Action-value schema

- [x] 2.1 Define `EncodedActionValue` zod schema (`{ s, r, v, p, h, w, c, t, sn }`, all `.optional()`) beside `encodeActionValue` in `blocks.ts`
- [x] 2.2 Reimplement `decodeActionValue` to `safeParse` through it (try/catch for non-JSON); map fields line-for-line; keep the `{ sessionId: value }` fallback. Remove `tryParseEncodedActionValue`

## 3. Modal payload schemas

- [x] 3.1 `homeTab.ts` — replace the two `JSON.parse(view.private_metadata) as { … }` casts with `safeParse` against `{ dir; filename }` / `{ dir }` schemas; keep the existing error path on failure
- [x] 3.2 `userSkillsHomeActions.ts` — replace `parseSlugMetadata` / `readInputValue` / `readCheckboxChecked` manual `typeof` guards with zod schemas; preserve the `null`/`false` graceful returns

## 4. Green gate

- [x] 4.1 `npx tsc` clean
- [x] 4.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [x] 4.3 `npm test` (vitest) green — `blocks` round-trip + Home Tab modal tests
- [ ] 4.4 `graphify update .` (coordinate timing with concurrent sessions before staging `graphify-out/`)
