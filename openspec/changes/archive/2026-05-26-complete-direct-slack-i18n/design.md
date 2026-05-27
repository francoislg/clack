## Context

Clack already ships a mature i18n system: a typed core `t(key, vars?)` helper (`src/i18n/t.ts`) backed by `en.ts`/`fr.ts` dictionaries with a parity test, a per-prompt LANGUAGE directive that makes Claude's `submit_response` output render in the configured language, and a plugin-side `sdk.t()` + `sdk.registerDictionary()` path (plugins cannot import core i18n per `src/plugins/CLAUDE.md`). Home Tab is ~fully migrated (199 `t()` calls).

Despite that, French users still see English in places. An audit classified the leaks into three modes:
- **Mode A — hardcoded:** string never goes through `t()`/`sdk.t()`. ~17 core handler/messagesApi strings, 4 trivia strings, 1 tool prefix.
- **Mode B — fake translation:** key is wired through `t()` but the FR value equals the EN value (`Auto-Respond`). Invisible to "is it wrapped in `t()`?" audits.
- **Mode C — interpolated literal:** `Working on ${branch}` built with a template string, never keyed.

The audit also confirmed the architectural reason most *tool* strings should stay English: `textResult`/`errorResult` (`src/tools/helpers.ts`) return MCP envelopes consumed by **Claude**, which re-renders them under the LANGUAGE directive. Translating those is redundant and Claude reasons best in English.

## Goals / Non-Goals

**Goals:**
- Define a durable, spec-level boundary: localize everything on the DIRECT-to-Slack path; leave VIA-CLAUDE tool results English.
- Close the known Mode A / B / C leaks across core and the trivia plugin.
- Add a guard that makes Mode B (fake translations) fail the build going forward.
- Preserve byte-identical behavior when `language` is absent or `"en"`.

**Non-Goals:**
- Translating `textResult`/`errorResult` tool-result text (VIA-CLAUDE — out of scope by decision).
- Translating Claude-facing prompt instructions (e.g. `scheduledPrompts.ts`) or tool descriptions.
- Adding new supported languages beyond `en`/`fr`.
- Re-translating Home Tab structure (already migrated) beyond fixing FR==EN content.

## Decisions

**D1 — Boundary is the delivery path, not the file.** Replace the `CLAUDE.md` rule "tool strings stay English" with: *a string is translatable iff it reaches Slack without passing back through Claude's `submit_response`.* This correctly captures that a handler's ephemeral notice is translatable while a tool's `errorResult` is not, regardless of which directory it lives in. Alternative considered: "translate all tool strings" — rejected; it's redundant (Claude re-renders) and degrades Claude's reasoning.

**D2 — Mode B guard lives in the parity test with an allowlist.** Extend the existing parity test: for every key, assert `fr[k] !== en[k]` unless `k` is in an explicit `IDENTICAL_OK` allowlist. The allowlist holds legitimately-identical entries (brand names like `Slack`/`GitHub`, emoji-only values, pure-`{var}` templates). Rationale: a denylist of "must translate" would rot; an allowlist forces a conscious decision each time someone wants EN==FR and keeps the default safe. Alternative: heuristic detection (ignore strings < N chars, etc.) — rejected as too fuzzy; explicit allowlist is auditable.

**D3 — Core leaks use `t()`; trivia leaks use `sdk.t()`.** Core handlers/streaming/messagesApi can `import { t }` directly. Trivia already has `src/plugins/trivia/i18n/strings.ts` + a registered dictionary, so its 4 strings move into that dictionary and call the plugin's `t()`/`sdk.t()`. No SDK changes needed — the isolation problem was already solved by the prior `plugin-i18n-and-multilingual-judge` change.

**D4 — Interpolation for Mode C.** `Working on ${branch}` becomes `t("streamer.working_on", { branch })`; the helper already supports `{var}` placeholders and the parity test already enforces placeholder-token parity, so FR must keep `{branch}`.

**D5 — Key namespacing.** New core keys follow existing prefixes: `home.*` (already present), plus `changes.*` / `dm.*` / `errors.*` / `streamer.*` for handler/streaming notices. This keeps the dictionary navigable and lets the parity test group failures sensibly.

## Risks / Trade-offs

- **Mode B guard flags pre-existing intentional duplicates** → seed the allowlist from a one-time scan of current FR==EN keys, reviewing each so only genuine brand/emoji/var entries are allowlisted and the rest get real translations.
- **Over-translation of an actually-VIA-CLAUDE string** (translating something Claude also re-renders, causing double-French or drift) → the spec's boundary definition is the guardrail; when unsure, trace whether the string hits `chat.postMessage`/Block Kit directly (DIRECT) or returns via `textResult`/`errorResult` (VIA-CLAUDE).
- **French copy quality** → keep idiomatic, not literal; reuse terminology already established in the existing FR dictionary (e.g. existing `home.auto_respond.*` body strings already use "auto-respond" descriptively — align the header term with them).
- **Missed leaks** → the FR==EN guard plus the existing key/placeholder parity test form a recurring safety net; future leaks of Mode B surface automatically. Mode A/C remain review-time concerns (noted in `CLAUDE.md`).

## Migration Plan

Pure additive code change, no data migration. Deploy is a normal build. Rollback = revert; since all new keys carry their original English as the EN value, reverting cannot change EN-mode output. The only build-time gate is the extended parity test (will fail until the seeded allowlist + real FR values are in place — that's intentional and resolved within this change).

## Open Questions

- None blocking. The three scope decisions (DIRECT-only, translate `Auto-Respond`, add the guard) are settled.
