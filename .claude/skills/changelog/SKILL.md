---
name: changelog
description: Generate a Slack-formatted changelog from git commits in a given time range. Groups related commits into cards, separates brand-new features from improvements to existing features and from internal changes, and filters out trivial noise. Use when the user asks for a changelog, release notes, "what shipped", a "What's New" post, or a summary of recent changes for sharing in Slack.
---

# Generate a Clack changelog

Produce a Slack-ready "What's New in Clack" post by reading git commits over a time range, grouping related commits into features, and rendering the output in the required card format.

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

Multiple commits that touch the same feature/area should collapse into one card. Signals to group on:
- Same conventional-commit scope (`feat(trivia): ...` + `fix(trivia): ...` + `refactor(trivia): ...`)
- Same OpenSpec change ID in commit body
- Same subsystem mentioned in subject lines
- Sequence of commits within a short time window touching overlapping paths (use `git show --stat` to confirm)

One card = one coherent shipped thing, not one commit.

### 5. Write each card

For every group, write a card in this exact format:

```
---
<Title> :<emoji>:

<Description>
___
```

Card guidelines:
- **Title**: short, user-facing phrasing — what changed from the user's perspective, not the commit subject. Avoid `feat:` prefixes and scope tags.
- **Emoji**: a single Slack shortcode (`:sparkles:`, `:zap:`, `:lock:`, `:wrench:`, `:art:`, `:rocket:`, `:bug:`, `:broom:`, etc.) that matches the card's vibe. Use the user-supplied `:emoji:` shortcode syntax — these get rendered by Slack.
- **Description**: 1–3 sentences. Plain language. Lead with the benefit, not the implementation. Mention configuration switches if the change is opt-in.
- Use mrkdwn formatting: `*bold*`, `_italic_`, backticks for `config.keys`.
- Do not include commit SHAs or author names.

### 6. Assemble the final post

Output exactly this structure (no surrounding code fence — the user pastes it directly into Slack):

```
:sparkles: What's New in Clack
- <Human-readable date range, e.g. "May 1 – May 22, 2026">

Here's a roundup of everything that shipped in the latest update — new features to make your day smoother, plus some behind-the-scenes improvements to keep things fast and reliable.

:tada: New Features

<feature cards — brand-new capabilities…>

:arrow_up: Improvements

<improvement cards — enhancements to existing capabilities…>

:gear: Internal changes

<internal cards…>
```

Section emoji choices:
- `:sparkles:` for the header
- `:tada:` (or `:rocket:`) for **New Features**
- `:arrow_up:` (or `:chart_with_upwards_trend:`) for **Improvements**
- `:gear:` (or `:wrench:`) for **Internal changes**

Section order is always Features → Improvements → Internal changes. If a section has zero cards, omit the section header entirely rather than leaving it empty.

### 7. Sanity checks before output

- Every card has a title, emoji, and description.
- No card describes something trivial (typo, dep bump, lint fix).
- Each card sits under the right section: **Features** only for genuinely new capabilities, **Improvements** for enhancements to things that already existed. If a "Feature" card describes tuning/polish/reliability of an existing thing, move it to Improvements.
- Related commits are merged — no two cards describe the same shipped change.
- The intro line shows the resolved date range, not the literal phrase the user typed.
- Emoji are Slack shortcodes (`:name:`), not Unicode glyphs — these are body text, not table cells, so shortcodes render correctly.

## Output

Print the final assembled post as the last thing in your response. Do not wrap it in a code fence — the user copies the rendered text. Above it, include a one-line note: how many commits were scanned and how many were dropped as minor.
