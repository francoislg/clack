# Design — Optional Baseline Topics

## Context

The instruction cascade loads `{role}/*.md` baseline files into every query-mode system prompt (`loadInstructions` via `buildSystemPrompt`, `src/claude/promptBuilder.ts:174`). Topic files (`{role}/topics/<t>/*.md`) load only when attached — via `preAttachedTopics` at session start (cron `attachedTopics` → `executeJob` → `processMessage`) or mid-session via `attach_integration`, which already supports instructions-only entries with no MCP server behind them (`src/tools/query/attachIntegration.ts` — `outcome=instructions_only`). Worker mode never touches the cascade (`EXECUTION_SYSTEM_PROMPT`, `src/changes/execution.ts:356`).

Shipped `user/` baseline is ~32k chars; the rendering slice (`block-kit-formatting.md` 8.4k, `submit-response.md` 6.7k, `response-style.md` 2.3k, `slack-formatting.md` 1.0k) is dead weight for scheduled fires that end in `skip_response`.

## Goals / Non-Goals

**Goals:**
- Remove rendering guidance from prompts that don't deliver rich Slack output, with zero observable regression for interactive sessions and user-created schedules.
- Reuse existing machinery end-to-end: topic folders, `preAttachedTopics`, `CronJob.attachedTopics`, instructions-only attach.
- Self-correcting failure modes (hints), never hard failures.

**Non-Goals:**
- No forced classification of operator override files (`data/configuration/`) into topics — baseline remains the "always loaded" tier.
- No change to worker-mode prompts (already cascade-free).
- No per-cron-job model override, budget directives, or further baseline slicing (`integrations.md`, `identity.md`, etc. stay baseline).
- No configurability of the trigger→topic map (ship as a core constant; revisit if a need appears).

## Decisions

### D1 — One built-in topic, attached by trigger type (core constant)

A small core map (e.g. `BUILTIN_TOPICS_BY_TRIGGER` near the prompt-options assembly) attaches `response-rendering` for `directMessages`, `mentions`, `reactions`, `autoRespond`, and `threadReply`; `scheduled` gets only the job's `attachedTopics`. Merged (deduped) with any caller-supplied `preAttachedTopics`.

*Why a constant, not config:* shipped defaults paired with shipped content; making the map configurable invites detaching rendering from DMs and getting silently degraded output. *Why not key on `submitResponseMode`:* mode `"skipped"` would be a usable negative signal, but `"optional"`/`"optional-post-to"` fires may still post — trigger type + explicit job declaration is deterministic and auditable.

### D2 — `submit-response.md` splits into contract stub + rendering topic

The baseline stub keeps the invariants every session needs: submit_response MUST be called, `skip_response` semantics, `additional_messages`/`thread_replies` gating — plus one hint sentence: rich visible output → `attach_integration("response-rendering")` first. Rendering guidance (block vocabulary usage, tables, style) moves to the topic. Follows the existing `scheduling.md` thin-pointer precedent.

*The split is editorial, not mechanical* — the file interleaves contract and rendering; the implementation task includes a read-through, not a blind move.

### D3 — Instructions-only catalog entry

`response-rendering` ships as a code-level default registry entry — defined beside `DEFAULT_GITHUB_REGISTRY_ENTRY` and inserted by `resolveEffectiveRegistry` (`src/mcp.ts`) when the operator registry lacks the name — with a description and no server binary. `attach_integration` validates the name against the registry, loads no server (`loadMcpServer` returns nothing), and injects the topic files — the existing `instructions_only` path. Duplicate attaches are already idempotent, so interactive sessions (pre-attached) calling it again are harmless no-ops.

### D4 — `attached_topics` on schedule tools, defaulting to `["response-rendering"]`

