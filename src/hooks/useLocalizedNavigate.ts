import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/providers/LanguageProvider';

/**
 * Hook for language-aware navigation
 * Automatically adds the current locale prefix to paths
 */
export const useLocalizedNavigate = () => {
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();
  
  const localizedNavigate = useCallback((
    path: string, 
    options?: { replace?: boolean; state?: any }
  ) => {
    const localizedPath = getLocalizedPath(path);
    navigate(localizedPath, options);
  }, [navigate, getLocalizedPath]);
  
  return localizedNavigate;
};

/**
 * Hook to get a localized link href
 */
export const useLocalizedHref = () => {
  const { getLocalizedPath } = useLanguage();
  return getLocalizedPath;
};
