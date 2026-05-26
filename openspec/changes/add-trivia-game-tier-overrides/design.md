## Context

The trivia plugin already supports a per-game cascade tier for six axes (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`). The cascade convention — `slot → season → game → workspace → built-in default` — is uniform across these axes and is consulted by `get_ideas`, `save_question`, and other tools.

Three season-level fields still have no game-tier counterpart:

- `format` (`SeasonFormat` — the slot composition, with up to N slots and per-slot constraints)
- `categories` (`string[]` — the active question category pool)
- `theme` (`string` — narrative label used in opener and finale prompts)

Adding per-game tiers for these three closes the gap and matches the convention. None of the changes require a data migration: all three fields are optional opt-ins on `TriviaGame`.

## Goals / Non-Goals

**Goals:**

- Per-game `format`, `categories`, `theme` cascade tiers wired into the same resolution paths as the existing axes.
- Validation reuse — leverage `validateFormat` and the existing season-tier validators rather than parallel implementations.
- `list_games` surfaces the three fields when set, so admins can audit per-game configuration without reading `config.json`.
- Zero behavior change for existing deployments — every default remains the pre-change default.

**Non-Goals:**

- No new MCP tools (existing read tools surface the data; admins edit config by hand for these fields).
- No workspace-tier `format` / `categories` / `theme` (categories already live at the global file tier; format and theme don't make sense workspace-wide).
- No data migration — the change is additive.
- No change to season-level semantics: a season's `format` / `categories` / `theme` still win over a game's via the standard cascade.

## Decisions

### 1. Cascade ordering: season wins over game (existing convention)

The cascade `slot → season → game → workspace` already gives the season higher precedence than the game for every existing axis. We keep that ordering for `format`, `categories`, and `theme`:

- `format`: `season.format → game.format → (single-question fallback)`
- `categories`: `slot.categories → season.categories → game.categories → categories.json`
- `theme`: `season.theme → game.theme → (no theme)`

**Why this and not the inverse:** consistency with the other six axes is more valuable than chasing a different ordering for these three. Admins who want a per-game format that persists through seasons simply don't set a season-level format; admins who want a season override get the existing escape hatch.

### 2. `format` validation reuses `validateFormat`

The validator in `src/plugins/trivia/domain/seasonFormat.ts` already enforces the slot list shape and per-slot constraints. The parser `parseTriviaGames` will call `validateFormat` against the per-game `format` field with the same drop-on-invalid policy already used for `channel` / `cron` fields. This guarantees season-tier and game-tier formats are byte-for-byte identical in their accepted shape.

### 3. `categories` validation: non-empty deduped string list

Mirror the season-level validator (already used by `upsert_season`): non-empty array, dedupe preserving first occurrence, drop empty strings. No additional cross-checks against the global `categories.json` at config-load time — the game's categories are a **subset filter**, not a constraint that the strings must exist globally. (A future tool may want to warn when a game references a category that the global pool doesn't carry, but that's out of scope.)

### 4. `theme` validation: trimmed non-empty string

Same shape as the season-level `theme`. Trim, reject blank-after-trim with a logged warning.

### 5. Format-with-game cascade implications for `save_question`

When a season has no `format` but the game has one, `save_question` enters slot-binding mode using the game's `format`. The error language shifts from "season has no format" to "no active format" because either tier can supply it. The label-snapshot step continues to work — it reads `format.questions[index].label` from whichever tier resolved to provide the format. (See spec delta on `trivia-seasons`.)

### 6. List_games surface area

`list_games` returns each game's `format` / `categories` / `theme` only when set. Absent fields stay absent from the response (matches the existing `workspaceDefaults` semantics for axis fields). This keeps the response shape predictable for downstream callers and surfaces "intentionally unset" cleanly.

### 7. Instruction file updates

`data/default_configuration/admin/topics/trivia:management/*.md` is the source of truth Claude reads for the cascade. We update the cascade documentation there for all three new tiers. The `list_seasons` tool description (set in code at registration time) gains a one-line pointer at `list_games` for the game tier, mirroring the existing cross-reference for the workspace tier.

## Risks / Trade-offs

- **[Operator confusion: which tier wins?]** Adding a third documented tier (season vs game vs workspace) for `format` and `categories` slightly increases cognitive load. **Mitigation:** the cascade is identical to the existing six axes, documented in CLAUDE.md and in the admin instruction file. The `list_games` workspace + per-game readout gives admins a one-shot view to reason about effective behavior.
- **[`theme` semantics aren't strictly cascade-shaped]** Themes are narrative — a per-game theme conceptually overrides "no theme set" rather than being a cascade tier. **Mitigation:** treating it as a two-tier cascade (season > game > absent) is consistent with how absent values already behave in the prompt builder; the tests in `prompts/scheduledPrompts.test.ts` will assert each tier resolves correctly.
- **[Parser drop-on-invalid hides errors]** A typo in a game's `format` silently drops the entry rather than failing loud. **Mitigation:** parser already logs warnings naming the offending index; this is the established convention. A separate config-validation lint tool exists in roadmap discussions but is out of scope here.
- **[Test surface area grows]** Each axis gets 3-4 new cascade tests (game-only, season-overrides-game, slot-overrides-everything, none-set fallback). **Mitigation:** the existing axis-tier tests follow a clear pattern; reuse the same fixtures.

## Migration Plan

No data migration required. Deployment is a single rolling update:

1. Ship the parser, types, and cascade resolver changes (additive — old configs parse identically).
2. Ship the tool changes (`list_games`, `save_question` error language).
3. Ship the prompt and instruction updates.
4. Admins opt in by adding `format` / `categories` / `theme` to specific entries in `config.trivia.games[]`.

Rollback is trivial — revert the deploy; any config entries already set for the three new fields will be ignored by the older parser (existing tolerant-of-unknown-fields behavior).

## Open Questions

- **Worth bothering with per-game `theme` at all?** Themes are mostly used in opener and finale prompts. A reasonable alternative is to drop the `theme` work from this proposal and keep theme as a season-only concept. **Default:** include it (the user asked for it explicitly). If implementation reveals it's mostly redundant, the parser + cascade plumbing is cheap to keep; the prompt-side render is a 5-line conditional.
- **Should `list_games` also expose the *effective* (post-cascade) values?** The current proposal surfaces only the per-game tier as stored. Computing effective values requires knowing which season is active, which is more complex. **Default:** out of scope; `check_season_status` already surfaces season-level data, and admins can compose mentally.
