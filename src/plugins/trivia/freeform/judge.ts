import type { ClackSdk } from "../../sdk.js";
import type { JudgeLeniency, TriviaFreeformAnswerShape } from "../core/configTypes.js";
import { DEFAULT_JUDGE_LENIENCY } from "../core/configTypes.js";
import type { TriviaQuestion } from "../core/types.js";
import { isExactMatch } from "./normalize.js";

/** One pending free-form submission to be judged. */
export interface JudgeSubmission {
  userId: string;
  /** The user's typed text (already trimmed at submit time). */
  answerText: string;
}

/**
 * The judge's decision for ONE submission. Unlike the old batch protocol there
 * is no `key` — each submission is judged by its own call, so the verdict maps
 * to the submission positionally. A verdict is ALWAYS a clean boolean; the
 * "missing verdict" failure mode is gone (see `judgeAnswer`).
 */
export interface JudgeVerdict {
  correct: boolean;
  /** Optional short label the model can use, e.g. "multiple-guess" / "out-of-tolerance". */
  reason?: string;
}

/** One submission paired with its verdict, or `null` when the judge could not produce one. */
export interface JudgedSubmission {
  submission: JudgeSubmission;
  /** `null` only when every retry attempt failed — the row is left pending, never scored wrong. */
  verdict: JudgeVerdict | null;
}

