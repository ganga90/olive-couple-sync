// useCalendarSyncQueue
// ─────────────────────────────────────────────────────────────────────
// Reads `olive_calendar_sync_queue` for the authenticated user and
// exposes a "Retry now" action that pokes the cron-driven worker out
// of band.
//
// PR 2C closes the last loop in the 2026-05-12 calendar reliability
// story: PR 2's chat suffix promises "I'll keep trying in the
// background" when a transient failure hits. Before this hook, the
// user had no way to verify that promise — they had to trust that
// the cron was actually running. The badge that consumes this hook
// makes the queue's state visible and lets the user trigger a retry
// on demand.
//
// Polling: 30s while there are pending rows, paused when count is 0
// (don't burn cycles polling an empty queue) and when the document
// is hidden (`visibilitychange` listener). Both rules together keep
// the polling cheap and stop it cold when the tab is backgrounded.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/providers/AuthProvider";

// Mirrors the relevant columns from olive_calendar_sync_queue. We
// don't pull the full payload — the badge only needs counts +
// action type + next_attempt_at for the inline list.
export interface CalendarSyncQueueRow {
  id: string;
  action: "create" | "update" | "delete";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
}

interface UseCalendarSyncQueueResult {
  queue: CalendarSyncQueueRow[];
  pendingCount: number;
  loading: boolean;
  retrying: boolean;
  // Returns true on success, false otherwise. Caller is responsible
  // for surfacing the success/failure toast — the hook stays UI-
  // agnostic so it's reusable from any surface (badge, settings,
  // future admin tool).
  retryNow: () => Promise<boolean>;
  refetch: () => Promise<void>;
}

// 30s polling cadence — fast enough that a user clicking "Retry now"
// sees the count drop within one poll, slow enough not to spam.
const POLL_INTERVAL_MS = 30_000;

export function useCalendarSyncQueue(): UseCalendarSyncQueueResult {
  const { user } = useAuth();
  const userId = user?.id;

  const [queue, setQueue] = useState<CalendarSyncQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  // Keep the latest userId in a ref so the visibility listener
  // doesn't re-bind on every render.
  const userIdRef = useRef<string | undefined>(userId);
  userIdRef.current = userId;

  const fetchQueue = useCallback(async () => {
    if (!userIdRef.current) {
      setQueue([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("olive_calendar_sync_queue")
        .select("id, action, attempts, next_attempt_at, last_error")
        .eq("user_id", userIdRef.current)
        .eq("status", "pending")
        .order("next_attempt_at", { ascending: true })
        .limit(20);
      if (error) {
        // RLS rejection or transient DB error — log and bail.
        // We don't surface this to the user; the badge just stays
        // hidden, same as the "no pending rows" case.
        console.warn("[useCalendarSyncQueue] fetch failed:", error.message);
        return;
      }
      setQueue((data || []) as CalendarSyncQueueRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + interval poll. Skips when document is hidden
  // (saves the network round-trip on a backgrounded tab) and when
  // the queue is empty (don't poll for nothing).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let intervalId: number | undefined;

    const run = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      await fetchQueue();
    };

    run();
    // Interval is unconditionally set; the visibility + empty-queue
    // guards inside `run` decide whether to actually do the work.
    // Simpler than dynamically attaching/detaching intervals based on
    // current state, and the cost of an interval tick that no-ops is
    // negligible.
    intervalId = window.setInterval(run, POLL_INTERVAL_MS);

    // Resume polling immediately when the tab comes back to the
    // foreground — without this, a user who switches tabs for 5
    // minutes sees stale data when they come back.
    const onVisibility = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, fetchQueue]);

  const retryNow = useCallback(async (): Promise<boolean> => {
    if (!userIdRef.current || retrying) return false;
    setRetrying(true);
    try {
      // calendar-sync-retry is cron-driven but accepts ad-hoc
      // invocations — it claims due rows from olive_calendar_sync_queue
      // (via the SECURITY DEFINER RPC) and works them. Passing
      // `invoked_from` tags the analytics so we can later distinguish
      // user-triggered retries from scheduled ones.
      const { error } = await supabase.functions.invoke("calendar-sync-retry", {
        body: { invoked_from: "manual-retry-now" },
      });
      if (error) {
        console.warn("[useCalendarSyncQueue] retry-now invoke failed:", error.message);
        return false;
      }
      // Re-fetch after a short delay — the worker needs a moment to
      // process and update queue rows. 1.5s lets fast retries (~500ms
      // each) finish without making the user wait for the full 30s
      // poll. Slow ones will resolve on the next poll cycle.
      setTimeout(() => {
        fetchQueue();
      }, 1500);
      return true;
    } catch (e) {
      console.warn(
        "[useCalendarSyncQueue] retry-now threw:",
        e instanceof Error ? e.message : String(e),
      );
      return false;
    } finally {
      setRetrying(false);
    }
  }, [retrying, fetchQueue]);

  return {
    queue,
    pendingCount: queue.length,
    loading,
    retrying,
    retryNow,
    refetch: fetchQueue,
  };
}
