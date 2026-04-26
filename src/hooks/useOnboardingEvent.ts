/**
 * useOnboardingEvent — fire-and-forget telemetry hook for the onboarding flow.
 *
 * Writes directly to the `olive_onboarding_events` table via the
 * authenticated Supabase client. RLS enforces that user_id matches the
 * caller — no edge-function hop needed on the hot path.
 *
 * Design choices
 *   - Async fire-and-forget: never blocks the UI, never throws.
 *   - Idempotent flow_started: only emitted once per session via a
 *     local sessionStorage guard (avoids double-counting on re-mount /
 *     React StrictMode dev double-invocation).
 *   - Captures `client_ts` so out-of-order inserts (network jitter) can
 *     still be reconstructed in correct order downstream.
 *   - Errors logged but swallowed. Telemetry must never break onboarding.
 *
 * Usage
 *   const fire = useOnboardingEvent();
 *   fire("beat_started", { beat: "spaceCreate" });
 *   fire("space_created", { beat: "spaceCreate", space_type: "family" });
 *   fire("flow_completed", { duration_seconds: 87 });
 */
import { useCallback, useRef } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

// Mirror the migration's enumerated event types. Keeping this as a
// string-literal union (not an enum) so adding new events is a one-line
// change with no runtime overhead. The DB column is plain TEXT — no
// foreign-key constraint forces consistency, so the type system is the
// only enforcement.
export type OnboardingEvent =
  | "flow_started"
  | "version_assigned"
  | "beat_started"
  | "beat_completed"
  | "beat_skipped"
  | "beat_auto_skipped"
  | "space_created"
  | "soul_seeded"
  | "wa_connected"
  | "calendar_connected"
  | "capture_sent"
  | "capture_previewed"
  | "invite_generated"
  | "invite_shared"
  | "flow_completed"
  | "error";

export interface OnboardingEventPayload {
  beat?: string;
  scope?: string | null;
  space_type?: string;
  latency_ms?: number;
  duration_seconds?: number;
  ok?: boolean;
  error?: string;
  // Free-form: callers can add per-event metadata without changing the
  // type. The DB column is JSONB so this round-trips cleanly.
  [key: string]: unknown;
}

const FLOW_STARTED_KEY = "olive_onboarding_flow_started";

export function useOnboardingEvent() {
  const { user } = useAuth();
  // Cache user.id in a ref so the returned `fire` function has a stable
  // identity across re-renders (won't break consumers that put it in
  // useEffect deps).
  const userIdRef = useRef<string | null>(user?.id || null);
  userIdRef.current = user?.id || null;

  return useCallback(
    (event: OnboardingEvent, payload: OnboardingEventPayload = {}) => {
      const userId = userIdRef.current;
      if (!userId) {
        // No-op for anonymous users. The Onboarding gate in Root.tsx
        // ensures we never hit this in normal flows; defensive nonetheless.
        return;
      }

      // flow_started is special: only emit once per user-session. A
      // refresh mid-onboarding shouldn't reset the funnel start time.
      if (event === "flow_started") {
        try {
          if (sessionStorage.getItem(FLOW_STARTED_KEY) === userId) return;
          sessionStorage.setItem(FLOW_STARTED_KEY, userId);
        } catch {
          // sessionStorage unavailable (private mode, SSR) — proceed
          // without the dedup. Worst case: an extra row in the funnel.
        }
      }

      const row = {
        user_id: userId,
        beat: payload.beat ?? null,
        event,
        payload: payload as Record<string, unknown>,
        client_ts: new Date().toISOString(),
      };

      // Fire-and-forget. We intentionally do NOT await — telemetry must
      // never delay UI transitions or trap errors that hurt the user.
      supabase
        .from("olive_onboarding_events")
        .insert(row)
        .then(({ error }) => {
          if (error) {
            // Log only; never re-throw. Failed telemetry is a degraded
            // state, not a broken product.
            console.warn("[onboarding-event] insert failed:", error.message);
          }
        });
    },
    [], // userIdRef is mutable across renders, useCallback deps stay empty
  );
}