export interface JudgePrompt {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Default Haiku model id used by `process_reveal_answers` for the freeform judge.
 * Centralized here so tests can reference the same constant.
 */
export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001";

/** Re-ask budget: how many times to call the judge for ONE answer before giving up. */
export const JUDGE_MAX_ATTEMPTS = 4;

/** Cap on concurrent judge calls when judging a question's submissions. */
export const JUDGE_CONCURRENCY = 6;

const SHARED_RULES = `You are a strict but fair trivia judge. You are given ONE trivia question, its expected answer, and ONE player's typed answer. Decide whether that single answer is correct.

Universal rules (apply to every question):
- Matching is case- and punctuation-insensitive.
- A single answer carrying a qualifier or parenthetical is fine (e.g. "Tokyo, Japan", "Paris (France)", "rock and roll").
- REJECT (reason: "multiple-guess") any answer that hedges between two or more distinct guesses — "Paris or London", "either A or B", "A | B | C" — EVEN IF one of them is correct. The player must commit to ONE answer.
- ACCEPT (correct: true) when the typed answer is the expected answer expressed differently; REJECT (correct: false) when it is materially different.
- When "Acceptable variants" are listed, treat each as an additional fully-correct answer.
- "Notes" (when present) refine your judgment — honor any explicit tolerance or accepted-form guidance there STRICTLY. They never override the expected answer; they only clarify accepted forms.`;

const NAMED_ENTITY_RULES = `This answer names a SPECIFIC ENTITY (a person, character, brand, organization, species, place, or creative work).
- Accept common synonyms, alternative spellings, and reasonable variants.
- LANGUAGE: accept any UNAMBIGUOUS translation of the expected answer (or an acceptable variant) into another language — named entities ("Roman Empire" ↔ "Empire romain", "Tokyo" ↔ "東京" ↔ "Tokio") and common nouns alike. If the rendering could plausibly mean a materially different thing, REJECT it.
- REJECT (reason: "too-broad") an answer so wide it just names a category ("somewhere in Europe" for a city, "a mammal" for a species).`;

// ── Matching-forgiveness fragments ───────────────────────────────────────────
// Named rule fragments composed into per-preset arrays below. The active
// `judgeLeniency` preset selects which fragments the judge prompt carries; they
// govern only HOW LOOSELY a typed answer may match the expected one. They are
// orthogonal to the shape block (which governs value semantics) and never
// override the universal integrity guards in SHARED_RULES (multi-guess,
// too-broad, materially-different). Case- and punctuation-insensitivity is
// already universal in SHARED_RULES, so it is not repeated here.
const SUBSTITUTION_RULE =
  '- Accept interchangeable renderings of the SAME value: a numeral for its spelled-out form and vice-versa ("20" ↔ "Vingt" ↔ "twenty"), and equivalent numeral systems.';
const DECADE_RULE =
  '- When the expected answer is a YEAR, accept the decade form of that same year ("2020s" for "2020").';
const PLURAL_RULE =
  '- Accept singular/plural variants of the expected answer (a trailing "s"/"es", etc.).';
const TYPO_RULE =
  '- Accept minor typos when the intent is unambiguous — ~1 character off for short answers (≤5 chars), up to ~2 for longer ones (e.g. "Pariss"). REJECT (reason: "typo-too-far") when the typo is large enough that the answer becomes ambiguous or could be a different entity ("Pars" → Paris or Mars?).';
const LOOSE_WRITING_RULE =
  '- Be forgiving of extra or missing spacing and punctuation, missing or wrong accents/diacritics, and homophone spellings ("lieux" ↔ "lieues").';
const KNOWS_IT_RULE =
  '- Judge SOLELY whether the player demonstrably KNEW the answer. Ignore spelling, typos, accents, and edit distance entirely. ACCEPT any rendering an informed human would recognize as unmistakably the expected answer — however loosely written ("20 mille lieux sous les mers" for "Vingt mille lieues sous les mers") — PROVIDED it could not plausibly mean a DIFFERENT valid answer. A long, distinctive answer absorbs many slips and stays unambiguous; a short, collision-prone one cannot (REJECT (reason: "typo-too-far") "Pars" → Paris or Mars?).';

const STRICT_FRAGMENTS = [SUBSTITUTION_RULE, DECADE_RULE, PLURAL_RULE];
const STRICT_WITH_TYPOS_FRAGMENTS = [...STRICT_FRAGMENTS, TYPO_RULE, LOOSE_WRITING_RULE];
const LENIENT_FRAGMENTS = [KNOWS_IT_RULE];

/**
 * The matching-forgiveness fragments for each `judgeLeniency` preset. `strict`
 * forgives only structured equivalences; `strict-with-typos` (the default) adds
 * typo + loose-writing tolerance — the prior judge behavior for named-entity
 * answers, now applied across all freeform shapes;
 * `lenient` replaces the micro-rules with a single intent test.
 */
const LENIENCY_PRESETS: Record<JudgeLeniency, string[]> = {
  strict: STRICT_FRAGMENTS,
  "strict-with-typos": STRICT_WITH_TYPOS_FRAGMENTS,
  lenient: LENIENT_FRAGMENTS,
};

const MATCHING_FORGIVENESS_HEADER =
  "Matching forgiveness (how loosely the typed answer may match the expected one):";

const PHRASE_RULES = `This answer is a PHRASE (a quote, idiom, motto, slogan, or line of dialogue).
- Accept any rendition that preserves the wording of the expected phrase: a longer or shorter span of the same quote, minor word-order or punctuation differences, and unambiguous translations.
- Follow any partial-credit or accepted-span guidance in "Notes".
- REJECT only when the wording is materially different, or when the answer hedges between phrases (reason: "multiple-guess").`;

const DATE_RULES = `This answer is a DATE / TIME PERIOD. The player is NEVER required to match the format — only the value.
- TOLERANCE: when the question text or "Notes" state a window (e.g. "within 5 years", "[1995, 2005]", "to the nearest decade"), ACCEPT any single committed value INSIDE that window, INCLUSIVE OF BOTH ENDPOINTS (1995 is inside "[1995, 2005]"). REJECT (reason: "out-of-tolerance") any value outside it, even if close.
- FORMAT-AGNOSTIC: a bare year ("1998"), a decade form ("1990s"), or an explicit range ("1995-1999") are all acceptable as long as the value falls inside the accepted window.
- DATE SPANS: when the event spans more than one decade, EVERY decade the span touches is acceptable.
- REJECT (reason: "too-broad") a sweeping range that any guess would fall into ("between 1900 and 2500").`;

const COUNTABLE_RULES = `This answer is a small COUNT or NUMBER.
- Accept the value whether typed as digits or spelled out ("3" ↔ "three").
- If "Notes" state a numeric tolerance, accept any value inside it (inclusive); otherwise require the exact value.
- REJECT (reason: "too-broad") a sweeping range that any guess would fall into ("between 3 and 600").`;

const OTHER_RULES = `This answer is a short, unambiguous value (e.g. a formula, a score, a measurement, a color, a currency amount, an acronym).
- Accept equivalent forms of the same value (unit-equivalent measurements, "$5" ↔ "5 dollars", upper/lower case).
- REJECT when the value is materially different from the expected answer.`;

const SHAPE_RULES: Record<TriviaFreeformAnswerShape, string> = {
  name: NAMED_ENTITY_RULES,
  place: NAMED_ENTITY_RULES,
  title: NAMED_ENTITY_RULES,
  phrase: PHRASE_RULES,
  date: DATE_RULES,
  countable: COUNTABLE_RULES,
  other: OTHER_RULES,
};

const OUTPUT_RULES = `Output STRICT JSON only — no prose, no explanation, no markdown fences. EXACTLY this shape:
{"correct": true, "reason": "<short label>"}
- "correct" MUST be a boolean (true or false).
- Include a short "reason" label ONLY when correct is false (e.g. "multiple-guess", "too-broad", "typo-too-far", "out-of-tolerance", "materially-different"). Omit "reason" when correct is true.`;

/**
 * Build the per-answer judge prompt, tailored to the question's freeform shape
 * AND its resolved `judgeLeniency` preset. The preset (read from the question's
 * stamp, defaulting to `strict-with-typos` when absent) selects the
 * matching-forgiveness block; the shape selects the value-semantics block. The
 * two are orthogonal and both compose under the universal SHARED_RULES.
 */
export function buildSingleJudgePrompt(question: TriviaQuestion, answerText: string): JudgePrompt {
  const shapeRules = question.freeformAnswerShape
    ? SHAPE_RULES[question.freeformAnswerShape]
    : NAMED_ENTITY_RULES;
  const leniency = question.judgeLeniency ?? DEFAULT_JUDGE_LENIENCY;
  const forgiveness = [MATCHING_FORGIVENESS_HEADER, ...LENIENCY_PRESETS[leniency]].join("\n");
  const system = [SHARED_RULES, "", forgiveness, "", shapeRules, "", OUTPUT_RULES].join("\n");

  const lines: string[] = [
    `Question: ${question.statement}`,
    `Expected answer: ${question.expectedAnswer ?? "(missing)"}`,
  ];
  if (question.acceptableAnswers && question.acceptableAnswers.length > 0) {
    lines.push(`Acceptable variants: ${question.acceptableAnswers.join(" | ")}`);
  }
  if (question.gradingNotes && question.gradingNotes.length > 0) {
    lines.push(`Notes: ${question.gradingNotes}`);
  }
  lines.push(`Player's typed answer: ${JSON.stringify(answerText)}`);
  lines.push("");
  lines.push("Return ONLY the JSON object described in the system prompt.");

  return { system, messages: [{ role: "user", content: lines.join("\n") }] };
}

/**
 * Parse a single-verdict JSON response. Throws when the response is not a clean
 * `{ correct: boolean }` object — the caller re-asks the judge on a throw.
 */
export function parseSingleVerdict(text: string): JudgeVerdict {
  const trimmed = stripCodeFence(text.trim());
  const parsed: unknown = JSON.parse(trimmed);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Judge response is not an object");
  }
  const obj = parsed as { correct?: unknown; reason?: unknown };
  if (typeof obj.correct !== "boolean") {
    throw new Error("Judge response missing boolean 'correct'");
  }
  const verdict: JudgeVerdict = { correct: obj.correct };
  if (typeof obj.reason === "string" && obj.reason.length > 0) verdict.reason = obj.reason;
  return verdict;
}

