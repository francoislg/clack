## Why

Two connected gaps in the trivia cascade surfaced during exploration:

1. **Per-slot axis overrides silently drop for game-format slots.** A game can define a multi-slot `format`, and its per-slot `categories`/`label` ARE honored (resolution reads the *effective* format = `season.format ?? game.format`) and so are its per-slot `liveAnswersVisible`/`revealResponses` (`post_questions` reads `slotFromSeason ?? slotFromGame`). But the **generation axes** (`answersFormat`, `promptMedium`, `difficulty`, `hint`, …) read the slot tier from `currentSeason.format` ONLY — so a game-format slot's axis overrides are ignored with no error. This is an accident of which resolver read which format, not a deliberate choice. The recent cascade-registry refactor centralized *resolution* but left `CascadeContext.slot` hand-built at three call sites with two different policies — the same drift class the registry was meant to kill, moved up one layer.

2. **Cascade shadowing is invisible at write time.** When an admin edits a game field (e.g. `format`) while an active season overrides that field, the season silently shadows the game — the edit has no effect this season and nobody is told why. The data model already supports sparse, game-authoritative seasons (`upsert_season` is omit-to-inherit / null-to-clear, and the instruction already tells Claude to omit `categories` and inherit from the game). But that principle isn't generalized to all axes/format, and nothing detects shadowing or steers Claude to prefer the game tier.

## What Changes

- **Centralize `CascadeContext` construction** into one helper so `get_ideas`, `post_questions`, and `explain_cascade` build the slot tier identically. The slot tier resolves from the **effective format** (`season.format ?? game.format`), so game-format slot axis overrides are honored — matching how categories and post-time axes already behave. **BREAKING (intended):** a game-format slot that sets axis overrides will now take effect where it previously did nothing; deployments with such config (rare — it was a silent no-op) see new behavior. Season-format behavior is unchanged.
- **Shadowing detection on `upsert_game`.** After a game write, the tool surfaces which written fields are currently masked by a higher-precedence tier — the active season, or (for a game with its own `format`) a per-slot override that shadows the game's top-level value: `shadowedBy: { tier: "season" | "slot", slug?, fields: string[] }`, computed via the cascade resolver. Claude uses this to tell the admin their edit won't take effect and to offer to apply it to the current season too.
- **"Apply to the current season too?" flow.** When the admin confirms, the season override is **cleared** (`upsert_season(slug, { field: null })`) so it falls through to the new game value — keeping the season sparse — rather than copying the value into the season.
- **Game-authoritative write guidance.** The admin instruction generalizes the existing "omit categories, inherit from game" principle to ALL axes and `format`: default every edit to the game tier; write a season override ONLY when the admin explicitly scopes a change to *this season*. Clack almost never writes the season unprompted.
- No change to resolution precedence, axis membership, or the season-wins-when-present format model.

## Capabilities

### Modified Capabilities
- `trivia-games`: per-slot axis overrides resolve from the effective format (game-format slots honored); `upsert_game` surfaces season shadowing; admin guidance defaults writes to the game tier.
- `trivia-seasons`: the "apply to current season" path clears the season override (sparse) rather than copying; the write philosophy is generalized to all axes + format.

## Impact

- **Code**: a new shared context-builder (`buildCascadeContext`) in the trivia plugin's cascade layer; `get_ideas`, `post_questions`, `explain_cascade` repoint to it. `upsert_game` gains a post-write shadowing check using `resolveCascade`. The admin instruction (`TRIVIA_GAMES_ADMIN_INSTRUCTION` / management instruction) gains game-authoritative guidance.
- **Behavior**: game-format slots gain axis-override effect (intended). Existing season-driven games are byte-for-byte unchanged. Characterization tests must confirm season-format and no-format paths are identical before/after.
- **Risk**: the slot-policy change is the only behavior shift — guard it with characterization tests over (season-format / game-format / no-format) × (overrides at each tier).

## Open Questions

- **Slot precedence when BOTH formats exist.** Today `season.format` fully replaces `game.format` (season wins wholesale). Keep that (slot tier = effective format, single source) — OR introduce a true 6-tier `season-slot → game-slot → …` chain? The latter raises "slot indices differ between formats" ambiguity. Leaning: keep the effective-format model (simplest, matches `resolveEffectiveFormat`).
- **Shadowing check: tool-surfaced vs instruction-only.** Tool-surfaced (deterministic `shadowedBy` in the response) is more reliable than relying on Claude to call `explain_cascade` post-write. Leaning tool-surfaced for detection + instruction for the conversation.
