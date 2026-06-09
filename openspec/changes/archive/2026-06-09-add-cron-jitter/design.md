## Context

The scheduler (`src/cronScheduler.ts`) is a **60-second polling tick**, not a compute-next-fire-and-sleep scheduler. Every tick, `matchesCron(expression, now, timezone, lastRunAt)` asks: *is `now` within the 60-second window after the most recent canonical cron slot?*

```
prev = interval.prev()                      // canonical slot, e.g. 14:15:00
diff = now - prev
if (diff < 0 || diff >= 60_000) return false   // the 60s match window
if (lastRunAt && prev <= lastRun) return false // double-fire guard
return true
```

A reserved comment already sits at this exact block (`cronScheduler.ts:166`) anticipating a `jitterMinutes` field. Two prior changes documented the hook without building it: `channelless-cron-jobs` design Decision 6 ("Forward hook for `jitterMinutes`") and `add-casual-talk-plugin`'s non-goals.

Both prior notes describe jitter as perturbing "the next fire time." That phrasing predates a close reading of the implementation: there is no next-fire compute to perturb — there is only a window-membership test fired by polling. This design corrects that framing and implements jitter as a **shift of the match window**.

casual-talk fires every 15 minutes (`*/15`) and posts only ~`1/die` of the time, so posts are already sparse — but every post that *does* happen lands exactly on a quarter-hour. That clock-alignment is the tell jitter removes.

## Goals / Non-Goals

**Goals:**

- Let a cron job's effective fire minute vary per occurrence so the cadence reads as organic, not mechanical.
- Keep the stored/displayed cron expression canonical — jitter never mutates it.
- Make it opt-in and additive: jobs/specs without `jitterMinutes` behave exactly as today.
- Keep the offset deterministic so the 60s poll fires each occurrence exactly once (no multi-fire, no missed-fire), and unit-testable without clock/random dependencies.
- Make jitter a **general cron primitive** (`CronJob` / `CronJobSpec` field); the casual-talk plugin consumes it via an internal constant, not a plugin config knob.

**Non-Goals:**

- Even-distribution / "burn-down counter" for the `weekly`-die variance — that governs *how often*, not *when on the clock*. Separate change.
- Per-occurrence jitter on trivia question/reveal posts — those should land at a predictable time; trivia simply omits the field.
- Sub-minute jitter resolution — the 60s tick quantizes the offset to whole minutes, which is sufficient for "not always on :15."
- Negative (early) jitter — see Decision 2.
- Exposing jitter through the user-facing `create_scheduled_message` / Home Tab editor, OR as a casual-talk config field — plugin specs (set in plugin code) and direct `cron-jobs.json` edits only for now.

## Decisions

### Decision 1: Jitter shifts the match window, not the cron expression

When `jitterMinutes` is set, the match test becomes:

```
prev          = interval.prev()
offset        = seededOffset(job.id, prev, jitterMinutes)   // ms in [0, jitterMinutes*60_000)
effectivePrev = prev + offset
diff          = now - effectivePrev
if (diff < 0 || diff >= 60_000) return false   // shifted window
if (lastRunAt && effectivePrev <= lastRun) return false
return true
```

The canonical `prev` still anchors the occurrence; the offset only moves *which* tick inside the inter-fire gap actually matches. The expression stays untouched for Home Tab description and inspection — honoring both prior designs' explicit constraint.

**The double-fire guard keeps working for free.** A fire stamps `lastRunAt ≈ effectivePrev > prev`. Next occurrence's `prev` is strictly greater than `lastRun`, so it fires; re-entry within the same occurrence is blocked because `effectivePrev <= lastRun`. (Guard compares against `effectivePrev`, not raw `prev`, so the bound is exact.)

### Decision 2: Deterministic per-occurrence offset, seeded on `job.id + canonical occurrence time`

The offset **must not** use `Math.random()`. The tick runs every minute; a re-rolled offset would make the window land on several ticks (multi-fire) or none (missed fire). The offset must be **stable across every tick within one occurrence** yet **vary between occurrences**:

```
seededOffset(jobId, prev, jitterMinutes):
    seed = hash(jobId + prev.toISOString())     // 32-bit FNV/xfnv or similar, dependency-free
    span = jitterMinutes * 60_000
    return seed mod span                         // ms in [0, span)
```