/**
 * Judge ONE answer, re-asking the model when it returns anything other than a
 * clean yes/no. Resolves to a guaranteed `JudgeVerdict`. Throws ONLY after
 * `maxAttempts` consecutive call-or-parse failures — the caller then leaves the
 * row pending rather than scoring it wrong, so a verdict is never silently lost.
 */
export async function judgeAnswer(
  askClaude: ClackSdk["askClaude"],
  question: TriviaQuestion,
  answerText: string,
  opts: { maxAttempts?: number; logger?: { warn: (msg: string) => void } } = {},
): Promise<JudgeVerdict> {
  // Deterministic exact-match short-circuit: an answer that normalizes equal to
  // the expected answer (or any acceptable variant) is unambiguously correct, so
  // accept it without a model call or the retry loop. Only ever ACCEPTS — a
  // non-match falls through to the model judge unchanged.
  if (isExactMatch(question, answerText)) {
    return { correct: true, reason: "exact-match" };
  }
  const maxAttempts = opts.maxAttempts ?? JUDGE_MAX_ATTEMPTS;
  const prompt = buildSingleJudgePrompt(question, answerText);
  let lastError = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await askClaude({
        model: DEFAULT_JUDGE_MODEL,
        system: prompt.system,
        messages: prompt.messages,
      });
      return parseSingleVerdict(response.text);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      opts.logger?.warn(
        `[trivia:freeform] judge attempt ${attempt}/${maxAttempts} failed: ${lastError}`,
      );
    }
  }
  throw new Error(`judge produced no usable verdict after ${maxAttempts} attempts: ${lastError}`);
}

/**
 * Judge every submission for one question, each via its own `judgeAnswer` call,
 * with bounded concurrency. A submission whose retries are all exhausted comes
 * back with `verdict: null` (the caller leaves it pending) — one stuck row never
 * blocks the rest.
 */
export async function judgeSubmissions(
  askClaude: ClackSdk["askClaude"],
  question: TriviaQuestion,
  submissions: JudgeSubmission[],
  opts: {
    maxAttempts?: number;
    concurrency?: number;
    logger?: { warn: (msg: string) => void };
  } = {},
): Promise<JudgedSubmission[]> {
  const concurrency = opts.concurrency ?? JUDGE_CONCURRENCY;
  return mapWithConcurrency(submissions, concurrency, async (submission) => {
    try {
      const verdict = await judgeAnswer(askClaude, question, submission.answerText, {
        maxAttempts: opts.maxAttempts,
        logger: opts.logger,
      });
      return { submission, verdict };
    } catch (err) {
      opts.logger?.warn(
        `[trivia:freeform] judge gave up on submission from ${submission.userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { submission, verdict: null };
    }
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
