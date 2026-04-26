/**
 * CalendarJitCard — Just-in-time prompt to connect Google Calendar.
 *
 * Why this exists: TASK-ONB-D dropped the Calendar OAuth step from v2
 * onboarding because asking for it before the user has felt any value
 * is a known retention killer. This card replaces that ask, showing up
 * on the Home page only when the user has earned context for it:
 * they have at least one note with a future due_date but no Google
 * Calendar connection yet.
 *
 * Visibility rules (all must be true):
 *   1. User has a clerk_notes row with `due_date IS NOT NULL` and
 *      due_date >= now() — i.e., a real calendar-able item exists.
 *   2. No row in calendar_connections for this user.
 *   3. The user hasn't dismissed the prompt this session
 *      (sessionStorage key — re-prompt next visit if still unconnected).
 *   4. User is signed in (we have user.id).
 *
 * The prompt is intentionally low-noise: a single inline card, dismissable,
 * with one CTA. We don't block the page or re-prompt aggressively.
 *
 * Telemetry: fires onboarding events (calendar_jit_prompted /
 * calendar_jit_clicked / calendar_jit_dismissed) so the funnel can
 * measure JIT-conversion rate vs the in-onboarding Calendar step it
 * replaces.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Capacitor } from "@capacitor/core";
import { Calendar, X } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { useOnboardingEvent } from "@/hooks/useOnboardingEvent";

const DISMISS_KEY_PREFIX = "olive_calendar_jit_dismissed_";

export const CalendarJitCard: React.FC = () => {
  const { user } = useAuth();
  const fireEvent = useOnboardingEvent();
  // 'eligible' is null while we're still figuring it out, then a bool.
  // We render nothing during the loading window so there's no UI flash.
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Per-user session dismissal — survives until tab close. Fresh tabs
  // re-prompt because the cost of being seen again is low and the
  // value of getting Calendar connected is high.
  const dismissKey = user?.id ? `${DISMISS_KEY_PREFIX}${user.id}` : null;

  useEffect(() => {
    if (!user?.id) {
      setEligible(false);
      return;
    }
    if (dismissKey && sessionStorage.getItem(dismissKey) === "1") {
      setDismissed(true);
      setEligible(false);
      return;
    }

    let cancelled = false;
    (async () => {
      // Two reads in parallel — the page is already loading data, this
      // adds at most one extra round-trip. No edge function needed.
      const nowIso = new Date().toISOString();
      const [{ data: futureNotes }, { data: connections }] = await Promise.all([
        supabase
          .from("clerk_notes")
          .select("id")
          .eq("author_id", user.id)
          .gte("due_date", nowIso)
          .limit(1),
        supabase
          .from("calendar_connections")
          .select("id")
          .eq("user_id", user.id)
          .limit(1),
      ]);
      if (cancelled) return;

      const hasFutureDated = (futureNotes?.length ?? 0) > 0;
      const alreadyConnected = (connections?.length ?? 0) > 0;
      const show = hasFutureDated && !alreadyConnected;
      setEligible(show);

      if (show) {
        fireEvent("calendar_jit_prompted", { surface: "home" });
      }
    })();

    return () => {
      cancelled = true;
    };
    // We deliberately depend only on user.id so the eligibility check
    // runs once per home-page mount per user. Re-checking on every
    // render would thrash the network and cost nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleConnect = async () => {
    if (!user?.id) return;
    setConnecting(true);
    fireEvent("calendar_jit_clicked", { surface: "home" });
    try {
      const isNative = Capacitor.isNativePlatform();
      const origin = isNative
        ? "https://witholive.app"
        : window.location.origin;
      const { data, error } = await supabase.functions.invoke(
        "calendar-auth-url",
        { body: { user_id: user.id, redirect_origin: origin } },
      );
      if (!error && data?.auth_url) {
        window.location.href = data.auth_url;
        return;
      }
    } catch (err) {
      console.warn("[calendar-jit] auth URL fetch failed:", err);
    }
    setConnecting(false);
  };

  const handleDismiss = () => {
    if (dismissKey) sessionStorage.setItem(dismissKey, "1");
    setDismissed(true);
    fireEvent("calendar_jit_dismissed", { surface: "home" });
  };

  if (eligible !== true || dismissed) return null;

  return (
    <Card className="p-4 bg-card/80 border-primary/20 shadow-card animate-fade-up">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Calendar className="h-5 w-5 text-primary" />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-medium text-foreground leading-snug">
              You've got something with a date — want it on your calendar?
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Connect Google Calendar and Olive will add events automatically
              the moment you mention a time.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleConnect}
              disabled={connecting}
              size="sm"
              className="h-8"
            >
              <Calendar className="w-3.5 h-3.5 mr-1.5" />
              {connecting ? "Opening…" : "Connect Google Calendar"}
            </Button>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
};

export default CalendarJitCard;
