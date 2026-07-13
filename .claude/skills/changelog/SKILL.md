---
name: changelog
description: Generate a Slack-formatted changelog from git commits in a given time range. Groups related commits into cards, separates brand-new features from improvements to existing features and from internal changes, and filters out trivial noise. Use when the user asks for a changelog, release notes, "what shipped", a "What's New" post, or a summary of recent changes for sharing in Slack.
---

# Generate a Clack changelog

Produce a Slack-ready "What's New in Clack" post by reading git commits over a time range, grouping related commits into features, and rendering the output in the required card format.

## Audience

**Write for everyday Clack users — the people who talk to the bot in Slack.** They DM it, @mention it, react with emoji, play trivia, and (if they're dev+) ask it to make code changes. Speak to them, not to operators reading deploy logs or engineers reading the codebase.

This governs **altitude and framing, not what you're allowed to mention.** Admin, operations, and internal work still appear — but every card is written in terms of *what it means for someone using Clack*, never as commit-level engineering detail. The test for each card: **could a regular Slack user read this line and understand why they'd care?**

- A reliability fix isn't "resilient zod loader on state read" — it's "a whole class of silent data-corruption bugs closed."
- An infra change isn't "moved to Artifact Registry with BuildKit caching" — it's "faster, leaner deploys" with the downtime win called out.
- Admin-only surfaces get **one compact line**, not a headline card, and they ride along in an operations/polish bucket rather than the marquee.

Lead with the benefit; the machinery is at most a clause. This is a highlight reel for people who *use* the bot, framed so anyone can follow it.

## Inputs

The user may provide a time range as the argument (e.g. `last week`, `since 2026-05-01`, `2026-04-01..2026-05-15`, `last 14 days`).

If no range is provided, use the **AskUserQuestion tool** to ask:
> "What time range should the changelog cover?"

Offer options like:
- "Last 7 days"
- "Last 14 days"
- "Last 30 days"
- "Since last release tag"

Do not assume a default — wait for the answer.

## Workflow

### 1. Resolve the date range

Translate the user's input into a concrete `git log` filter:
- Relative phrases (`last 7 days`, `last week`) → `--since="<N> days ago"`
- Explicit dates → `--since=YYYY-MM-DD --until=YYYY-MM-DD`
- Range syntax (`A..B`) → `<A>..<B>`
- "Since last release tag" → resolve with `git describe --tags --abbrev=0` then `<tag>..HEAD`

Use today's date (from context) to interpret relative phrases.

### 2. Pull commits

Run:

```bash
git log --no-merges --pretty=format:"%h%x09%s%x09%an%x09%ad" --date=short <range>
```

If the list is short enough, also pull the bodies with `--pretty=fuller` or `git show --stat <sha>` on commits that look substantive. Skip `git show` for obvious low-value commits (chore, deps, formatting).

### 3. Classify commits

For each commit, classify into one of:

- **Feature** — a brand-new user-visible capability that didn't exist before (`feat:` introducing a new tool, plugin, mode, or surface). The test: before this change, a user simply could not do this thing at all.
- **Improvement** — a meaningful enhancement to a capability that *already* existed (`feat:`/`fix:`/`refactor:` that extends, tunes, polishes, or makes more reliable something users already had). The test: the thing existed before; this makes it better, faster, more flexible, or more reliable.
- **Internal** — refactor, perf, infra, migrations, tooling, type cleanup that matters but isn't user-visible
- **Minor (drop)** — typo fixes, comment-only edits, dependency bumps with no behavior change, formatting, single-line tweaks, CI config noise, OpenSpec proposal/archive docs that don't correspond to shipped behavior

Deciding **Feature vs Improvement**: look at whether the card introduces a new noun (a tool, plugin, mode, screen) or modifies an existing one. "Member-authored skills" is a Feature; "richer reveal leaderboards" or "more reliable live updates" are Improvements. When a single card mixes both, classify by its headline — the biggest, most prominent thing it ships — and fold the rest into the description.

When in doubt about whether something is "minor", err on the side of dropping it. The changelog is a highlight reel, not a full log.

### 4. Group related commits into cards

**Group aggressively.** A reader wants a handful of substantial cards, not one card per commit. Collapse everything touching the same area into a single card. Signals to group on:
- Same conventional-commit scope (`feat(trivia): ...` + `fix(trivia): ...` + `refactor(trivia): ...`)
- Same OpenSpec change ID in commit body
- Same subsystem mentioned in subject lines
- Sequence of commits within a short time window touching overlapping paths (use `git show --stat` to confirm)

Two grouping shapes carry most of the weight:

- **Themed overhaul card** — when one area got several related improvements, make ONE card with a headline, then **bolded sub-lead-in bullets** underneath, each a facet. E.g. a *Trivia* card with `*More knobs* — ...`, `*Fairer judging* — ...`, `*Admin corrections* — ...`. The whole area reads as one shipped thing.
- **Operations & polish bucket** — sweep the small, cross-cutting items (a cron tweak, a casual-talk nudge, an admin/config line, a reliability fix) into a SINGLE bucket card. Each item is a one-liner led by its own inline emoji: `Smarter crons :alarm_clock: — Missed fires caught up on boot.` This is where admin-only and operator-facing items ride along — compact, never their own headline.

One card = one coherent shipped area, not one commit. When in doubt, merge.

### 5. Write each card

For every group, write a card as an **italic headline line** followed by its description, with a `---` horizontal divider between every card:

```
_<Title> :<emoji>:_

<Description>

---
```

The card headline is wrapped in `_..._` (italic). A standalone `---` divider line separates each card from the next and from section titles.

Card guidelines:
- **Title**: short, user-facing phrasing — what changed from the user's perspective, not the commit subject. Avoid `feat:` prefixes and scope tags. The whole headline (including its trailing `:emoji:`) sits inside the italic markers.
- **Emoji**: a single Slack shortcode (`:sparkles:`, `:zap:`, `:lock:`, `:wrench:`, `:art:`, `:rocket:`, `:bug:`, `:broom:`, etc.) that matches the card's vibe. Use the user-supplied `:emoji:` shortcode syntax — these get rendered by Slack.
- **Description**: 1–3 sentences. Plain language. Lead with the benefit, not the implementation. Mention configuration switches if the change is opt-in.
- **Describe what IS.** Write each card in the present tense as the new reality — the capability a user now has or can count on. "Pick up a PR from any thread." "Reveal cards keep answers sealed until the reveal." "State loads entry by entry, quarantining a bad record." Titles are affirmative statements of the thing (`Resilient state loading`, `Continue a change from any conversation`). Let the improvement speak for itself; the reader infers the old pain from the new capability.
- Use mrkdwn formatting: `*bold*` for facet lead-ins, backticks for `config.keys`.
- Do not include commit SHAs or author names.

Two richer card shapes, used when grouping (§4):

- **Themed card with sub-bullets** — italic headline, then one bolded facet per line:
  ```
  _Trivia: a full overhaul :trophy:_

  *Redesigned reveal* — "This Round" leads the leaderboard; seasons close with a finale podium.
  *More knobs* — Choice-count bounds, emoji-styled buttons, leniency presets, no-ping mode.
  *Fairer freeform judging* — Per-answer verdicts, exact-match shortcuts, quality gates.

  ---
  ```
- **Operations & polish bucket** — a plain (non-italic) label line, then inline-emoji one-liners, each sweeping up a small item (this is where admin/ops/internal-but-worth-mentioning rides):
  ```
  Operations & polish
  Smarter crons :alarm_clock: — Missed fires caught up on boot; opt-in jitter so posts don't land at robotic times.
  Casual-talk :speech_balloon: — Fallback topics, won't pile onto bots.
  Admin & config :gear: — Search config files, edit per-repo instructions from Slack, new sudo keyword.
  ```

### 6. Assemble the final post

Output exactly this structure (no surrounding code fence — the user pastes it directly into Slack):

```
:sparkles: What's New in Clack
:calendar: <Human-readable date range, e.g. "May 1 – May 22, 2026">

Here's a roundup of everything that shipped in the latest update — new features to make your day smoother, plus some behind-the-scenes improvements to keep things fast and reliable.

---

:tada: New Features

_<Feature title> :emoji:_

<description>

---

_<Feature title> :emoji:_

<description>

---

:arrow_up: Improvements

_<Improvement mega-card title> :emoji:_

*<facet>* — <one line>
*<facet>* — <one line>

---

Operations & polish
<inline-emoji one-liners sweeping up small cross-cutting items — the last block under Improvements>

---

:gear: Internal Changes

_<Impact-framed title> :emoji:_

<description>

---
```

The title line and the `:calendar:` date subtitle are on **separate lines**. A `---` divider follows the intro paragraph and separates every card and section from the next.

Section emoji choices:
- `:sparkles:` for the header
- `:tada:` (or `:rocket:`) for **New Features**
- `:arrow_up:` (or `:chart_with_upwards_trend:`) for **Improvements**
- `:gear:` (or `:wrench:`) for **Internal Changes**

Section order is always Features → Improvements → Internal Changes. The **Operations & polish** bucket lives at the tail of Improvements. If a section has zero cards, omit its header entirely.

**Compression is the whole job.** A month of work (~150–200 commits) should land as roughly a dozen cards, not fifty. As a gut check: if two cards live in the same subsystem, they almost certainly want to be one card with sub-bullets. If a card would only interest an operator or admin, it wants to be one line in the Operations & polish bucket, or cut. Ruthlessly fold; the reader wants the shape of the release, not its commit log.

### 7. Sanity checks before output

- Every card has a title, emoji, and description.
- No card describes something trivial (typo, dep bump, lint fix, graphify/openspec housekeeping, test-only or style-only commits).
- **Every card reads at user altitude** — a regular Slack user could follow it and see why they'd care. No commit-speak, no bare subsystem/file names as the headline.
- **Admin/operator items are compressed, not headlined** — they belong in the Operations & polish bucket (one line each) or the Internal Changes section (framed for user impact), never as a marquee Feature.
- Each card sits under the right section: **Features** only for genuinely new capabilities, **Improvements** for enhancements to things that already existed. If a "Feature" card describes tuning/polish/reliability of an existing thing, move it to Improvements.
- **Aggressively merged** — no two cards live in the same subsystem; same-area work is one card with sub-bullets. Sanity-check the compression ratio: a busy month should be ~a dozen cards, not dozens.
- The intro line shows the resolved date range, not the literal phrase the user typed.
- Emoji are Slack shortcodes (`:name:`), not Unicode glyphs — these are body text, not table cells, so shortcodes render correctly.

## Output

Order the response as:

1. **A one-line scan note** — how many commits were scanned and how many were skipped.
2. **A "Skipped" review list** — every commit that did NOT become its own card, one line each, so the user can spot-check the judgment call. Group by reason for scannability. Two kinds land here:
   - **Folded** — merged into a card. Give the commit and the card it fed: `` `feat(cron): quarantine invalid jobs` → folded into *Resilient state loading* ``.
   - **Dropped** — left out entirely (trivial noise, housekeeping, test/style/deps, internal churn with no user-visible effect). Give the commit and the one-phrase reason: `` `refactor(instructions): gate scheduling into a topic` → dropped: internal hygiene, no user-facing change ``.

   Keep it terse — this is a review aid, not prose. Use short `%h` or the scope-subject as the commit label.
3. **The assembled post**, last, so the user can copy it clean. Do not wrap it in a code fence.
