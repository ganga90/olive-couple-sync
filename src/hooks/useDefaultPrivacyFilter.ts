import { useState, useEffect } from "react";
import { useDefaultPrivacy } from "@/hooks/useDefaultPrivacy";
import type { PrivacyFilter } from "@/components/PrivacyFilterPills";

/**
 * Returns a privacy filter state that initializes to the user's
 * default privacy setting from their profile.
 * 
 * - If default_privacy = "private" → filter starts as "private"
 * - If default_privacy = "shared"  → filter starts as "shared"
 * - Falls back to "all" while loading
 */
export const useDefaultPrivacyFilter = () => {
  const { defaultPrivacy, loading } = useDefaultPrivacy();
  const [privacyFilter, setPrivacyFilter] = useState<PrivacyFilter>("all");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!loading && !initialized) {
      setPrivacyFilter(defaultPrivacy as PrivacyFilter);
      setInitialized(true);
    }
  }, [loading, defaultPrivacy, initialized]);

  return { privacyFilter, setPrivacyFilter, initialized };
};
