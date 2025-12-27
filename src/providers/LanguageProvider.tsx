import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
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
const getLocaleFromPath = (pathname: string): string => {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();
  
  if (firstSegment === 'es-es') return 'es-ES';
  if (firstSegment === 'it-it') return 'it-IT';
  
  return DEFAULT_LANGUAGE;
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
  const [currentLanguage, setCurrentLanguage] = useState<string>(DEFAULT_LANGUAGE);

  // Detect language from URL on mount and route changes
  useEffect(() => {
    const detectedLocale = getLocaleFromPath(location.pathname);
    
    if (detectedLocale !== i18n.language) {
      i18n.changeLanguage(detectedLocale);
    }
    
    setCurrentLanguage(detectedLocale);
    document.documentElement.lang = detectedLocale;
    setIsLoading(false);
  }, [location.pathname, i18n]);

  // Load user's saved language preference when authenticated
  useEffect(() => {
    const loadUserLanguage = async () => {
      if (!isAuthenticated || !user?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('clerk_profiles')
          .select('language_preference')
          .eq('id', user.id)
          .single();
        
        if (error || !data?.language_preference) return;
        
        const savedLang = data.language_preference;
        const currentPathLocale = getLocaleFromPath(location.pathname);
        
        // If URL doesn't have a locale but user has a preference, redirect
        if (savedLang !== DEFAULT_LANGUAGE && currentPathLocale === DEFAULT_LANGUAGE) {
          const newPath = generateLocalizedPath(location.pathname, savedLang);
          navigate(newPath, { replace: true });
        }
      } catch (error) {
        console.error('Error loading language preference:', error);
      }
    };
    
    loadUserLanguage();
  }, [isAuthenticated, user?.id]);

  const changeLanguage = useCallback(async (lang: string) => {
    if (!LANGUAGES[lang]) return;
    
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
    }
  }, [i18n, isAuthenticated, user?.id, location.pathname, navigate]);

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
