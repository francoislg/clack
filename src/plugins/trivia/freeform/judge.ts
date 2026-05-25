import type { TriviaQuestion } from "../core/types.js";

/** One pending free-form submission to be judged. */
export interface JudgeSubmission {
  /** Per-batch stable key the judge echoes back so we can map verdicts to rows. */
  key: string;
  userId: string;
  /** The user's typed text (already trimmed at submit time). */
  answerText: string;
}

/** Per-question grouping fed to the judge. */
export interface JudgeQuestionGroup {
  question: TriviaQuestion;
  submissions: JudgeSubmission[];
}

export interface JudgePrompt {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface JudgeVerdict {
  key: string;
  correct: boolean;
  /** Optional short label the model can use, e.g. "multiple-guess" / "ok" / "near miss". */
  reason?: string;
}

const SYSTEM_PROMPT = `You are a strict but fair trivia judge.

Your job is to read each player's typed answer and decide whether it matches the expected answer for the question.

Rules:
- Case- and punctuation-insensitive matching of the canonical answer is fine.
- Common synonyms, alternative spellings, and reasonable variants are acceptable IF they are a SINGLE answer.
- Single answers WITH qualifiers or parentheticals are valid (e.g. "Tokyo, Japan", "Paris (France)", "rock and roll").
- ACCEPT minor typos when the intent is unambiguous — small transpositions, one missing/extra letter, or a clear misspelling that still reads as the expected answer (e.g. "Pariss", "Pris", "Tokio" for "Tokyo"). Use judgment proportional to the word length: ~1 character off for short answers (≤5 chars), up to ~2 characters off for longer answers.
- REJECT (correct: false, reason: "typo-too-far") when the typo is so large that the answer becomes ambiguous, could plausibly be a different word, or requires guessing the player's intent (e.g. "Pars" → could be Paris or Mars; "Lordon" → too far from "London").
- REJECT (correct: false, reason: "multiple-guess") any answer that hedges between two or more distinct guesses — e.g. "Paris or London", "either A or B", "A | B | C" — EVEN IF one of the guesses matches the expected answer. The player must commit to a single answer.
- REJECT (correct: false, reason: "too-broad") any answer expressed as a range, set, or category so wide that it trivially contains the expected answer without committing to it — e.g. "between 1900 and 2500" for a year question, "somewhere in Europe" for a city, "a mammal" for a specific species. A reasonable approximation is fine (e.g. "around 1945" for 1944 may be accepted per \`gradingNotes\`); a sweeping range that any guess would fall into is not.
- LEEWAY: when the question's text OR \`gradingNotes\` states an explicit numeric tolerance (e.g. "within 5 years", "±10 km", "to the nearest decade"), follow it STRICTLY. ACCEPT any single committed value inside the stated tolerance window around \`expectedAnswer\`; REJECT (correct: false, reason: "out-of-tolerance") anything outside it, even if "close." When NO tolerance is stated, do NOT invent one — require a match (modulo typos / synonyms / acceptable variants).
- DATE FORMS — format mismatch is NEVER a rejection reason on its own. When the expected answer is a decade ("1900s", "the 1990s"), the question/notes specify decade-level tolerance, or the question simply asks "what decade", ACCEPT any year that falls inside that decade in ANY reasonable typed form: bare year ("1900", "1905"), decade form ("1900s", "the 1900s"), or explicit range ("1900-1909"). The same principle applies to centuries and other date granularities — committing to ANY value inside the accepted window is correct, regardless of whether the player matched the question's stated granularity.
- DATE SPANS — when the question describes an event that spans more than one decade (e.g. a tenure, a war, a movement) and \`gradingNotes\` or the statement mention a concrete year range, treat EVERY decade that the range touches as a valid answer, even if only one appears in \`expectedAnswer\` / \`acceptableAnswers\`. Example: a tenure from 1898 to 1907 → accept "1890s", "1900s", "1898", "1907", any year in [1898, 1907]. Authors sometimes forget to enumerate every spanned decade; the judge should not punish players for the author's omission when the range is unambiguous from the question.
- REJECT (correct: false) when the typed answer is materially different from the expected answer.
- ACCEPT (correct: true) when the typed answer is the same answer expressed differently.
- When \`acceptableAnswers\` are provided, treat them as ADDITIONAL valid forms.
- \`gradingNotes\` (when provided) refine your judgment for that question. They do not override the expected answer — they only clarify accepted forms.

Output STRICT JSON only. No prose, no markdown fences. The output MUST be an object of this exact shape:
{
  "verdicts": [
    { "key": "<echoed key>", "correct": true|false, "reason": "<optional short label>" }
  ]
}
Include one verdict per submission. The verdict's \`key\` MUST match the submission's \`key\` exactly.`;

/**
 * Build the judge prompt covering every freeform question in the batch with its
 * pending submissions. Submissions with deterministic numeric keys so the model
 * can echo them back and we can map verdicts to rows unambiguously.
 *
 * Empty-submission questions are skipped — they contribute nothing to the body.
 */
export function buildJudgePrompt(groups: JudgeQuestionGroup[]): JudgePrompt {
  const usable = groups.filter((g) => g.submissions.length > 0);
  const lines: string[] = ["Judge the following trivia submissions.\n"];

  usable.forEach((group, qIdx) => {
    const q = group.question;
    lines.push(`---`);
    lines.push(`Question ${qIdx + 1}: ${q.statement}`);
    lines.push(`Expected answer: ${q.expectedAnswer ?? "(missing)"}`);
    if (q.acceptableAnswers && q.acceptableAnswers.length > 0) {
      lines.push(`Acceptable variants: ${q.acceptableAnswers.join(" | ")}`);
    }
    if (q.gradingNotes && q.gradingNotes.length > 0) {
      lines.push(`Notes: ${q.gradingNotes}`);
    }
    lines.push(`Submissions:`);
    for (const sub of group.submissions) {
      lines.push(`  [${sub.key}] ${sub.userId}: ${JSON.stringify(sub.answerText)}`);
    }
    lines.push("");
  });

  lines.push("Return ONLY the JSON object described in the system prompt.");

  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: lines.join("\n") }],
  };
}

