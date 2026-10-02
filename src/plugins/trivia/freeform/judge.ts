import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import type { JudgeLeniency, TriviaFreeformAnswerShape } from "../core/configTypes.js";
import { DEFAULT_JUDGE_LENIENCY } from "../core/configTypes.js";
import type { TriviaQuestion } from "../core/types.js";
import { isExactMatch, normalizeAnswer } from "./normalize.js";

/** One pending free-form submission to be judged. */
export interface JudgeSubmission {
  userId: string;
  /** The user's typed text (already trimmed at submit time). */
  answerText: string;
}

/**
 * The judge's decision for ONE distinct answer. There is no echoed `key` — each
 * distinct answer is judged by its own call and the verdict is paired with its
 * submissions by `judgeSubmissions`. A verdict is ALWAYS a clean boolean (see
 * `judgeAnswer`).
 */
export interface JudgeVerdict {
  correct: boolean;
  /**
   * Optional short label: a rejection cause ("multiple-guess", "out-of-tolerance"),
   * "exact-match" for the deterministic pre-check, or "alternate-solve" when the
   * `evaluate` preset accepts an answer outside the answer key.
   */
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

/** Sonnet-tier model id used for questions stamped `judgeLeniency: "evaluate"`. */
export const EVALUATE_JUDGE_MODEL = "claude-sonnet-5-5";

const JUDGE_INTRO =
  "You are a strict but fair trivia judge. You are given ONE trivia question, its expected answer, and ONE player's typed answer. Decide whether that single answer is correct.";

// ── Universal integrity rules ────────────────────────────────────────────────
// Carried by every preset; no judging basis, forgiveness fragment, or admin
// instruction relaxes them.
const UNIVERSAL_RULES_HEADER = "Universal rules (apply to every question):";
const UNIVERSAL_INTEGRITY_RULES = [
  "- Matching is case- and punctuation-insensitive.",
  '- A single answer carrying a qualifier or parenthetical is fine (e.g. "Tokyo, Japan", "Paris (France)", "rock and roll").',
  '- REJECT (reason: "multiple-guess") any answer that hedges between two or more distinct guesses — "Paris or London", "either A or B", "A | B | C" — EVEN IF one of them is correct. The player must commit to ONE answer.',
];
const ACCEPTABLE_VARIANTS_RULE =
  '- When "Acceptable variants" are listed, treat each as an additional fully-correct answer.';

// ── Judging basis ────────────────────────────────────────────────────────────
// What makes an answer correct. The key-match basis measures the typed answer
// against the answer key; the evaluate basis treats the key as one reference
// solution and also accepts an answer that solves the question on its own.
const KEY_MATCH_BASIS = [
  "- ACCEPT (correct: true) when the typed answer is the expected answer expressed differently; REJECT (correct: false) when it is materially different.",
  ACCEPTABLE_VARIANTS_RULE,
  '- "Notes" (when present) refine your judgment — honor any explicit tolerance or accepted-form guidance there STRICTLY. They never override the expected answer; they only clarify accepted forms.',
];

const EVALUATE_ONE_IDEA_RULE =
  '- ONE IDEA vs HEDGE: near-synonyms naming ONE idea ("Credit/Loan") are ONE answer, not a hedge. Two DISTINCT ideas ("hole or debt") are a hedge — REJECT (reason: "multiple-guess").';

const EVALUATE_BASIS = [
  "Judging basis — the expected answer is a REFERENCE SOLUTION, not the only correct answer. The typed answer is correct when EITHER test passes:",
  '- KEY MATCH: ACCEPT (correct: true) when the typed answer is the expected answer or an acceptable variant, as decided by the "Matching forgiveness" rule below. That rule decides key matches only.',
  '- ALTERNATE SOLVE: ACCEPT (correct: true, reason: "alternate-solve") when the single committed answer is NOT a key match but independently satisfies EVERY clue of the question as stated.',
  '- REJECT (reason: "clue-fails") when ANY clue of the question fails for the typed answer — a partial fit is not a solve.',
  '- REJECT (reason: "stretch") when the fit depends on a stretch: a strained reading of a clue, an unusual sense of a word, or an assumption the question does not state.',
  '- REJECT (reason: "too-broad") when the answer names a category rather than an answer.',
  ACCEPTABLE_VARIANTS_RULE,
  '- "Notes" (when present) refine your judgment — honor any explicit tolerance or accepted-form guidance there STRICTLY.',
].join("\n");

// Under the evaluate basis the shape block describes key matches only, so its
// REJECT clauses are scoped before the block is stated.
const EVALUATE_SHAPE_SCOPE =
  "Answer-type rules — these apply to the KEY MATCH test ONLY. Every ACCEPT / REJECT below decides whether the typed answer matches the expected one; a REJECT below never overrides an ALTERNATE SOLVE acceptance.";

const NAMED_ENTITY_RULES = `This answer names a SPECIFIC ENTITY (a person, character, brand, organization, species, place, or creative work).
- Accept common synonyms, alternative spellings, and reasonable variants.
- LANGUAGE: accept any UNAMBIGUOUS translation of the expected answer (or an acceptable variant) into another language — named entities ("Roman Empire" ↔ "Empire romain", "Tokyo" ↔ "東京" ↔ "Tokio") and common nouns alike. If the rendering could plausibly mean a materially different thing, REJECT it.
- REJECT (reason: "too-broad") an answer so wide it just names a category ("somewhere in Europe" for a city, "a mammal" for a species).`;

// ── Matching-forgiveness fragments ───────────────────────────────────────────
// Named rule fragments composed into per-preset arrays below. The active
// `judgeLeniency` preset selects which fragments the judge prompt carries; they
// govern only HOW LOOSELY a typed answer may match the expected one. They are
// orthogonal to the shape block (which governs value semantics) and never
// override the universal integrity rules or the judging basis. Case- and
// punctuation-insensitivity is already universal, so it is not repeated here.
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

const EVALUATE_OUTPUT_RULES = `Output STRICT JSON only — no prose, no explanation, no markdown fences. EXACTLY this shape:
{"correct": true, "reason": "<short label>"}
- "correct" MUST be a boolean (true or false).
- When correct is false, include a short "reason" label (e.g. "multiple-guess", "too-broad", "typo-too-far", "out-of-tolerance", "clue-fails", "stretch").
- When correct is true through the ALTERNATE SOLVE test (the answer is NOT a key match), include "reason": "alternate-solve".
- When correct is true through a KEY MATCH, omit "reason".`;

const JUDGE_INSTRUCTIONS_HEADING = "Judge instructions (from the game admin):";

const JUDGE_INSTRUCTIONS_LIMITS =
  "Under no circumstances can they disable the universal rules above or change the output format below.";

const KEY_MATCH_INSTRUCTIONS_AUTHORITY = `The user message carries "${JUDGE_INSTRUCTIONS_HEADING}" — guidance written by the game admin. Like "Notes", they refine which forms of the expected answer are accepted; they never override the expected answer. ${JUDGE_INSTRUCTIONS_LIMITS}`;

const EVALUATE_INSTRUCTIONS_AUTHORITY = `The user message carries "${JUDGE_INSTRUCTIONS_HEADING}" — guidance written by the game admin. They may widen or narrow what counts as a fit for this question, and you follow them when applying the judging basis. ${JUDGE_INSTRUCTIONS_LIMITS}`;

/** Everything a `judgeLeniency` preset decides about the judge call. */
interface JudgePreset {
  /** Lines following the universal integrity rules: what makes an answer correct. */
  basis: string[];
  /** How loosely a typed answer may match the expected one. */
  forgiveness: string[];
  /** Stated before the shape block when the basis narrows what that block decides. */
  shapeScope?: string;
  /** How much authority admin `judgeInstructions` carry. */
  instructionsAuthority: string;
  outputRules: string;
  model: string;
}

const KEY_MATCH_PRESET = {
  basis: KEY_MATCH_BASIS,
  instructionsAuthority: KEY_MATCH_INSTRUCTIONS_AUTHORITY,
  outputRules: OUTPUT_RULES,
  model: DEFAULT_JUDGE_MODEL,
};

/**
 * One entry per `judgeLeniency` preset. `strict` forgives only structured
 * equivalences; `strict-with-typos` (the default) adds typo + loose-writing
 * tolerance; `lenient` replaces the micro-rules with a single intent test. Those
 * three judge on the key-match basis with the Haiku judge. `evaluate` judges on
 * the evaluate basis with the Sonnet-tier judge and reuses the intent test for
 * its key-match half.
 */
const JUDGE_PRESETS: Record<JudgeLeniency, JudgePreset> = {
  strict: { ...KEY_MATCH_PRESET, forgiveness: STRICT_FRAGMENTS },
  "strict-with-typos": { ...KEY_MATCH_PRESET, forgiveness: STRICT_WITH_TYPOS_FRAGMENTS },
  lenient: { ...KEY_MATCH_PRESET, forgiveness: LENIENT_FRAGMENTS },
  evaluate: {
    basis: [EVALUATE_ONE_IDEA_RULE, "", EVALUATE_BASIS],
    forgiveness: LENIENT_FRAGMENTS,
    shapeScope: EVALUATE_SHAPE_SCOPE,
    instructionsAuthority: EVALUATE_INSTRUCTIONS_AUTHORITY,
    outputRules: EVALUATE_OUTPUT_RULES,
    model: EVALUATE_JUDGE_MODEL,
  },
};

function presetFor(question: TriviaQuestion): JudgePreset {
  return JUDGE_PRESETS[question.judgeLeniency ?? DEFAULT_JUDGE_LENIENCY];
}

/**
 * Build the per-answer judge prompt, tailored to the question's freeform shape
 * AND its resolved `judgeLeniency` preset. The preset (read from the question's
 * stamp, defaulting to `strict-with-typos` when absent) selects the judging
 * basis and the matching-forgiveness block; the shape selects the
 * value-semantics block. All compose under the universal integrity rules.
 *
 * `judgeInstructions` (admin-authored, resolved by the caller) go in the user
 * message under a labeled heading, and the system prompt states how much
 * authority they carry under the active preset.
 */
export function buildSingleJudgePrompt(
  question: TriviaQuestion,
  answerText: string,
  judgeInstructions?: string,
): JudgePrompt {
  const shapeRules = question.freeformAnswerShape
    ? SHAPE_RULES[question.freeformAnswerShape]
    : NAMED_ENTITY_RULES;
  const preset = presetFor(question);
  const instructions = judgeInstructions?.trim() ?? "";
  const systemParts = [
    JUDGE_INTRO,
    "",
    UNIVERSAL_RULES_HEADER,
    ...UNIVERSAL_INTEGRITY_RULES,
    ...preset.basis,
    "",
    MATCHING_FORGIVENESS_HEADER,
    ...preset.forgiveness,
    "",
    ...(preset.shapeScope !== undefined ? [preset.shapeScope] : []),
    shapeRules,
    "",
  ];
  if (instructions.length > 0) systemParts.push(preset.instructionsAuthority, "");
  systemParts.push(preset.outputRules);
  const system = systemParts.join("\n");

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
  if (instructions.length > 0) {
    lines.push(JUDGE_INSTRUCTIONS_HEADING, instructions);
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
  opts: {
    maxAttempts?: number;
    judgeInstructions?: string;
    logger?: { warn: (msg: string) => void };
  } = {},
): Promise<JudgeVerdict> {
  // Deterministic exact-match short-circuit: an answer that normalizes equal to
  // the expected answer (or any acceptable variant) is unambiguously correct, so
  // accept it without a model call or the retry loop. Only ever ACCEPTS — a
  // non-match falls through to the model judge unchanged.
  if (isExactMatch(question, answerText)) {
    return { correct: true, reason: "exact-match" };
  }
  const maxAttempts = opts.maxAttempts ?? JUDGE_MAX_ATTEMPTS;
  const prompt = buildSingleJudgePrompt(question, answerText, opts.judgeInstructions);
  const { model } = presetFor(question);
  let lastError = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await askClaude({
        model,
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
 * Judge every submission for one question with bounded concurrency. Submissions
 * are grouped by normalized answer text and each DISTINCT answer gets one
 * `judgeAnswer` call, whose verdict is shared by the whole group — the same
 * answer always gets the same verdict within a question. A group whose retries
 * are all exhausted comes back with `verdict: null` on every member (the caller
 * leaves those rows pending) — one stuck group never blocks the rest. The
 * result holds one entry per submission, in input order.
 */
export async function judgeSubmissions(
  askClaude: ClackSdk["askClaude"],
  question: TriviaQuestion,
  submissions: JudgeSubmission[],
  opts: {
    maxAttempts?: number;
    concurrency?: number;
    judgeInstructions?: string;
    logger?: { warn: (msg: string) => void };
  } = {},
): Promise<JudgedSubmission[]> {
  const concurrency = opts.concurrency ?? JUDGE_CONCURRENCY;
  const groups = new Map<string, JudgeSubmission[]>();
  for (const submission of submissions) {
    const key = normalizeAnswer(submission.answerText);
    const group = groups.get(key);
    if (group) group.push(submission);
    else groups.set(key, [submission]);
  }

  const groupVerdicts = await mapWithConcurrency(
    [...groups.entries()],
    concurrency,
    async ([key, group]): Promise<[string, JudgeVerdict | null]> => {
      try {
        const verdict = await judgeAnswer(askClaude, question, group[0].answerText, {
          maxAttempts: opts.maxAttempts,
          judgeInstructions: opts.judgeInstructions,
          logger: opts.logger,
        });
        return [key, verdict];
      } catch (err) {
        opts.logger?.warn(
          `[trivia:freeform] judge gave up on submission from ${group
            .map((s) => s.userId)
            .join(", ")}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [key, null];
      }
    },
  );

  const verdictByKey = new Map(groupVerdicts);
  return submissions.map((submission) => {
    const verdict = verdictByKey.get(normalizeAnswer(submission.answerText)) ?? null;
    return { submission, verdict: verdict ? { ...verdict } : null };
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
