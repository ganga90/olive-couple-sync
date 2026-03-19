import { useState } from "react";
import type { PrivacyFilter } from "@/components/PrivacyFilterPills";

/**
 * Returns a privacy filter state for VIEW purposes.
 * 
 * The VIEW filter always defaults to "all" so users see everything
 * (both private and shared items) on page load.
 * 
 * Note: The user's `default_privacy` setting controls the privacy
 * of NEWLY CREATED items, NOT the default view filter.
 */
export const useDefaultPrivacyFilter = () => {
  const [privacyFilter, setPrivacyFilter] = useState<PrivacyFilter>("all");

  return { privacyFilter, setPrivacyFilter, initialized: true };
};
