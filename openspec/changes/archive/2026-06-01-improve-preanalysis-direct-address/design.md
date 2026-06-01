## Context

The auto-respond pre-analysis gate (`src/claude/preAnalysis.ts`) is a single-turn Sonnet classifier that decides whether the bot engages with a message. Two variants exist:

- `runPreAnalysis` — tri-state (`respond` / `skip` / `stop`) for autoRespond rules and thread replies with no active run. Called from `resolveAutoRespondContext` in `src/slack/handlers/autoRespond.ts`. A `stop` verdict on a thread reply flips `autoResponseActive = false` (autoRespond.ts:331-336); subsequent replies are then dropped at autoRespond.ts:216 without re-running the gate.
- `runActiveRunPreAnalysis` — binary (`append` / `skip`) when a run is already live for the thread; biased toward `append`.

Both build a system prompt and receive `recentMessages` (already tagged with `isBot` and Slack `ts`, formatted via `formatRelativeAge`). The defect: the classifier weighs thread *tone* ("serious/technical → prefer skip/stop") above explicit direct address, so by-name, bot-directed messages get `skip`/`stop`. The skip-default itself is desired and stays.

## Goals / Non-Goals

**Goals:**
- A message that names the bot or is an imperative/question aimed at the bot never resolves to `skip` — it resolves to `respond` or (for explicit sign-offs like "Clack, stop") `stop`.
- Reply latency to the bot's last message is a graceful, decaying lean toward engagement — never a standalone reason to disengage.
- `stop` is reserved for explicit sign-offs / clear topic departure, not inferred from tone or quietness; its disengage side-effect is preserved.
- The two gates stay behaviorally consistent on direct address and timing.

**Non-Goals:**
- Reducing the overall `skip` rate for ambient chatter (verbosity must not increase).
- Pinning the classifier model to a fixed snapshot.
- Verdict-distribution observability/alerting.
- Any change to storage, schema, the parsing of the verdict word, or the upstream @mention handling.

## Decisions

**1. Direct address is an override evaluated before tone, not a new tie-breaker.**
Placed at the top of the classification section so it short-circuits the tone assessment. It constrains the *verdict space to the engaged verdicts* (respond/stop) rather than forcing `respond` — this is what lets "Clack, stop" disengage while "come on Clack, use a worker" responds. Rationale: the user's explicit intent (request vs sign-off) must still decide between respond and stop; only `skip` (silent non-engagement of a clearly-addressed message) is wrong. Alternative considered — "direct address always → respond" — rejected because it breaks "Clack, stop".

Detection is left to the model (semantic), guided by examples in the prompt (by-name reference; imperative/question that only makes sense aimed at the bot). We deliberately avoid a brittle regex for the bot name: nicknames, typos, and phrasing variants are exactly what the classifier is good at, and the bot name is already interpolated into the prompt as `${botName}`.

**2. Temporal proximity is passed as a single elapsed-seconds value and described as a decay, not a threshold.**
`resolveAutoRespondContext` already holds the incoming `messageTs` and the enriched history (bot messages tagged with `ts`). Compute `secondsSinceLastBotMessage = parseFloat(messageTs) - parseFloat(lastBotTs)` from the most recent bot entry, pass it as a new optional parameter into both gate functions, and render a human-readable line (reusing `formatRelativeAge`) into the prompt. The prompt instructs: short gap ⇒ strong lean to respond/append; the lean decays as the gap grows; elapsed time alone is never grounds for skip/stop. Rationale: a hard cutoff (e.g. "within 2 min") would wrongly gate out a genuine same-day or next-day reply; the user explicitly asked for decay. When no prior bot message exists in-thread, the parameter is omitted and no timing line is rendered.

**3. `stop` criteria tightened by positive framing.**
Rewrite the `stop` definition to enumerate the *positive* triggers (explicit sign-off; clear topic change with no bot involvement across several messages) instead of blunt "DO NOT infer from tone" phrasing. Keep the existing structural side-effect (caller deactivates tracking) untouched — only the model-facing criteria change.

**4. Mirror into the active-run gate.**
`runActiveRunPreAnalysis` has no `stop`, but the direct-address and timing guidance apply identically (a by-name follow-up during a live run must `append`, not `skip`). Add the same two prompt blocks and the timing parameter there.

## Risks / Trade-offs

- **[Over-engagement: direct-address override makes the bot reply to passing name-drops]** → The override only rules out `skip`; genuine third-party mentions ("ask Clack later") are rare and the imperative/question framing in the prompt scopes it to messages actually aimed at the bot. Unit tests cover name-drop-but-not-addressed cases.
- **[`stop` becomes too hard to trigger, leaving stale threads engaged]** → Acceptable: a still-engaged thread only ever stays *silent* on ambient messages (skip remains default); it does not post. Re-engagement cost was the complaint; lingering engagement is low-harm. The age-cutoff disengagement in `resolveAutoRespondContext` (threadAutoRespondMaxAgeMinutes) still reaps truly dormant threads independently.
- **[Prompt drift / model sensitivity]** → Behavioral, not structural; covered by deterministic unit tests that stub the classifier and by the existing fail-closed error handling. No rollback complexity — revert is a prompt edit.

## Migration Plan

None. Prompt-and-parameter change only; no data, schema, or config migration. Deploys with the standard image roll; rollback is reverting the change.
