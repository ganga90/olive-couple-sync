import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './languages';

// Import translation files directly for bundling (avoids HTTP loading issues)
import enCommon from '../../../public/locales/en/common.json';
import enHome from '../../../public/locales/en/home.json';
import enLanding from '../../../public/locales/en/landing.json';
import enProfile from '../../../public/locales/en/profile.json';
import enNotes from '../../../public/locales/en/notes.json';
import enOnboarding from '../../../public/locales/en/onboarding.json';
import enLists from '../../../public/locales/en/lists.json';
import enReminders from '../../../public/locales/en/reminders.json';
import enCalendar from '../../../public/locales/en/calendar.json';
import enAuth from '../../../public/locales/en/auth.json';
import enOrganize from '../../../public/locales/en/organize.json';

import esCommon from '../../../public/locales/es-ES/common.json';
import esHome from '../../../public/locales/es-ES/home.json';
import esLanding from '../../../public/locales/es-ES/landing.json';
import esProfile from '../../../public/locales/es-ES/profile.json';
import esNotes from '../../../public/locales/es-ES/notes.json';
import esOnboarding from '../../../public/locales/es-ES/onboarding.json';
import esLists from '../../../public/locales/es-ES/lists.json';
import esReminders from '../../../public/locales/es-ES/reminders.json';
import esCalendar from '../../../public/locales/es-ES/calendar.json';
import esAuth from '../../../public/locales/es-ES/auth.json';
import esOrganize from '../../../public/locales/es-ES/organize.json';

import itCommon from '../../../public/locales/it-IT/common.json';
import itHome from '../../../public/locales/it-IT/home.json';
import itLanding from '../../../public/locales/it-IT/landing.json';
import itProfile from '../../../public/locales/it-IT/profile.json';
import itNotes from '../../../public/locales/it-IT/notes.json';
import itOnboarding from '../../../public/locales/it-IT/onboarding.json';
import itLists from '../../../public/locales/it-IT/lists.json';
import itReminders from '../../../public/locales/it-IT/reminders.json';
import itCalendar from '../../../public/locales/it-IT/calendar.json';
import itAuth from '../../../public/locales/it-IT/auth.json';
import itOrganize from '../../../public/locales/it-IT/organize.json';

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

// Resources bundled directly for immediate availability
const resources = {
  en: {
    common: enCommon,
    home: enHome,
    landing: enLanding,
    profile: enProfile,
    notes: enNotes,
    onboarding: enOnboarding,
    lists: enLists,
    reminders: enReminders,
    calendar: enCalendar,
    auth: enAuth,
    organize: enOrganize
  },
  'es-ES': {
    common: esCommon,
    home: esHome,
    landing: esLanding,
    profile: esProfile,
    notes: esNotes,
    onboarding: esOnboarding,
    lists: esLists,
    reminders: esReminders,
    calendar: esCalendar,
    auth: esAuth,
    organize: esOrganize
  },
  'it-IT': {
    common: itCommon,
    home: itHome,
    landing: itLanding,
    profile: itProfile,
    notes: itNotes,
    onboarding: itOnboarding,
    lists: itLists,
    reminders: itReminders,
    calendar: itCalendar,
    auth: itAuth,
    organize: itOrganize
  }
};

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: Object.keys(SUPPORTED_LANGUAGES),
    fallbackLng: DEFAULT_LANGUAGE,
    ns: ['common', 'home', 'landing', 'profile', 'notes', 'onboarding', 'lists', 'reminders', 'calendar', 'auth', 'organize'],
    defaultNS: 'common',
    detection: {
      order: ['path', 'localStorage', 'navigator'],
      lookupLocalStorage: 'olive_language',
      caches: ['localStorage']
    },
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;
