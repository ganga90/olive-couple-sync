/**
 * useOnboardingVersion — read + assign the user's onboarding flow version.
 *
 * Behavior:
 *   1. On mount, fetch the user's `olive_user_preferences.onboarding_version`.
 *   2. If the row exists with a non-default value, return it as-is.
 *   3. If the row is missing, OR the value is the column default ('v1')
 *      AND the user has not already completed onboarding, UPSERT 'v2'
 *      to assign the user to the new flow cohort. The assignment is
 *      sticky — refreshing won't re-roll.
 *   4. While the network round-trip is in flight, return null. Callers
 *      should render a neutral state (the default v1 flow shape works
 *      as a fallback if you must).
 *
 * Why client-side assignment:
 *   The migration (20260426020000_onboarding_version_flag.sql) defaults
 *   to 'v1' so existing users keep their flow. We assign 'v2' here so
 *   the rollout policy lives in one inspectable place, can be changed
 *   without a migration, and can be turned into a percentage rollout
 *   trivially later.
 *
 * Why we only assign for users who haven't completed onboarding:
 *   Returning users (already have notes / onboarding_completed flag)
 *   don't go through the Onboarding route — Root.tsx skips them. So
 *   their version doesn't matter for funnel analysis. Avoiding the
 *   write keeps the v1 cohort representative.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

export type OnboardingVersion = "v1" | "v2";

const ONBOARDING_COMPLETED_KEY = "olive_onboarding_completed";

interface State {
  version: OnboardingVersion | null;
  loading: boolean;
  // True the moment we've assigned 'v2' to a previously-unset user.
  // Lets the caller fire telemetry for the assignment event distinctly
  // from a re-read on subsequent mounts.
  justAssigned: boolean;
}

const initialState: State = {
  version: null,
  loading: true,
  justAssigned: false,
};

export function useOnboardingVersion(): {
  version: OnboardingVersion | null;
  loading: boolean;
  justAssigned: boolean;
} {
  const { user } = useAuth();
  const [state, setState] = useState<State>(initialState);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      // Anonymous: fall back to v1 so the flow shape is deterministic.
      // Onboarding gate in Root.tsx normally prevents anon users from
      // hitting the Onboarding route, but defensively bail to v1.
      setState({ version: "v1", loading: false, justAssigned: false });
      return;
    }

    (async () => {
      // Read current version. Use maybeSingle so a missing row isn't
      // an error — we'll insert in that case.
      const { data: existing, error: readErr } = await supabase
        .from("olive_user_preferences")
        .select("onboarding_version")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (readErr) {
        // Don't block onboarding on a flag-read failure. Default to v1
        // so the user sees a working flow; log the error so we know
        // about it.
        console.warn("[onboarding-version] read error, defaulting to v1:", readErr.message);
        setState({ version: "v1", loading: false, justAssigned: false });
        return;
      }

      const currentVersion = (existing?.onboarding_version as OnboardingVersion | undefined) || null;

      // Has this user already completed onboarding? If yes, do not
      // re-assign — they're returning, the version they saw is locked.
      const alreadyCompleted =
        typeof window !== "undefined" &&
        window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";

      if (currentVersion && currentVersion !== "v1") {
        // Already on a non-default cohort (v2 from a previous mount,
        // or a future v3). Honor it.
        setState({ version: currentVersion, loading: false, justAssigned: false });
        return;
      }

      if (alreadyCompleted) {
        // Returning user with v1 (or default) — keep them as v1.
        setState({ version: "v1", loading: false, justAssigned: false });
        return;
      }

      // Net-new user reaching onboarding. Assign v2.
      const { error: writeErr } = await supabase
        .from("olive_user_preferences")
        .upsert(
          {
            user_id: user.id,
            onboarding_version: "v2",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );

      if (cancelled) return;

      if (writeErr) {
        // Write failed — the user still gets v2 in this session (so
        // their UX is consistent), but the funnel won't know. Log so
        // we can detect rate of write failures via Supabase logs.
        console.warn("[onboarding-version] assign error, using v2 in-session only:", writeErr.message);
        setState({ version: "v2", loading: false, justAssigned: true });
        return;
      }

      setState({ version: "v2", loading: false, justAssigned: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return state;
}