`create_scheduled_message` and `update_scheduled_message` (the cron-job-backed tools, `createJob`/`updateJob` in `src/cronJobs.ts`) gain an optional `attached_topics: string[]` arg mapped onto the existing `CronJob.attachedTopics` (create + update, update supports clear-with-empty-array as the persistence layer already does). When `create_scheduled_message` is called WITHOUT the arg, the job is stored with `["response-rendering"]` — user schedules exist to post messages, so they keep today's quality by default (option A from exploration). Plugin specs are untouched: they declare `attachedTopics` explicitly, and the idler sync specs simply don't. `schedule_reminder` is explicitly out of scope — it schedules a one-shot Slack `chat.scheduleMessage` delivery with no Claude session at fire time, so topics have nothing to attach to.

Topic names are validated at write time against known topics (topic folders across the role chain + virtual defaults + registry names) so typos fail loudly instead of silently loading nothing.

### D5 — Validation-error hint, scoped to formatting-class errors

`submit_response`'s collect-all validator (`src/tools/presentation/submitResponse.ts:1280`) distinguishes per-message formatting errors (`validateSingleMessage`: blocks, table, length budget) from action errors (`collectActionErrors`). When ≥1 formatting-class error is present AND `response-rendering` is not attached (checked via the MCP manager's attach state + session pre-attached topics), append one hint line to the error result. Action-only failures never hint — the topic wouldn't help, and the attach costs ~18k context.

*Why hint on error rather than gate:* a hard gate turns a formatting nicety into a delivery outage for cron fires; a call-time gate is also too late (composition precedes the call). The retry round-trip after a validation failure is already paid for — the hint rides it for free.

### D6 — Migration of existing state and overrides

- **Existing cron jobs** (`data/state/cron-jobs.json`): user-created jobs predating this change have no `attachedTopics`. A boot migration (via `/create-migration`) stamps `attachedTopics: ["response-rendering"]` onto non-plugin-managed jobs missing the field, preserving output quality. Plugin-managed jobs are left alone (reconcile owns them).
- **Operator overrides**: any `data/configuration/user/` override of the four moved files must be re-homed to `data/configuration/user/topics/response-rendering/` or it silently stops applying. The migration/deploy checklist includes a one-time audit; the local repo has no overrides of these four (verified during exploration), the VM must be checked at deploy.

## Risks / Trade-offs

- [Scheduled fire posts rich output without the topic] → three-layer mitigation: job-level `attached_topics`, baseline stub hint before composition, validation-failure hint on retry. Worst case is one extra attach round-trip, not bad output.
- [Split of `submit-response.md` accidentally drops a contract invariant into the topic] → review split against `submit-response-mode` and `skip-response` spec scenarios; parity test that the stub retains the must-call + skip_response language.
- [Operator override silently orphaned by the file move] → deploy-time audit step in tasks; the cascading resolver logs nothing for unmatched overrides today, so the audit is manual and must be explicit.
- [Interactive prompt content shifts ordering] → topic files render in a topic section rather than interleaved with baseline; content is the same but position differs. Accept — prompt section ordering is not a documented contract.
- [`attach_integration` catalog grows a non-tool entry] → description must make clear it's guidance-only so Claude doesn't expect tools from it.

## Migration Plan

1. Ship code + moved defaults + registry entry in one commit (defaults are checked into git).
2. Boot migration stamps existing user cron jobs.
3. On VM deploy: audit `data/configuration/user/` for overrides of the moved files; re-home if present.
4. Rollback: revert the commit — files return to baseline; stamped `attachedTopics` on user jobs is harmless residue (attaching a topic that is baseline again resolves to empty topic files… verify: after rollback the topic folder no longer exists, so attach resolves no files and logs `instructions_only` with empty body — acceptable).

## Open Questions

- Should the conditional hint also appear in `submit_response`'s tool *description* when the topic is unattached (D5's cheaper sibling)? Default: no — the stub sentence covers pre-composition; revisit if scheduled fires are observed composing rich output without attaching.
- Exact stub wording and the contract/rendering line-by-line split of `submit-response.md` — settled at implementation time against the spec scenarios.
