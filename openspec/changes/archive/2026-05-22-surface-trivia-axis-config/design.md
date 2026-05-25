## Context

The trivia plugin's configurable axes (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `format`) cascade through three tiers — slot → season → workspace (`config.trivia.*`) → built-in default. Each `get_ideas` call picks one value per axis using the resolved weights, hides the resolution path, and emits only the picked value. The configuration that produced that pick is invisible to Claude (and therefore to admins talking to Claude) at query time.

Today, the read-side tools mostly predate the axis explosion:

- `list_seasons` returns `{ slug, startedAt, expectedEndAt, endedAt, categories, status }` — no axes, no theme, no format.
- `list_games` returns `{ name, channel, timezone, enabled }` — no workspace defaults, no cron expressions, no off-days.
- `check_season_status` returns timeline metadata only — by design.
- `upsert_season` echoes `hasAnswersFormat: true | false` etc. on success — booleans, not values.

The result: admins asking *"what's my trivia config right now?"* either get a partial answer from Claude or fall back to reading the JSON files manually. This proposal closes that gap by extending the two list tools to surface raw per-tier values.

## Goals / Non-Goals

**Goals:**
- Make `list_seasons` and `list_games` rich enough that an admin (via Claude) can audit the full cascade for any axis without touching disk.
- Keep the response shape additive — every new field is optional, so existing callers and tests continue to work.
- Preserve the cascade semantics — what we surface is the RAW value at each tier (present iff explicitly set there), not a resolved/effective value. The cascade rule is constant and documented; admins can derive "which tier wins" from raw values alone.

**Non-Goals:**
- No new `resolve_axes` / "what's effective right now?" tool in this change. Defer until concrete demand exists.
- No source/origin tags wrapping each axis value (`{ value, source: "workspace" }`). That doubles the response size for marginal clarity — Claude already knows the cascade rule from `get_ideas`'s description.
- No changes to write tools — `upsert_season` and friends stay as-is.
- No introspection of `slot.*` overrides via the list tools. Slot-tier values are already returned by `get_ideas`'s `format` block. Re-surfacing them via `list_seasons` would duplicate the same data.
- No new MCP tool for `config.trivia` introspection independent of `list_games`. Folding the workspace tier into `list_games` keeps the surface area minimal.

## Decisions

### Decision 1: Per-entry raw values vs. resolved/effective values

**Choice:** Surface RAW stored values per tier. `list_seasons` shows whatever each season entry literally has set; `list_games` shows whatever `config.trivia.*` literally has set. Both omit fields that the tier didn't set explicitly.

**Alternatives considered:**
- *Resolved/effective values with source tags* (`{ freeformAnswerShape: { value: {...}, source: "workspace" } }`) — gives Claude a single read for any tier's effective state, but doubles response size and bakes the cascade rule into the response shape (a behavioral coupling that's hard to change later).
- *Both raw and effective* — most informative, also most verbose. Reject as over-engineering for the current use case.

**Why raw wins:** the cascade rule (slot → season → workspace → default) is fixed and documented in `get_ideas`'s description. Given raw per-tier values, Claude can derive "which tier wins" with simple priority logic. If admins later ask "what's effective for slot N right now?" we add a dedicated tool then, without baking that question into every list response.

### Decision 2: Where the workspace tier lives in `list_games`

**Choice:** Surface workspace-level axis defaults as a single top-level `workspaceDefaults` block in the `list_games` response — NOT per-game.

**Alternatives considered:**
- *Per-game inheritance* (each game entry carries the workspace defaults) — would re-send the same workspace block per entry; pointless duplication.
- *Separate `get_workspace_config` tool* — adds an extra round trip and a new tool name to teach Claude. Folding into `list_games` keeps the surface flat.

**Why a top-level block wins:** the workspace tier is genuinely shared. Putting it once at the top of `list_games` matches its scope.

```ts
return textResult({
  games: [...],
  workspaceDefaults: {
    ...(workspaceAnswersFormat !== undefined ? { answersFormat: workspaceAnswersFormat } : {}),
    ...(workspaceQuestionType !== undefined ? { questionType: workspaceQuestionType } : {}),
    ...(workspaceFreeformAnswerShape !== undefined ? { freeformAnswerShape: workspaceFreeformAnswerShape } : {}),
    ...(workspaceContexts !== undefined ? { contexts: workspaceContexts } : {}),
    ...(workspaceDifficulty !== undefined ? { difficulty: workspaceDifficulty } : {}),
    ...(workspaceOffDays !== undefined ? { offDays: workspaceOffDays } : {}),
  },
  total: filtered.length,
});
```

