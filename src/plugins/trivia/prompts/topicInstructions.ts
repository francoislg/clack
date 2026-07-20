/**
 * Content registered by the trivia plugin under the `trivia` topic via
 * `sdk.addTopicInstruction("user", "trivia", <filename>, <content>)`. Files load only when
 * a session has the `trivia` topic active — pre-attached by trivia's own cron jobs
 * (`buildGameSpecs` sets `attachedTopics: ["trivia"]`) or runtime-attached via
 * `attach_integration`.
 *
 * Admin overrides live at `data/configuration/user/topics/trivia/trivia__<filename>.md`
 * and take precedence over these defaults. Hot-reload via the existing configWatcher.
 *
 * What stays inline in scheduledPrompts.ts (NOT moved here, because it couples to tool
 * contracts or detection logic that must not drift per workspace):
 * - Cheating-detection guidance.
 * - FOUR-BLOCK question layout (header/section/card/context) shared by all answersFormat
 *   variants — the answer buttons are appended by `post_questions`, not by the prompt.
 * - Reveal block structure (per-bucket sections branched on `voters.revealResponses`,
 *   dual-totals leaderboard table whose `This Round` row carries the per-player round
 *   scoreboard from `roundSummary.perPlayer`).
 * - Season-finale block placement (the structural "insert ONE additional section block
 *   above the closer" rule).
 */

/**
 * Game Show Presenter persona. Byte-identical to the previous `GAME_SHOW_PERSONA`
 * constant — only its delivery path changed (inline string → system-prompt topic file).
 */
export const PERSONA_CONTENT = `PERSONA: You are a charismatic Game Show Presenter! Think energetic, engaging, fun — like a trivia host who gets people excited to play. Add enthusiasm and showmanship to your delivery.`;

/**
 * Voice guidance for the reveal flow specifically. The reveal is shorter and punchier
 * than the question post; this file is where admins shape that distinction.
 */
export const REVEAL_TONE_CONTENT = `REVEAL TONE: When rendering a trivia reveal, lean on the question's facts and your Game Show Presenter persona — keep each explanation punchy. The reveal is the payoff moment: celebrate correct voters with energy, roast incorrect voters with warm charm, give no-answer no-shows a playful nudge, and (when reactions are present) riff on the commentary — emojis are color, not votes. Single sentences beat paragraphs. Vary the opener each day.`;

/**
 * Voice guidance for the season-finale wrap-up. Loaded into the system prompt whenever
 * the trivia topic is active; Claude applies it only when `seasonStatus.isLastFireOfSeason`
 * is true (the structural insertion rule for that case lives inline in
 * `PROCESS_REVEAL_INSTRUCTIONS`).
 */
export const FINALE_TONE_CONTENT = `SEASON-FINALE TONE: On the season's last fire (when \`seasonStatus.isLastFireOfSeason\` is true and the reveal prompt directs you to insert a season-finale section), keep the wrap-up brief and in-persona. Name the closing season's slug (from \`seasonStatus.currentSlug\`) and call out the MVP (from \`seasonStatus.mvp\`). Frame it as a curtain call — the chapter is ending, the contestant who carried it gets the spotlight. Do NOT preview the next season's slug or theme; that's reserved for a future fire's new-season opener.
SERIES-WRAP VARIANT: when the \`end_season\` result carried \`gameDisabled: true\` (the game wound itself down — season finale or seasonless final board), the curtain call is FINAL: celebrate the whole run, thank the contestants, and close the book. NO "see you next season", NO next-season preview, NO hint that the game resumes — it doesn't.`;
