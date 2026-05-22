import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { en, type StringKey } from "./strings/en.js";
import { fr } from "./strings/fr.js";
import { LANGUAGE_METADATA, type Lang } from "./languages.js";

type Vars<S extends string> = S extends `${string}{${infer V}}${infer Rest}`
  ? V | Vars<Rest>
  : never;

type Args<S extends string> = [Vars<S>] extends [never] ? [] : [Record<Vars<S>, string | number>];

const DICTIONARIES: { en: Record<StringKey, string>; fr: Partial<Record<StringKey, string>> } = {
  en,
  fr,
};

const fallbackWarned = new Set<StringKey>();

let testLanguageOverride: Lang | null = null;

function activeLanguage(): Lang {
  if (testLanguageOverride !== null) return testLanguageOverride;
  try {
    return getConfig().language ?? "en";
  } catch {
    return "en";
  }
}

/** Test-only: pin the active language without loading a config. Pass `null` to clear. */
export function _setLanguageOverrideForTesting(lang: Lang | null): void {
  testLanguageOverride = lang;
}

function resolveTemplate(key: StringKey, lang: Lang): string {
  const value = DICTIONARIES[lang][key];
  if (value !== undefined && value !== "") return value;

  if (lang !== "en" && !fallbackWarned.has(key)) {
    fallbackWarned.add(key);
    logger.warn(
      `[i18n] Missing translation for key "${key}" in language "${lang}" — falling back to "en"`,
    );
  }
  return en[key];
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [name, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
}

export function t<K extends StringKey>(key: K, ...args: Args<(typeof en)[K]>): string {
  const template = resolveTemplate(key, activeLanguage());
  const vars = args[0];
  if (!vars) return template;
  return interpolate(template, vars as Record<string, string | number>);
}

export function getActiveLanguageMetadata() {
  return LANGUAGE_METADATA[activeLanguage()];
}

export function _resetFallbackWarnings(): void {
  fallbackWarned.clear();
}
