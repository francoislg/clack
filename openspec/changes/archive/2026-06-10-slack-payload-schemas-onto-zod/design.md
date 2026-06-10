## Context

Slack sends interaction payloads as strings: button `action.value` (we encode JSON into it) and modal `view.private_metadata` (JSON) + `view.state.values` (nested block/action map). Today these are decoded by hand. `blocks.ts` owns the button wire format end-to-end — `encodeActionValue` (~75) writes `{ s, r, v, p, h, w, c, t, sn }`, and `decodeActionValue` (~125) reads it back with `tryParseEncodedActionValue` + nine inline `typeof` checks, falling back to `{ sessionId: rawValue }` for non-encoded strings. The Home Tab modals parse `private_metadata` separately: `homeTab.ts` with blind `as` casts, `userSkillsHomeActions.ts` with manual guards.

## Goals / Non-Goals

**Goals:**

- One `EncodedActionValue` zod schema, co-located with `encodeActionValue`/`decodeActionValue`, as the single definition of the button wire shape. `decodeActionValue` parses through it.
- Modal `private_metadata` and the `view.state` read helpers validated by schema instead of blind casts / manual `typeof`.
- Zero observable change: identical decode results, identical fallbacks, identical graceful no-ops.

**Non-Goals:**

- Changing the wire format, field names, or any handler's behavior.
- Touching the per-handler `as { value: string }` extraction casts (they just hand the raw string to the decoder).
- Persisted-state or config loaders (other changes).

## Decisions

### Decision 1: Schema lives next to encode/decode in `blocks.ts`

`encodeActionValue` and `decodeActionValue` are a matched pair in `blocks.ts`; the `EncodedActionValue` schema belongs beside them so the wire shape has exactly one home. `decodeActionValue` becomes: `const obj = EncodedActionValue.safeParse(JSON.parse(value))` (guarded by try/catch for non-JSON) `→` on success map fields, `→` on failure return `{ sessionId: value }` (the existing non-encoded fallback). All fields stay `.optional()` (the wire shape is partial by construction), so the schema never rejects a real encoded value.

### Decision 2: Preserve the exact decode contract

`decodeActionValue`'s return object and its `{ sessionId: value }` fallback are a wide contract — many handlers read `sessionId`/`ref`/`choiceValue`/etc. The migration is a pure internal refactor: same inputs → same output object. The existing `blocks` test (and handler tests that round-trip encode→decode) are the parity gate.

### Decision 3: Per-modal `private_metadata` schemas, graceful where the code is graceful

`homeTab.ts` currently throws on a bad `JSON.parse` and blind-casts the shape — keep the same surface (parse failure → existing error path), just `safeParse` the shape. `userSkillsHomeActions.ts` returns `null`/`false` on any miss — keep that exact graceful behavior with `safeParse` + the existing fallback. Do not make one stricter/looser than it is today.

## Risks / Trade-offs

- **Wide decode contract** → a subtle field-mapping change would silently break button handlers (e.g. lose `targetChannel`). Mitigation: keep the field mapping line-for-line equivalent; gate with encode→decode round-trip tests across all `Action` types.
- **Low payoff** → this is the optional tail of the sweep; the centralized decoder is already defensive, so the win is consistency + one fewer hand-rolled guard, not a correctness fix. Sequence it last.
