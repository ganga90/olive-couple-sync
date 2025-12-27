import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './languages';

// Custom path detector for URL-based locale detection
const PathDetector = {
  name: 'path',
  lookup() {
    const path = window.location.pathname;
    // Check for /es-es/ or /it-it/ at the start of path
    const match = path.match(/^\/(es-es|it-it)(\/|$)/i);
    if (match) {
      // Map URL path to language code
      const pathLang = match[1].toLowerCase();
      if (pathLang === 'es-es') return 'es-ES';
      if (pathLang === 'it-it') return 'it-IT';
    }
    return null;
  },
  cacheUserLanguage() {
    // We don't cache from path, let the provider handle persistence
  }
};

const languageDetector = new LanguageDetector();
languageDetector.addDetector(PathDetector);

i18n
  .use(HttpBackend)
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: Object.keys(SUPPORTED_LANGUAGES),
    fallbackLng: DEFAULT_LANGUAGE,
    ns: ['common', 'home', 'landing', 'profile', 'notes', 'onboarding', 'lists', 'reminders', 'calendar', 'auth'],
    defaultNS: 'common',
    detection: {
      order: ['path', 'localStorage', 'navigator'],
      lookupLocalStorage: 'olive_language',
      caches: ['localStorage']
    },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json'
    },
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;
