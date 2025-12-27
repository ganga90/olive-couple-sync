export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  dir: 'ltr' | 'rtl';
  dateLocale: string;
}

export const LANGUAGES: Record<string, Language> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇬🇧',
    dir: 'ltr',
    dateLocale: 'en-US',
  },
  'es-ES': {
    code: 'es-ES',
    name: 'Spanish',
    nativeName: 'Español (España)',
    flag: '🇪🇸',
    dir: 'ltr',
    dateLocale: 'es-ES',
  },
  'it-IT': {
    code: 'it-IT',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    dir: 'ltr',
    dateLocale: 'it-IT',
  },
};

export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = LANGUAGES; // Export the full object for i18n config
export const LOCALE_PATHS = ['es-es', 'it-it']; // Lowercase for URL paths
