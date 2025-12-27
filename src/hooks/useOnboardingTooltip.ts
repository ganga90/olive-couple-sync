import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'olive_onboarding_seen';
const APP_INITIALIZED_KEY = 'olive_app_initialized';

interface OnboardingState {
  [key: string]: boolean;
}

// Mark existing users as having seen all onboarding on first run of this feature
function initializeForExistingUsers() {
  try {
    const appInitialized = localStorage.getItem(APP_INITIALIZED_KEY);
    
    if (!appInitialized) {
      // Check if user has any prior app data (indicating they're an existing user)
      const hasExistingData = 
        localStorage.getItem('olive_notes_cache') !== null ||
        localStorage.getItem('clerk-db-jwt') !== null ||
        localStorage.getItem('i18nextLng') !== null;
      
      if (hasExistingData) {
        // Existing user - mark all current onboarding as seen
        const existingOnboarding: OnboardingState = {
          'brain-dump': true,
          'optimize': true,
          'olive-tips': true,
          'google-calendar': true,
          'ask-olive-chat': true,
          'whatsapp-link': true,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existingOnboarding));
      }
      
      // Mark app as initialized for future checks
      localStorage.setItem(APP_INITIALIZED_KEY, Date.now().toString());
    }
  } catch {
    // Ignore localStorage errors
  }
}

// Run initialization once on module load
initializeForExistingUsers();

export function useOnboardingTooltip(featureKey: string) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const state: OnboardingState = stored ? JSON.parse(stored) : {};
      
      if (!state[featureKey]) {
        // Small delay to let the UI settle before showing tooltip
        const timer = setTimeout(() => setIsVisible(true), 500);
        return () => clearTimeout(timer);
      }
    } catch {
      // If localStorage fails, just don't show
    }
  }, [featureKey]);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const state: OnboardingState = stored ? JSON.parse(stored) : {};
      state[featureKey] = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore localStorage errors
    }
  }, [featureKey]);

  const reset = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const state: OnboardingState = stored ? JSON.parse(stored) : {};
      delete state[featureKey];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setIsVisible(true);
    } catch {
      // Ignore localStorage errors
    }
  }, [featureKey]);

  return { isVisible, dismiss, reset };
}
