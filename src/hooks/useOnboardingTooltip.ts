import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'olive_onboarding_seen';

interface OnboardingState {
  [key: string]: boolean;
}

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
