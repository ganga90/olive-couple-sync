/**
 * onboarding-soul — Client-side helper to seed Olive's User Soul + augment
 * the Space Soul from onboarding answers.
 *
 * Thin wrapper over the `onboarding-finalize` edge function. Lives here so
 * the call site in Onboarding.tsx stays focused on UI state, and so the
 * payload shape has a single source of truth on the client.
 *
 * This is best-effort: failures are logged but never throw, because a Soul
 * write must never block a user from finishing onboarding.
 */
import { getSupabase } from "@/lib/supabaseClient";

export interface SeedOnboardingSoulParams {
  userId: string;
  spaceId: string | null;
  scope: string | null;
  mentalLoad: string[];
  displayName?: string;
  timezone?: string;
  language?: string;
  partnerName?: string;
}

export async function seedOnboardingSoul(
  params: SeedOnboardingSoulParams
): Promise<{ ok: boolean }> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(
      "onboarding-finalize",
      {
        body: {
          user_id: params.userId,
          space_id: params.spaceId,
          scope: params.scope,
          mental_load: params.mentalLoad,
          display_name: params.displayName,
          timezone: params.timezone,
          language: params.language,
          partner_name: params.partnerName,
        },
      }
    );

    if (error) {
      console.warn("[onboarding-soul] invoke error:", error);
      return { ok: false };
    }

    return { ok: Boolean(data?.ok) };
  } catch (err) {
    console.warn("[onboarding-soul] exception:", err);
    return { ok: false };
  }
}
