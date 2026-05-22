export const SUPPORTED_LANGUAGES = ["en", "fr"] as const;

export type Lang = (typeof SUPPORTED_LANGUAGES)[number];

export interface LanguageMetadata {
  english: string;
  native: string;
}

export const LANGUAGE_METADATA: Record<Lang, LanguageMetadata> = {
  en: { english: "English", native: "English" },
  fr: { english: "French", native: "Français" },
};

export function isSupportedLanguage(value: unknown): value is Lang {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
