## Context

Identity reaches Claude only through `formatSpeaker` (`src/claude/promptBuilder.ts:200`) applied to fetched thread history in `formatThreadContext`. The triggering message is rendered separately as `QUESTION: ${triggerText(session)}` (`promptBuilder.ts:611`) with no speaker prefix. A fresh DM/mention has empty `threadContext`, so the requester is anonymous to Claude — the source of "I don't have a way to tell who you are in this DM."

Session-level identity is frozen to the creator: on reuse, `setupSession` only *backfills* `username`/`displayName` when missing (`core.ts:426-427`) and never reassigns `session.userId`. So identity built from the session would misattribute multi-user threads. But `setupSession` already resolves the current turn's `userInfo` via `getUserInfo(client, ctx.userId)` every turn (`core.ts:385`), giving a correct per-turn Slack identity for free.

The GitHub mapping already exists: `getUserRecord(userId).github?.username` (`src/userRegistry.ts:200`, `UserRecord.github.username` at `:57`), used verbatim by worker mode (`src/changes/execution.ts:511,523`). The query path never resolves it.

## Goals / Non-Goals

**Goals:**
- Give Claude the current speaker's Slack identity + mapped GitHub username on interactive turns, so first-person questions resolve without a round-trip.
- Resolve identity per-turn (correct in multi-user threads), reusing the already-fetched `userInfo` and the existing registry lookup.
- Degrade gracefully when the GitHub mapping is absent.

**Non-Goals:**
- No change to how thread *history* is attributed (`formatSpeaker` stays as-is).
- No requester attribution for `scheduled` runs (no single human speaker).
- No new persisted session fields, config, or schema changes.
- Not extending `formatSpeaker` history entries with GitHub handles (out of scope; the bug is about the current speaker).

## Decisions

**1. Render attribution on the `QUESTION:` line, not as a separate `REQUESTER:` block.**
Co-locating identity with the message is symmetric with `formatSpeaker` on history and costs zero extra prompt blocks. Shape:
`QUESTION [from Frankyboy (@flguillemette - ID: U09FSR0REUQ), GitHub @francoislg]: what did I merge yesterday`
An optional one-line guidance ("use the GitHub handle for author-scoped lookups") may be appended only if testing shows Claude doesn't reach for the handle on its own — kept out of the default to stay minimal.

**2. Resolve per-turn, pass via `PromptOptions`, never persist.**
Add an optional field to `PromptOptions` (e.g. `requester?: { userId; username?; displayName?; githubUsername?: string | null }`). `buildPrompt` renders attribution from this option, gated to interactive triggers. It is NOT stored on `SessionContext`, so the frozen-creator problem never arises.

**3. Resolve the GitHub username in `setupSession`, beside the existing `userInfo` fetch.**
Add `getUserRecord(ctx.userId)` (run concurrently with the existing lookups) and assemble the `requester` option from `userInfo` + `record?.github?.username ?? null`. Passed into `buildPrompt` for both new and reused sessions.

**4. Trigger gating lives in the prompt builder.**
`buildPrompt` emits attribution for every human-speaker trigger and suppresses it only for `scheduled` — the gate is a negative check (`triggerType !== "scheduled"`), which naturally covers `threadReply`/`channelReply` (siblings of `autoRespond`, all single-human-speaker) without an allowlist to keep in sync. Belt-and-suspenders: attribution also requires `options.requester` to be present, and `scheduled` dispatch never provides it. Keeps the policy in one testable place.

**5. Graceful degradation is a render concern.**
A small formatter mirrors `formatSpeaker`'s precedence (displayName+username → displayName → username → ID) and appends `, GitHub @x` only when present. Absent GitHub → Slack-only attribution, no false handle. A null or failed `getUserRecord` resolves `githubUsername` to `null` (identity resolution must never block the turn), rendering identically to the absent-mapping case.

## Risks / Trade-offs

- **Trust:** the block is derived from Slack's authenticated `userId`, so it is *more* trustworthy than today's behavior (Claude blindly believed typed "I'm francoislg"). Net hardening against impersonation.
- **Missing GitHub mappings are common:** many users won't have `github.username` set, so the no-round-trip win is partial until the registry fills in. Acceptable — Slack identity alone still unblocks `find_user`.
- **Extra registry read per interactive turn:** `getUserRecord` is cache-backed (`loadRegistry`), run concurrently with existing lookups — negligible latency.
- **Reaction turns have no first-person text:** attribution is still correct (reactor = speaker) but the "I/me" framing is moot; harmless.
- **Always-on prose in an already-large preamble:** mitigated by inlining on the existing `QUESTION:` line (no new block).
