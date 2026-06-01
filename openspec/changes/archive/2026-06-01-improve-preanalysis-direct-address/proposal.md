## Why

The auto-respond pre-analysis classifier is dropping messages that are unmistakably directed at the bot. Live production verdicts showed *"Come on Clack, you can do it using a worker"* — a by-name address with an imperative — classified as `"stop"`, which permanently disengaged the thread; the user had to re-@mention to get any response. The classifier lets "serious/technical thread tone" override an explicit direct address, and a single over-eager `"stop"` kills the whole thread (later replies are skipped without even re-running the gate). The skip-default is intentional (Clack used to be too verbose) and aggregate disengagement is low (~2.7% of sessions) — the defect is *targeted false-negatives on bot-directed messages*, not over-disengagement.

## What Changes

- **Direct-address override.** When a message names the bot in plain text (`"Clack, …"`, `"come on Clack"`) or is an imperative/question that only makes sense aimed at the bot, it is treated as DIRECTED AT THE BOT — which rules out `"skip"`. The verdict still follows intent: a request/question → `"respond"`, an explicit sign-off or stop instruction (`"Clack, stop"`, `"ok Clack we're done"`) → `"stop"`. Direct address selects between the *engaged* verdicts (respond/stop), never silence, and takes priority over thread-tone assessment. (An explicit `<@mention>` never reaches this gate — it is handled upstream — so a by-name reference is the signal that the user wants the bot specifically.)
- **Temporal proximity as a decaying signal.** The system computes the elapsed time since the bot's last message in the thread and injects it into the classifier prompt. A short gap is a strong lean toward `"respond"`/`"append"`; the lean decays gradually as the gap grows, but elapsed time alone is NEVER a reason to `"skip"` or `"stop"` (a reply two days later can still be a response to the bot).
- **Tightened `"stop"` criteria.** `"stop"` fires on an explicit sign-off or a clear topic change with no bot involvement across several messages — not from a serious/technical tone or a thread merely going quiet. The `"stop"` disengagement side-effect is unchanged; only the criteria for choosing it tighten. Guidance is reworded to avoid blunt negative phrasing.
- **Consistency across both gates.** The direct-address and temporal-proximity guidance is mirrored into the active-run gate (`runActiveRunPreAnalysis`, append/skip) so a by-name follow-up during a live run is never dropped as cross-talk.
- `"skip"` remains the default verdict for ambient noise and between-other-users chatter, so overall verbosity does not increase.

Out of scope (considered and rejected): pinning the pre-analysis model to a fixed snapshot; observability/alerting on verdict distribution.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `auto-respond-pre-analysis`: the classifier's verdict-selection logic gains a direct-address override and a decaying temporal-proximity signal, and the `"stop"` criteria are narrowed so thread tone alone cannot disengage a thread. Applies to both the main tri-state gate (`runPreAnalysis`) and the active-run append/skip gate (`runActiveRunPreAnalysis`).

## Impact

- **Code:** `src/claude/preAnalysis.ts` (both `runPreAnalysis` and `runActiveRunPreAnalysis` system prompts + a new optional "seconds since bot's last message" parameter); `src/slack/handlers/autoRespond.ts` (compute the elapsed-time value from the already-enriched thread history and pass it through on both the thread-reply and active-run paths).
- **Behavior:** more reliable engagement on bot-directed thread replies; no change to the skip-default for ambient chatter; `"stop"` disengagement still supported but harder to trigger spuriously.
- **Tests:** `src/claude/preAnalysis` (unit coverage for the new verdict rules) and the `autoRespond` handler (elapsed-time plumbing).
- **Risk:** prompt-only behavioral change to a classifier; no schema, storage, or API changes. No migration required.
