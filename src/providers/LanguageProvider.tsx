import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, DEFAULT_LANGUAGE, LOCALE_PATHS } from '@/lib/i18n/languages';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

interface LanguageContextType {
  currentLanguage: string;
  changeLanguage: (lang: string) => Promise<void>;
  getLocalizedPath: (path: string) => string;
  stripLocalePath: (path: string) => string;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

// Detect locale from URL path
const getLocaleFromPath = (pathname: string): string | null => {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();
  
  if (firstSegment === 'es-es') return 'es-ES';
  if (firstSegment === 'it-it') return 'it-IT';
  
  // Return null to indicate no locale in URL (not English)
  return null;
};

// Strip locale prefix from path
const stripLocaleFromPath = (pathname: string): string => {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();
  
  if (LOCALE_PATHS.includes(firstSegment)) {
    return '/' + segments.slice(1).join('/') || '/';
  }
  
  return pathname;
};

// Generate localized path
const generateLocalizedPath = (pathname: string, locale: string): string => {
  // Remove any existing locale prefix first
  const cleanPath = stripLocaleFromPath(pathname);
  
  // English doesn't need a prefix
  if (locale === DEFAULT_LANGUAGE) {
    return cleanPath;
  }
  
  // Add locale prefix (lowercase for URL)
  const localePrefix = locale.toLowerCase();
  return `/${localePrefix}${cleanPath === '/' ? '' : cleanPath}`;
};

interface LanguageProviderProps {
  children: React.ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [currentLanguage, setCurrentLanguage] = useState<string>(() => {
    // Initialize from localStorage for immediate hydration
    const saved = localStorage.getItem('olive_language');
    return saved && LANGUAGES[saved] ? saved : DEFAULT_LANGUAGE;
  });
  const initialLoadDone = useRef(false);
  const isChangingLanguage = useRef(false);

  // Load and apply language on mount - prioritize: URL > DB > localStorage > default
  useEffect(() => {
    const initializeLanguage = async () => {
      if (initialLoadDone.current) return;
      
      // 1. Check URL for locale
      const urlLocale = getLocaleFromPath(location.pathname);
      
      if (urlLocale) {
        // URL has explicit locale - use it and save
        await applyLanguage(urlLocale, false);
        localStorage.setItem('olive_language', urlLocale);
        initialLoadDone.current = true;
        setIsLoading(false);
        return;
      }
      
      // 2. Check localStorage
      const savedLang = localStorage.getItem('olive_language');
      
      // 3. If authenticated, check database (might override localStorage)
      if (isAuthenticated && user?.id) {
        try {
          const { data } = await supabase
            .from('clerk_profiles')
            .select('language_preference')
            .eq('id', user.id)
            .single();
          
          if (data?.language_preference && LANGUAGES[data.language_preference]) {
            await applyLanguage(data.language_preference, true);
            localStorage.setItem('olive_language', data.language_preference);
            initialLoadDone.current = true;
            setIsLoading(false);
            return;
          }
        } catch (error) {
          console.error('Error loading language preference:', error);
        }
      }
      
      // 4. Use localStorage saved language
      if (savedLang && LANGUAGES[savedLang]) {
        await applyLanguage(savedLang, true);
        initialLoadDone.current = true;
        setIsLoading(false);
        return;
      }
      
      // 5. Use default
      await applyLanguage(DEFAULT_LANGUAGE, false);
      initialLoadDone.current = true;
      setIsLoading(false);
    };
    
    initializeLanguage();
  }, [isAuthenticated, user?.id]);

  // Apply language and optionally redirect to localized URL
  const applyLanguage = async (lang: string, shouldRedirect: boolean) => {
    if (!LANGUAGES[lang]) return;
    
    await i18n.changeLanguage(lang);
    setCurrentLanguage(lang);
    document.documentElement.lang = lang;
    
    if (shouldRedirect) {
      const currentPath = location.pathname;
      const newPath = generateLocalizedPath(currentPath, lang);
      
      if (currentPath !== newPath) {
        navigate(newPath, { replace: true });
      }
    }
  };

  // Handle URL changes - ensure language stays consistent
  useEffect(() => {
    if (!initialLoadDone.current || isChangingLanguage.current) return;
    
    const urlLocale = getLocaleFromPath(location.pathname);
    
    if (urlLocale && urlLocale !== currentLanguage) {
      // URL changed to a different locale - sync state
      i18n.changeLanguage(urlLocale);
      setCurrentLanguage(urlLocale);
      document.documentElement.lang = urlLocale;
      localStorage.setItem('olive_language', urlLocale);
    } else if (!urlLocale && currentLanguage !== DEFAULT_LANGUAGE) {
      // URL has no locale but we have a non-default language - redirect to localized URL
      const newPath = generateLocalizedPath(location.pathname, currentLanguage);
      if (location.pathname !== newPath) {
        navigate(newPath, { replace: true });
      }
    }
  }, [location.pathname]);

  const changeLanguage = useCallback(async (lang: string) => {
    if (!LANGUAGES[lang] || lang === currentLanguage) return;
    
    isChangingLanguage.current = true;
    setIsLoading(true);
    
    try {
      // Update i18n
      await i18n.changeLanguage(lang);
      setCurrentLanguage(lang);
      document.documentElement.lang = lang;
      
      // Save to localStorage
      localStorage.setItem('olive_language', lang);
      
      // Save to database if authenticated
      if (isAuthenticated && user?.id) {
        await supabase
          .from('clerk_profiles')
          .update({ language_preference: lang })
          .eq('id', user.id);
      }
      
      // Navigate to new localized URL
      const newPath = generateLocalizedPath(location.pathname, lang);
      navigate(newPath, { replace: true });
      
    } catch (error) {
      console.error('Error changing language:', error);
    } finally {
      setIsLoading(false);
      isChangingLanguage.current = false;
    }
  }, [i18n, isAuthenticated, user?.id, location.pathname, navigate, currentLanguage]);

  const getLocalizedPath = useCallback((path: string) => {
    return generateLocalizedPath(path, currentLanguage);
  }, [currentLanguage]);

  const stripLocalePath = useCallback((path: string) => {
    return stripLocaleFromPath(path);
  }, []);

  return (
    <LanguageContext.Provider 
      value={{ 
        currentLanguage, 
        changeLanguage, 
        getLocalizedPath,
        stripLocalePath,
        isLoading 
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export default LanguageProvider;
