## Why

The 2026-06-09 zod re-inventory (`zod-inventory.md`) found one more cluster of hand-rolled validation, just outside the "configuration / MCP tools" scope: **Slack interaction payloads**. Button `action.value` and modal `private_metadata` / `view.state` are decoded by hand. The 9+ `(body.actions[0] as { value: string }).value` casts scattered across `slack/handlers/*` are only raw-string extraction — the *actual* validation is centralized in `src/slack/blocks.ts` (`tryParseEncodedActionValue` + `decodeActionValue`, ~112–151), which `JSON.parse`es the wire value and then field-by-field `typeof`-checks an 9-field `EncodedActionValue`. Two modal flows do their own thing: `slack/handlers/homeTab.ts` (`JSON.parse(view.private_metadata) as { dir; filename }`, ~575/619 — blind cast) and `slack/handlers/userSkillsHomeActions.ts` (`parseSlugMetadata` / `readInputValue` — manual `typeof` guards on `view.state.values`).

This is the **optional Change 6 of the sweep** — lower priority than the config/state loaders (these payloads are ephemeral, not persisted, and the centralized decoder is already defensive). Worth doing for one clean win: a single `EncodedActionValue` schema replaces the per-field decode, and the modal metadata gets a real shape check instead of a blind cast.

## What Changes

- Define an `EncodedActionValue` zod schema (the `{ s, r, v, p, h, w, c, t, sn }` wire shape) and use it inside `decodeActionValue` to replace `tryParseEncodedActionValue` + the nine inline `typeof obj.x === "string"` field reads. The public `decodeActionValue` return shape and its `{ sessionId: value }` fallback (non-encoded values) are unchanged.
- Replace the blind `JSON.parse(view.private_metadata) as { … }` casts in `homeTab.ts` with `safeParse` against small per-modal `private_metadata` schemas (`{ dir; filename }`, `{ dir }`), preserving today's behavior (parse error → existing error path).
- Replace the manual `typeof` guards in `userSkillsHomeActions.ts` (`parseSlugMetadata`, `readInputValue`, `readCheckboxChecked`) with zod schemas for the modal `private_metadata` and the read helpers, keeping their graceful `null`/`false` returns.
- The button-value `as { value: string }` casts in the handlers stay as-is (raw extraction); they feed the now-schema-backed `decodeActionValue`.
- Reuse `src/plugins/zodResult.ts` only if a formatted error is logged; most paths stay silent/graceful as today.

## Capabilities

### Modified Capabilities

- `home-tab`: modal `private_metadata` and `view.state` reads are schema-driven (Home Tab config-file and user-skill modals), preserving current behavior.

### Added Capabilities

- `slack-action-values`: the encoded button-value wire format gains a single zod schema shared by encode/decode, replacing the hand-rolled per-field decode.

## Impact

- Code: `src/slack/blocks.ts`, `src/slack/handlers/homeTab.ts`, `src/slack/handlers/userSkillsHomeActions.ts`.
- Risk: LOW — payloads are ephemeral (a bad decode just falls back / no-ops, never corrupts persisted state). Main care: `decodeActionValue`'s exact return shape and the non-encoded `{ sessionId: value }` fallback must be byte-identical (many handlers depend on it). Gate with the existing `blocks` tests + handler tests.
- Out of scope: the per-handler `as { value: string }` extraction casts (mitigated by the schema-backed decoder); anything persisted (Changes 2–5); migrations; external APIs.
- Depends on: `collapse-trivia-config-validation-onto-zod` (for `src/plugins/zodResult.ts`). Independent of Changes 2/4/5 — can land any time.
