export const LANGUAGE_STORAGE_KEY = 'dagboard.language';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', htmlLang: 'en' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', nativeLabel: '简体中文', htmlLang: 'zh-CN' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', htmlLang: 'ja' },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((language) => language.code);

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  ja: 'ja',
  'ja-jp': 'ja',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-hans-cn': 'zh-CN',
};

export function isSupportedLanguage(language: string): language is SupportedLanguage {
  return SUPPORTED_LANGUAGE_CODES.includes(language as SupportedLanguage);
}

export function normalizeLanguage(language?: string | null): SupportedLanguage {
  if (!language) {
    return DEFAULT_LANGUAGE;
  }

  if (isSupportedLanguage(language)) {
    return language;
  }

  const normalized = language.toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? LANGUAGE_ALIASES[normalized.split('-')[0]] ?? DEFAULT_LANGUAGE;
}
