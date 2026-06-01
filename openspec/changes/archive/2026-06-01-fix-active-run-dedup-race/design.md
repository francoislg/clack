## Context

The active-runs registry (`src/slack/activeRuns.ts`) is a synchronous in-memory `Map` keyed by `(channelId, threadTs)`, intended as the single mutual-exclusion point that prevents two concurrent triggers on one thread from each spawning a Claude run. The `active-runs-registry` spec already mandates this ("Atomic Slot Claim").

The implementation does not honor it. The decision is split across a long async gap:

- **Consult** (synchronous): `processMessage` reads `getActiveRunForChannelMessage(channelId, effectiveThreadTs, userId)` at `core.ts:482`.
- **Claim** (much later): `registerActiveRun(...)` runs inside `askClaude` at `index.ts:486`, after `setupSession` (`client.auth.test`, `fetchThreadContext`, `transformUserMentions`, `getUserInfo`, `getChannelInfo`, `createSession`), `getClaudeOptions`, and — inside `executeAndDeliver` — `getUserInfo` again and `streamer.start()` (`handlerResponse.ts:168`, which posts the "thinking" card). That is 4–6 awaited Slack/disk round-trips, ~500ms–2s.

@slack/bolt dispatches `userMessage` (and message/mention) events concurrently; there is no per-thread serialization anywhere in the gap. So two DM messages on one thread within the window both observe an empty slot and each spawn a run + a streamer. When the later `registerActiveRun` finds the slot already taken, `askClaude` logs and *proceeds without registration* (`index.ts:488`), running the duplicate untracked — its streamer card leaks and the stop pipeline cannot reach it.

The bug is timing-dependent ("sometimes"). The debug session that prompted this (`D0A92FYNJTT:1780341998.390509`) did **not** trip it — its follow-ups arrived far enough apart that the first run had already registered, so they correctly queued via `sendUpdate`. A reliable repro is two DM messages on a fresh thread within ~1s.

A reservation/placeholder approach was evaluated and rejected (see Decisions): a placeholder handle cannot accept `sendUpdate` because there is no mechanism to replay buffered text into the real run's freshly-constructed SDK input stream, and `askClaude`'s unconditional `registerActiveRun` would never replace the placeholder — turning an intermittent leak into a permanent one.

## Goals / Non-Goals

**Goals:**
- Guarantee that concurrent triggers on the same `(channelId, threadTs)` result in at most one fresh run; the rest queue onto it via `sendUpdate` or fall through cleanly if it has settled.
- Eliminate untracked/leaked runs: a run that cannot own its slot must not execute as a duplicate.
- Bring the implementation back into conformance with the existing `active-runs-registry` spec and tighten that spec to forbid the consult/claim gap.

**Non-Goals:**
- No change to the legitimate multi-turn flow (a follow-up that arrives after the previous turn settled still spawns a fresh resumed run).
- No change to cross-thread concurrency — different threads still run fully in parallel.
- Not implementing the spec's `(channelId, dmUserId)` DM key or handle-side self-registration redesign (the current code is thread-key only and registers externally); out of scope for this fix.
- No data-format, config, or persistence changes; the registry stays in-memory.

## Decisions

### Decision 1: Per-thread async mutex around the consult-then-act block

Wrap the entire check-then-`{sendUpdate | spawn}` region of `processMessage` (`core.ts:474–523`, extended to cover the spawn path through `executeAndDeliver`) in a per-thread lock keyed by `(channelId, effectiveThreadTs)`, implemented in `activeRuns.ts`:

```
const prev = threadMutexes.get(key) ?? Promise.resolve();
const next = prev.then(run, run);   // run = the full consult + queue-or-spawn body
threadMutexes.set(key, next);
next.finally(() => { if (threadMutexes.get(key) === next) threadMutexes.delete(key); });
return next;
```

The lock must be held until the new run has registered itself in the registry (i.e. across `setupSession` and at least until `askClaude` reaches `registerActiveRun`), so the next queued invocation observes the registered handle on its consult. It is released once registration is done — it does **not** need to be held for the whole run.

**Why this over alternatives:**
- **Placeholder reservation (rejected):** no replay path for `sendUpdate` text buffered before the real SDK query exists (the real run builds a fresh input stream seeded only with the initial prompt), and `askClaude`'s `registerActiveRun`-then-proceed logic never swaps the placeholder out → permanent leak. Would require new input-buffering + a register handoff rewrite.
- **Move `registerActiveRun` earlier without a lock (rejected):** only shrinks the window, does not close it; still races between the synchronous consult in the handler and the claim.
- **Dedup by message ts (rejected):** solves Slack re-delivery, not distinct user messages sent quickly — a different problem.

The mutex makes consult-and-claim atomic *with respect to other invocations on the same thread* without buffering machinery, and `sendUpdate` always targets the live SDK stream of the real registered run, so queued text reaches Claude.

### Decision 2: Make an unclaimable slot fatal to the duplicate

At `index.ts:486–492`, when `registerActiveRun` returns `false` the run must not proceed untracked. With Decision 1 in place this branch should be unreachable for the handler paths covered by the lock; treat reaching it as an error — abort the freshly constructed run (and let the caller route the message to the owning run) rather than executing a leaked duplicate. This is defense-in-depth for any spawn path not covered by the mutex.

### Decision 3: Audit before flipping the register-or-bail behavior

`askClaude`/`executeAndDeliver` is shared by `choice`, `followup`, `retry`, and the change-thread action handlers. Before making the unclaimable-slot case fatal, confirm none of these intentionally run concurrently with an existing run for the same thread (e.g. a button click that should run alongside something). If one does, scope the fatal behavior to the `processMessage` trigger paths rather than all callers.

### Decision 4: Streamer starts only after slot ownership

`streamer.start()` (`handlerResponse.ts:168`) currently posts the "thinking" card before the run owns the slot. Keep streamer creation inside the locked region so a race-loser never posts a card. With Decision 1 there is no race-loser, but this ordering removes the visible "multiple thinking" artifact even if a future spawn path escapes the lock.

## Risks / Trade-offs

- **[Lock held too long stalls the thread]** → Release the lock as soon as the new run is registered (after `registerActiveRun`), not after the run completes. Follow-ups during the run still take the fast `sendUpdate` path, which runs inside the lock but returns immediately.
- **[Lock never released on a throw mid-setup]** → Use `prev.then(run, run)` chaining + `finally` cleanup so the chain advances on both success and failure and the map entry is deleted; every early-return/throw between consult and registration must resolve the lock.
- **[Audit surfaces a path relying on "proceed unregistered"]** → Decision 3 gates Decision 2 on that audit; if found, scope the fatal change to trigger handlers only.
- **[Key drift between lock key and register key]** → Lock on `effectiveThreadTs`; `askClaude` registers on `session.threadTs`, which equals `effectiveThreadTs` for every trigger path (`core.ts:328/360`). Verified, but add a test asserting equality so a future change can't silently reintroduce drift.
- **[Serialization reduces same-thread throughput]** → Intended: messages on one thread should serialize so the second queues onto or follows the first. Cross-thread parallelism is unchanged.