/**
 * Parse the judge's JSON response. Throws on malformed output. The caller is
 * responsible for catching and retrying / falling back to `correct: false,
 * reason: "judge-error"` if parsing fails.
 */
export function parseJudgeResponse(text: string): JudgeVerdict[] {
  // The model is instructed to emit pure JSON; strip a stray code fence
  // defensively to be tolerant of "```json\n…\n```" framing.
  const trimmed = stripCodeFence(text.trim());
  const parsed: unknown = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== "object" || !("verdicts" in parsed)) {
    throw new Error("Judge response missing 'verdicts' field");
  }
  const verdicts = (parsed as { verdicts: unknown }).verdicts;
  if (!Array.isArray(verdicts)) {
    throw new Error("Judge response 'verdicts' is not an array");
  }
  const out: JudgeVerdict[] = [];
  for (const v of verdicts) {
    if (v === null || typeof v !== "object") {
      throw new Error("Judge verdict entry is not an object");
    }
    const obj = v as { key?: unknown; correct?: unknown; reason?: unknown };
    if (typeof obj.key !== "string" || typeof obj.correct !== "boolean") {
      throw new Error("Judge verdict entry missing 'key' / 'correct'");
    }
    const entry: JudgeVerdict = { key: obj.key, correct: obj.correct };
    if (typeof obj.reason === "string") entry.reason = obj.reason;
    out.push(entry);
  }
  return out;
}

function stripCodeFence(s: string): string {
  if (s.startsWith("```")) {
    const firstNewline = s.indexOf("\n");
    if (firstNewline !== -1) {
      const inner = s.slice(firstNewline + 1);
      const closing = inner.lastIndexOf("```");
      if (closing !== -1) return inner.slice(0, closing).trim();
    }
  }
  return s;
}

/**
 * Default Haiku model id used by `process_reveal_answers` for the freeform judge.
 * Centralized here so tests can reference the same constant.
 */
export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001";
