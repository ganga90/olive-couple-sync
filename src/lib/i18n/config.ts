import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './languages';

// Custom path detector that reads from URL
const pathDetector = {
  name: 'pathDetector',
  lookup() {
    const pathname = window.location.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const firstSegment = segments[0]?.toLowerCase();
    
    // Map URL paths to language codes
    if (firstSegment === 'es-es') return 'es-ES';
    if (firstSegment === 'it-it') return 'it-IT';
    
    return DEFAULT_LANGUAGE;
  },
  cacheUserLanguage() {
    // We rely on URL, no caching needed
  }
};

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    ns: ['common', 'home', 'landing', 'profile', 'notes', 'onboarding'],
    defaultNS: 'common',
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // React already protects against XSS
    },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    detection: {
      order: ['pathDetector', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'olive_language',
    },
    react: {
      useSuspense: false,
    },
  });

// Register custom detector
const languageDetector = i18n.services.languageDetector as any;
if (languageDetector && languageDetector.addDetector) {
  languageDetector.addDetector(pathDetector);
}

export default i18n;
