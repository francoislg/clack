## Context

`SlackStreamer` collapses consecutive same-group tool calls into a single Slack task card. The header (`groupTitle()`) shows `<title> (<count>)` once the group has 2+ items, and each call appends an `itemDetail` line below the header. Today there is no cap — a session that reads 20 files renders 20 detail lines.

Three call sites in `src/streaming/slackStreamer.ts` write `chunk.details = …group.itemDetail…`:

1. **Line ~242** — folding a new same-key tool call into the open group.
2. **Line ~267** — first item when a new grouped task is created (count is implicitly 1).
3. **Line ~202-204** — re-emission of an existing grouped task with real args (replaces a `tool_progress` placeholder).

Group metadata lives in `ToolGroupInfo` (`src/streaming/toolLabels.ts`), produced by `getToolGroup()`. The mapping config schema is parsed in `src/streaming/toolMappingLoader.ts` where `groupTitles: Map<string, string>` is built from the `groups` block of each `tool_mapping/*.json` file. There is no global config slot for task-card rendering today.

## Goals / Non-Goals

**Goals:**

- Cap the number of detail lines rendered for a grouped task card without truncating the header count.
- Make the cap configurable globally (`data/config.json`) with per-group override (per `tool_mapping/*.json` file).
- Preserve backward compatibility with every existing `tool_mapping/*.json` file — the new field is optional.
- Keep the resolution logic local to `toolLabels.ts` so `slackStreamer.ts` only reads a single resolved `maxDetails` from `ToolGroupInfo`.

**Non-Goals:**

- Per-tool overrides (different cap for `Read` vs `Grep` within the same `search` group). The group is the unit of grouping; adding per-tool later is non-breaking.
- A "…and N more" trailer line. The header count already communicates that more calls happened.
- Live config reload. The tool-mapping cache already invalidates on `resetMcpCache()`; the global config follows whatever lifecycle `data/config.json` uses elsewhere (loaded at startup, reloaded on the same triggers as the mapping cache).
- Retroactively rewriting prior detail lines when a group later crosses the cap. Once written, lines stay; we just stop writing new ones once `count > maxDetails`.

## Decisions

### 1. Polymorphic `groups` values over a separate `groupOptions` block

The mapping schema's `groups` field becomes:

```ts
groups?: Record<string, string | { title: string; maxDetails?: number }>;
```

Existing files (string values) work unchanged. A group that needs an override switches to the object form:

```json
"groups": {
  "search": "Searching codebase",
  "commands": { "title": "Running commands", "maxDetails": 10 }
}
```

**Alternative considered**: a parallel `groupOptions: Record<string, { maxDetails: number }>` field. Rejected — it splits a group's configuration across two top-level fields, making it harder to discover when editing a config file. Inline polymorphism keeps everything about a group in one place.

For the **file-level `group` shorthand** (single-group files like `clack.json` that use top-level `"group": "..."` instead of `"groups": {…}`), a sibling top-level `"maxDetails": <number>` field carries the override. This stays symmetric with the per-key form.

### 2. Global config lives at `taskCards.maxDetailsPerGroup` in `data/config.json`

The new top-level key is `taskCards`, matching how existing top-level keys (`reactions`, `directMessages`, `mentions`) name the user-visible UI surface. `taskCards.maxDetailsPerGroup: number` is the only initial field, but the key is a section so future task-card-related config (e.g., `maxTaskCardsPerStream`, `collapseAfter`) has a home.

**Alternative considered**: `analysis`, `streaming`, `progress`, `rendering`. Rejected — `analysis` conflates Claude's work with how it's rendered; `streaming` leaks an implementation directory name into config; `progress` is vague; `rendering` is generic. `taskCards` matches the Slack Block Kit term and the user-visible artifact.

### 3. Resolution lives in `toolLabels.ts`, not `slackStreamer.ts`

`getToolGroup()` is the single function that builds `ToolGroupInfo`. It already imports the mapping loader; adding a global-config read here keeps `slackStreamer.ts` ignorant of where the cap value came from. The cap is resolved once per group-open and carried on `ToolGroupInfo.maxDetails`.

```
maxDetails = mapping.groupConfigs.get(key)?.maxDetails
          ?? loadGlobalConfig().taskCards?.maxDetailsPerGroup
          ?? 5
```

`slackStreamer` stores it on `openGroup.maxDetails` when the group is opened (line ~247) and gates all three detail-append sites on `this.openGroup.count <= this.openGroup.maxDetails`.

**Alternative considered**: pass global config into `SlackStreamer` via constructor. Rejected — `toolLabels.ts` already calls singleton loaders (`loadToolMappings`, `loadServerOverrides`); a `loadGlobalRenderingConfig()` singleton follows the established pattern. Constructor injection would force every test that constructs a streamer to pass mock config.

### 4. `maxDetails: 0` is valid; no unlimited sentinel

`0` means header-only — a legitimate choice for very noisy groups. Removing the field (or setting it to `undefined`) falls back to the global default. There is no `-1` or `null` "unlimited" sentinel; if a user really wants unbounded, they can set a large number like `9999`. This keeps the type a plain `number` and avoids special-case logic.

### 5. Re-emission path (line ~202-204) gates on the same cap

When `tool_progress` (empty args) is followed by `tool_use` (real args), the streamer re-emits the detail line with interpolated args. If the count is already above the cap, the re-emission is skipped — the original "placeholder" detail line, if any, stays as-is and no new line is appended. In practice this matters only when a tool runs 6+ times and the 6th's real args arrive after the placeholder; the user sees the header count tick to 6 but the detail list is frozen at 5.

## Risks / Trade-offs

- **[User confusion when details freeze mid-session]** → The header continues to update (`(6)`, `(7)`, …) so the change is clearly bounded by count, not by abrupt cutoff. The default of 5 is large enough that short sessions are unaffected.
- **[Power users who want unlimited]** → Acceptable: set `maxDetails: 9999` (or a similarly large number). Documented in the mapping config example file.
- **[Tool mapping cache and global config cache drift]** → Both must invalidate together. `loadGlobalConfig()` already reloads on the same triggers as the mapping cache (`resetMcpCache()` is the primary invalidator for runtime config). Verified by adding a test that calls `resetMcpCache()` and confirms a config change is reflected.
- **[Cap applied per-grouped-task, not per-stream]** → Two separate groups in the same stream each get their own cap. Intended — different group types (search vs. edit) have different signal-to-noise ratios.

## Migration Plan

No migration. The new fields are optional in both `config.json` and `tool_mapping/*.json`. Existing files work without changes; the built-in default (`5`) applies until any of the new fields are set.

If, post-rollout, the default cap of 5 turns out to be too tight, raise the global `taskCards.maxDetailsPerGroup` in `data/config.json` rather than touching code.

## Open Questions

None — all four exploration threads were resolved before drafting:

1. Polymorphic `groups` schema confirmed.
2. No per-tool overrides confirmed.
3. `maxDetails: 0` semantics confirmed (header-only).
4. Config name `taskCards` selected over `analysis` (analysis describes Claude's work, not how it's rendered).
