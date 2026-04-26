import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGE_CODES,
  normalizeLanguage,
  type SupportedLanguage,
} from './languages';
import { resources } from './resources';

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function detectInitialLanguage(): SupportedLanguage {
  const storage = safeLocalStorage();
  const storedLanguage = storage?.getItem(LANGUAGE_STORAGE_KEY);

  if (storedLanguage) {
    return normalizeLanguage(storedLanguage);
  }

  if (typeof navigator !== 'undefined') {
    return normalizeLanguage(navigator.language);
  }

  return DEFAULT_LANGUAGE;
}

function syncDocumentLanguage(language: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = normalizeLanguage(language);
}

function persistLanguage(language: string): void {
  const normalizedLanguage = normalizeLanguage(language);
  safeLocalStorage()?.setItem(LANGUAGE_STORAGE_KEY, normalizedLanguage);
  syncDocumentLanguage(normalizedLanguage);
}

const initialLanguage = detectInitialLanguage();

syncDocumentLanguage(initialLanguage);

i18n.on('languageChanged', persistLanguage);

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGE_CODES,
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
  returnNull: false,
});

export function changeLanguage(language: SupportedLanguage): Promise<unknown> {
  return i18n.changeLanguage(language);
}

export * from './catalog';
export * from './languages';
export { resources };
export default i18n;

