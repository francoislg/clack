## Context

The instruction-file system has two tiers: shipped defaults in `data/default_configuration/` and admin overrides in `data/configuration/`. The cascade resolver prefers the override when both exist. Today the conversational surface (`propose_config_update`) can create or modify overrides, but there is no path through chat to remove one — only the Home Tab's `delete_config_file` button (homeTab.ts:641) can do that. The underlying fs primitive `deleteInstructionFile` (configurationFiles.ts:210) already exists and is path-traversal-safe.

The existing flow for an update is:

```
Claude → propose_config_update         IntentStore stages
       (role, topic?, file, content,    { type: "config_update",
        operation: append|replace)        file, content }
                                                │
                                                ▼
Claude → submit_response               action handler / autoExecute
       (action: { type: "config_update",   resolves ref → intent
        ref, auto? })                       → writeInstructionFile(file, content)
```

We want delete to ride the same rails. The cheapest path is to extend `operation` rather than spin up a new tool, new action type, and new handler. The intent payload gains a delete variant, and the two consumers (`configUpdateAction.ts` button handler and `autoExecute.ts`) branch on it.

## Goals / Non-Goals

**Goals:**
- Let Claude propose removal of a custom override from chat with the same UX shape as a write.
- Reuse the existing ref → button → handler pipeline; no new action type in `submit_response`.
- Surface the right user-facing semantics: "Remove Override" when a default exists (the file reverts), "Delete File" when it's custom-only (the file vanishes).
- Reject obviously-wrong calls at the schema/tool layer (delete with no override; delete with content payload).

**Non-Goals:**
- Deleting shipped defaults (the `data/default_configuration/` tree). The tool, like `writeInstructionFile` and `deleteInstructionFile`, only touches `data/configuration/`.
- A separate "reset to default" UX flow distinct from delete. They are the same operation — when a default exists, removing the override IS the reset.
- Bulk delete (multiple files at once). Single file per call, like the existing operations.
- Deleting from the `default_configuration/` tier or from outside the configuration directory. The fs primitive already enforces this.

## Decisions

### Decision 1: Extend `operation`, not a new tool

**Choice:** Add `"delete"` to the existing `operation` enum on `propose_config_update`.

**Alternative:** Introduce `propose_config_delete` as a separate MCP tool, with a new `config_delete` action type in `submit_response`.

**Why:** From the user's mental model — and from the routing layer's POV — "delete an override" is just another config mutation. Path validation, role gate, ref staging, button routing, auto-execute, and the orphan-cleanup set (`ORPHANABLE_INTENT_TYPES` in handlerResponse.ts:590) all already exist for `config_update`. Spinning up a parallel tool would double those surfaces for no semantic gain. The cost of the chosen path is two small branches in two handler files; the cost of the alternative is a new tool, a new action type, a new handler file, a parallel test suite, and updates to every list/route/orphan-tracking spot that enumerates intent types.

### Decision 2: Encode delete on the intent, not on a new intent type

**Choice:** `StagedConfigUpdateIntent` becomes a discriminated union:

```ts
type StagedConfigUpdateIntent =
  | { type: "config_update"; operation: "write"; file: string; content: string }
  | { type: "config_update"; operation: "delete"; file: string };
```

(`operation: "write"` covers both `append` and `replace` from the tool layer — by the time the intent is staged, the content has already been composed; the tool layer is the only consumer that cares whether it was append vs replace.)

**Alternative:** Keep `content: string` and add a sentinel like `content: null` or a separate `delete: boolean` flag.

**Why:** A discriminated union makes the impossible-state (`delete` + `content`) un-representable in the type system. Sentinels rot — three years from now a future reader would have to grep for "is empty string a real value or the delete sentinel?". The downside is touching every place that destructures `intent.content` (configUpdateAction.ts:82, autoExecute.ts:168, persistence in changeAction tests), but those are exactly the call sites that need to branch on delete anyway, so the type system forcing the branch is the point.

### Decision 3: Tool refuses delete when no override exists

**Choice:** `propose_config_update` with `operation: "delete"` reads the current state via `readInstructionFile`; if `custom_content === null`, it returns an error (no ref staged) explaining that the path has no override to delete.