Seeding on the canonical occurrence timestamp (`prev`) is what gives genuine *variance*: occurrence A → `:17`, occurrence B → `:23`, occurrence C → `:02`. A jobId-only seed would be a *fixed* offset (always `:17`) — still mechanical, just at a different number; rejected.

`seededOffset` is a pure function extracted as its own export, tested directly: determinism (same inputs → same output across calls), range (`[0, span)`), and stability across a sweep of `now` values inside one occurrence.

### Decision 3: Forward-only jitter `[0, jitterMinutes)`, not `±`

Prior Decision 6 floated `±N`. Forward-only is chosen instead:

- A negative offset pulls a fire *before* its canonical slot. At the start-of-day boundary slot, `interval.prev()` would still resolve to the prior day's last slot, making the early-fire arithmetic fiddly and the window risk straddling slot boundaries.
- "Fire up to N minutes after the slot" is semantically clean and reads fine for chatter.
- Mean shifts later by `jitterMinutes/2` — irrelevant for casual-talk.

### Decision 4: `jitterMinutes < inter-fire gap` is the real constraint; validate with a static cap

If `jitterMinutes` ≥ the gap between consecutive cron slots, adjacent occurrences' windows can overlap or reorder. The gap isn't always cheap to derive at validate time (it requires parsing + diffing two `prev`/`next` pairs). Pragmatic rule:

- `validateCronJobSpec` enforces an integer in `[0, 30]` (a static safe cap; rejects negatives, non-integers, and absurd values).
- The casual-talk config validator additionally caps at a value comfortably below its 15-minute gap (≤10) and documents the footgun.
- The field is optional; absent/`0` means no jitter (identical to today).

### Decision 5: Plumb through `reconcileCronJobs` with omit-to-leave semantics

`jitterMinutes` joins the `CronJobSpec` interface and follows the exact resolution pattern already used for `name` / `skipConditions` / `submitResponseMode`: present → passed to `createJob` and applied on in-place update; absent → left unchanged on update, absent on create. Persistence omits the key when unset; existing rows load unchanged (no migration).

### Decision 6: casual-talk sets jitter from an internal constant, not a config field

Jitter is a general cron concern, not a casual-talk concern. casual-talk simply sets `jitterMinutes` on its `chatter` `CronJobSpec` from a module-level constant (`CHATTER_JITTER_MINUTES = 7`, kept below the fixed 15-minute cadence). It is **not** surfaced in `CasualTalkConfig` / `config.json` — there is no admin knob and no validation in the plugin's config schema. The value rides through the existing reconcile (already hot-reloaded by the `watchFile` path for other reasons), so no separate wiring is needed. This keeps jitter "in the casual plugin's internals" while the *mechanism* stays a reusable cron primitive any plugin can opt into via its spec.

## Risks / Trade-offs

- **[Risk] Offset re-rolled per tick would multi-fire or miss.** Mitigated by Decision 2's determinism; covered by a stability-across-ticks unit test on `seededOffset`.
- **[Risk] `jitterMinutes` ≥ inter-fire gap reorders/overlaps occurrences.** Mitigated by Decision 4's validation cap; the casual-talk layer caps tighter against its known 15-minute gap.
- **[Risk] Hash quality / clustering.** A weak hash could bias offsets toward a narrow band, partially defeating the point. Mitigated by using a well-distributed 32-bit mix (FNV-1a or xmur3-style) over the seed string; not security-sensitive, so any decent avalanche is sufficient. A spread assertion over many occurrences guards against gross clustering.
- **[Trade-off] Minute-quantized offset.** The 60s tick means effective resolution is ~1 minute, so jitter lands on whole-minute boundaries. Accepted — the goal is "not always `:15`," not sub-minute scatter.
- **[Trade-off] Bot down during the jittered window misses that occurrence.** Identical to today's behavior for any cron slot the bot sleeps through; the double-fire guard still prevents catch-up storms. No change.
- **[Trade-off] Late slot pushed past the hour range** (e.g. `*/15 9-15`, slot `15:45` + 8min → `15:53`). Benign: it's a real time and does not bleed into a `16:xx` slot (16 isn't in range). No special handling.