Per-game entries additionally carry their cron expressions (`questionCron`, `revealCron`) so admins can see scheduling without a config-file diff.

### Decision 3: Cron expressions in `list_games`

**Choice:** Include `questionCron` and `revealCron` per game entry. The current `list_games` description says crons are excluded ("scheduling details, not relevant to per-game tool calls"). Reverse that — now that admins are auditing configuration via this tool, crons are part of what they want to see.

**Trade-off:** marginal token-count growth on a tool that's already small. Adding ~50–100 bytes per game is well within any reasonable budget.

### Decision 4: Format slot details on `list_seasons`

**Choice:** When a season carries a `format`, include the full `format.questions` array on the season entry. Each slot's `label`, `categories`, `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty` surfaces if set on THAT slot.

**Rationale:** slot overrides are the deepest tier. Without surfacing them, admins can't audit slot-tier config at all. The data is small and bounded (slot count is the question count per fire; rarely more than 5).

### Decision 5: No spec changes to `trivia-question-contexts` / `trivia-freeform-questions` / etc.

**Choice:** Only `trivia-seasons` and `trivia-games` specs change. The axis capability specs themselves (one per axis) are about *behavior*, not about how config is surfaced for inspection. Extending the list responses is a property of the read tools, which live under the seasons/games capabilities.

## Risks / Trade-offs

- **Risk:** Token growth on `list_seasons` for workspaces with deeply-formatted seasons (e.g., 5 slots × 6 axes each = 30 mini-objects in the response).
  - **Mitigation:** axis maps are tiny (5–7 numeric keys) and only present when set; un-set axes don't bloat the response. Worst-case payload for a single season with full format is still well under 2 KB.

- **Risk:** Claude leans on cascade *reasoning* from `list_seasons` + `list_games` to "explain" the effective config to admins, gets the cascade direction wrong, and confidently states the wrong tier wins.
  - **Mitigation:** the cascade rule is one line. Document it explicitly in both tool descriptions (`list_seasons` and `list_games`) so it's pinned at every read. If we still see misattribution in practice, we add the dedicated `resolve_axes` tool.

- **Risk:** Surfacing the workspace tier in `list_games` makes the description less honest about what the tool *is* (it was "list games" — now it's "list games + show workspace trivia config").
  - **Mitigation:** rename the description's verbiage to reflect the new scope; the `workspaceDefaults` block makes the split explicit. Future-proof option: separate `list_workspace_trivia_config` tool when more workspace-level concepts emerge — for now `list_games` is the natural home.

- **Trade-off:** Slot-tier configuration is shown twice — once via `get_ideas` (`format.slots[i]`) and once via `list_seasons` (`format.questions[i]`). Acceptable: they serve different audiences (`get_ideas` is generation-time; `list_seasons` is audit-time) and the data is small.

## Migration Plan

No data migration. Code-only change. Deploy in a single commit:

1. Extend `listSeasons.ts` to map the additional fields.
2. Extend `listGames.ts` to compute `workspaceDefaults` from `getConfig()`.
3. Update tool descriptions to mention the new fields and the cascade rule (one sentence).
4. Update / add tests covering: empty workspace, partial workspace, fully-set workspace; seasons with no axes, partial axes, full axes including a multi-slot format with per-slot overrides.
5. Update the modified spec deltas (`trivia-seasons`, `trivia-games`) and validate with `openspec validate surface-trivia-axis-config --strict`.

Rollback: revert the commit. No persisted state changes mean rollback is trivial.

## Open Questions

- Should `workspaceDefaults` also include `seasons.enabled` / `seasons.prompt` and `choices`? Both are workspace-tier knobs. Leaning yes — they belong to the same "what's the workspace baseline" concept — but they're slightly tangential to the cascade. **Tentative: include them**, scoped to `workspaceDefaults` alongside the axes. Open to dropping if review says "scope creep."

- Should `list_games` add a `disabledCount` field (number of games filtered out when `includeDisabled` is false) for transparency? Mild quality-of-life win. **Tentative: yes**, but it's so cheap it could just go in without further discussion.

- Should `list_seasons` add a top-level `seasonDefaults` block summarizing what the season tier would contribute (i.e., the season's `answersFormat` etc. when explicitly set, summarized once instead of per-entry)? **No** — each season already has its own settings; a separate top-level summary would either duplicate or pick an arbitrary "active" season. Per-entry stays.
