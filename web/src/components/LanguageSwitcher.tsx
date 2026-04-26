import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, changeLanguage, normalizeLanguage, type SupportedLanguage } from '../i18n';

type LanguageSwitcherProps = {
  className?: string;
};

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const currentLanguage = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

  return (
    <label className={className ?? 'language-switcher'} title={t('languageSwitcher.label')}>
      <Languages size={16} aria-hidden="true" />
      <span>{t('languageSwitcher.label')}</span>
      <select
        aria-label={t('languageSwitcher.label')}
        value={currentLanguage}
        onChange={(event) => {
          void changeLanguage(event.target.value as SupportedLanguage);
        }}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