**Alternative:** Stage the intent anyway and let the apply step no-op or error.

**Why:** Catching it at tool-call time gives Claude a clean failure it can incorporate into its reply ("There's no custom override on that file — nothing to remove"). Catching it at button-click time means the user sees a confusing error after they already approved the action. Cost is one extra `readInstructionFile` call, which the tool already does in the existing append path.

### Decision 4: Button label derived from staged operation + default existence

**Choice:** The action-label resolver branches:

```
operation = write          → t("blocks.action_label_config_update")    "Apply Update"
operation = delete         → recheck readInstructionFile(file):
   default_content exists  → t("blocks.action_label_config_revert")    "Remove Override"
   default_content null    → t("blocks.action_label_config_delete")    "Delete File"
```

**Alternative:** Single "Remove" label for both delete sub-cases.

**Why:** The two sub-cases have materially different outcomes — one reverts to behavior the user might not remember (the shipped default), the other makes the file disappear entirely. A single label loses that signal. The recheck at render time is fine because the staged intent doesn't carry default-existence state and the cost is one more fs check on the click path.

### Decision 5: `content` field validation

**Choice:** At the Zod schema layer, `content` is optional. At the handler layer, refuse the call if `operation === "delete"` and `content` is provided (any non-empty value), or if `operation !== "delete"` and `content` is missing.

**Alternative:** Make the Zod schema itself a discriminated union via `z.discriminatedUnion`.

**Why:** Discriminated-union Zod schemas at the MCP tool boundary tend to confuse Claude — error messages name the union variant rather than the field, and Claude has historically retried with the wrong shape. A flat schema with explicit handler-layer validation gives clearer error text ("`content` must be omitted when `operation: 'delete'`") that Claude can act on. The runtime check is three lines; the type narrowing in the function body is unaffected.

### Decision 6: `auto: true` allowed for deletes

**Choice:** Auto-execute works the same way for delete as for write. No extra confirmation gate.

**Alternative:** Force a button click for delete operations even when Claude sets `auto: true`.

**Why:** Symmetry. An admin saying "remove my override on `user/identity.md`" is no less explicit than "update `user/identity.md` to say X" — both are direct directives. Adding an asymmetric gate is paternalistic and inconsistent. The Home Tab delete button doesn't double-confirm either. If a user wants extra friction, Claude can opt not to set `auto: true` for ambiguous phrasing — same as it does today for writes.

## Risks / Trade-offs

- **Risk:** Claude calls delete on a topic-scoped path that has a default but the user meant "remove the whole topic." → **Mitigation:** the tool description names the operation as "remove your custom override" (not "remove the file"), and the button label disambiguates at click time. Topic-directory-level deletion stays out of scope.

- **Risk:** A staged delete intent persists in the IntentStore beyond the override's lifetime — e.g., another admin deletes the override via the Home Tab in between staging and clicking. The button-click handler would then call `deleteInstructionFile` on a missing file and throw. → **Mitigation:** `deleteInstructionFile` already throws `File not found` with a clear message; the existing error-handling block in `configUpdateAction.ts:90` catches it and posts an ephemeral error. No new code needed; the failure is benign.

- **Risk:** `ORPHANABLE_INTENT_TYPES` (handlerResponse.ts:590) already includes `"config_update"`, so orphan cleanup works for free — but the cleanup currently assumes the intent is a write (no special teardown). For a delete that gets orphaned, "do nothing" is the correct cleanup. → **Mitigation:** no change needed; the orphan path is shape-agnostic.

- **Trade-off:** The intent type becoming a union means tests that construct intents inline (changeAction.test.ts:327, autoExecute.test.ts, configUpdateAction.test.ts) must add the `operation` field. Mechanical update, no behavior change.

- **Trade-off:** The Slack DM-first delete experience surfaces a button labeled "Delete File" or "Remove Override" instead of the more familiar "Apply Update". Worth a quick visual check that the button widths still look reasonable in the carded layout, and that the i18n FR strings are not identical to EN (the parity test enforces this).
