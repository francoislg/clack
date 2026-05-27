## Context

The trivia plugin already has many cascading axes — `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`, `categories`, `format`, `theme`, `liveAnswersVisible`, `revealResponses` — and the resolver pattern is well-established (one pure resolver per axis under `src/plugins/trivia/domain/`, four tiers `slot → season → game → workspace`, lenient drop-on-invalid at the file-load path, hard reject at the MCP tool path).

What admins keep hitting is the long tail of preferences that don't deserve their own axis — phrasing styles, content avoidances, narrative leans that change every few weeks. Adding a structured axis for every one of these is wasteful; we want a generic guidance slot.

Two distinct user intentions appear when admins reason about guidance:

1. **"Set the rule, and let lower tiers override it if needed."** Workspace says "Be funny and concise." A specific game says "Be sarcastic and dry." On that game, the workspace rule is gone, replaced. This is the same semantics as `theme` and `liveAnswersVisible`.
2. **"Stack rules — workspace baseline always applies, lower tiers add to it."** Workspace says "Avoid offensive content." A season for October says "Halloween theme — favor spooky angles." A specific slot says "Keep this slot short." All three apply at once.

Trying to express both with a single field forces admins to pick one semantics globally, which doesn't match how they actually think about guidance. Two parallel fields with explicit names make the intent obvious at every write site.

## Goals / Non-Goals

**Goals:**

- One axis with replace semantics (`instructions`), one axis with cumulative semantics (`additionalInstructions`), both with the same four-tier cascade as every other trivia axis.
- Surfaces only at the two prompts that compose user-facing copy: question generation (`get_ideas`) and reveal (`process_reveal_answers`).
- Mirror the existing `theme` pipeline end-to-end so the implementation pattern is boring and reviewable.
- Backward compatible — absence at every tier returns `null` from the resolver and the consumer prompts ignore the field.

**Non-Goals:**

- Injecting these strings into bot-wide context, trivia topic instructions, opener/finale prompts, or any scheduled prompt other than question generation and reveal. Out of scope.
- Templating, interpolation, or variable substitution inside the strings. They're free-form text passed through verbatim.
- Localization. These are admin-authored guidance; admins write them in the language they want Claude to honor.
- A length cap. Admins are trusted; if they paste a 10 KB block they get what they asked for.
- Splitting the cumulative concatenation by tier in the response payload. The resolver returns a single labeled string; consumers don't need structured access to per-tier values (and `list_games` / `list_seasons` already surface per-tier values for debugging).

## Decisions

### One labeled concatenated string vs structured per-tier object

`resolveAdditionalInstructions` returns a single `string | null`. When multiple tiers carry guidance, the resolver joins their values with `\n\n` and prefixes each segment with a short tier label:

```
[Workspace] Avoid political content.

[Game] Keep questions short.

[Season] Halloween theme — favor spooky angles where natural.

[Slot 2] Make this one easy.
```

Alternative considered: return `{ workspace?: string; game?: string; season?: string; slot?: string }` and let each consumer prompt render its own format. Rejected because:

- Both consumers (question prompt + reveal prompt) want the same rendering — duplicating the join logic in two prompts is worse than a single resolver helper.
- Admin debug clarity already lives at `list_games` / `list_seasons`, which surface the per-tier raw values. The resolver output is for Claude consumption only.
- A flat string is the same shape as `theme`, so existing prompt copy patterns transfer 1:1.

### Tier labels on `additionalInstructions` but not on `instructions`

`instructions` returns a single winning tier's value — no labeling needed, the consumer gets one string. `additionalInstructions` returns a concatenation across multiple tiers and Claude benefits from knowing *which tier* a given rule came from (so it can reason about specificity: a slot-level rule is more situational than a workspace-level rule).

### Slot label index

When the active session has a multi-slot format, the slot tier label includes the slot index (`[Slot 0]`, `[Slot 1]`, …) rather than the slot's optional `label` string. Reasoning: the slot label is admin-facing display copy and may be empty; the index is always present and stable. Claude doesn't need the human label for guidance interpretation.

### Cascade order in the cumulative output

Broadest first, narrowest last (`workspace → game → season → slot`). Rationale: humans read top-to-bottom; the most general framing comes first, situational specifics come last. This also matches the order admins would naturally articulate ("the workspace rule is X; then for this game we additionally ask Y; in this season Z").

### Normalization

Both fields are trimmed; empty / whitespace-only values are dropped on the file-load path (with an issue logged) and rejected on the MCP tool path (matches the existing `normalizeTheme` policy exactly). The resolver treats only post-trim non-empty strings as "set" — an empty string at a tier is indistinguishable from absent.

### Where to inject

Only `get_ideas` and `process_reveal_answers`. Both already resolve other cascading axes against the same `(season, slot, game, config)` tuple, so adding `resolveInstructions(...)` and `resolveAdditionalInstructions(...)` calls is structurally identical to the existing `resolveTheme(...)` call site. The fields land on the tool response payload next to `theme`.

### Why not extend `theme` to be cumulative

`theme` is a narrative label surfaced to *users* in opener / finale copy ("This month's theme: Halloween Spooktacular"). It's not a guidance field for Claude — it's display copy. Overloading it with cumulative guidance behavior would conflate two responsibilities. Two separate axes keep the data model clean.

## Risks / Trade-offs

- **Risk**: Admins paste prompt-injection-shaped content into `instructions` and try to subvert Claude's behavior in ways the system doesn't want (e.g., bypass cheat detection).
  - **Mitigation**: This is a trust boundary that already exists for `theme`, the `seasons.prompt` field, and the various `instructions/*.md` overrides — admins are already trusted to set arbitrary text that Claude reads. No new trust is being granted. The new axes don't widen the existing surface.
- **Risk**: A long `additionalInstructions` chain across all four tiers bloats every `get_ideas` and `process_reveal_answers` response, consuming context.
  - **Mitigation**: Free-form strings — admins can keep them short if they care. No length cap in the initial implementation. If this becomes a real problem we add a per-field cap later.
- **Risk**: The two-field design ("instructions" + "additionalInstructions") confuses admins who don't realize one replaces and the other accumulates.
  - **Mitigation**: The `upsert_*` tool descriptions explicitly call out the cascade semantics for each field. `list_games` / `list_seasons` show both fields side-by-side so the distinction is visible while reviewing config.
- **Trade-off**: Cumulative output is a flat string with tier labels rather than a structured per-tier object. We lose programmatic access to individual tiers in the response payload (consumers can't filter "only show me slot-level guidance"). Acceptable because the consumers we have today (two prompt strings) don't need that.

## Migration Plan

No data migration required. Every new field is optional; existing trivia config files remain valid as-is. Rollback is trivial — revert the code, and the unused fields in any modified config files are ignored by the older parser.
