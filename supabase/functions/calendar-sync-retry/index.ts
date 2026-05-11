// calendar-sync-retry
// ─────────────────────────────────────────────────────────────────────
// Phase 2.1 — durable retry worker. pg_cron hits this endpoint every
// 2 minutes; the worker claims up to N due rows from
// olive_calendar_sync_queue, re-invokes the original calendar-* edge
// function for each, and updates row state based on the outcome.
//
// Idempotency rules:
//   - The atomic claim RPC uses SELECT...FOR UPDATE SKIP LOCKED, so two
//     simultaneous worker invocations never pick the same row.
//   - Re-invoking calendar-update-event with the same payload produces
//     the same Google event in its end state — Google PATCH is itself
//     idempotent on the resource.
//   - Re-invoking calendar-delete-event after the event was already
//     gone returns sync_status='already_gone', which the worker
//     treats as success.
//
// Tagging: every invocation includes `invoked_from='calendar-sync-retry'`
// so the target function knows not to enqueue ANOTHER retry on a
// further failure (the worker decides retry-or-abandon based on the
// result and the current attempts count).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  claimNextBatch,
  markFailedOrAbandon,
  markSucceeded,
  type CalendarSyncQueueRow,
} from "../_shared/calendar-retry-queue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// How many jobs we'll process per cron tick. Bounded so a backlog spike
// can't run the function past its execution timeout. The queue index
// orders by next_attempt_at so the oldest-due jobs get picked first.
const BATCH_SIZE = 20;

// Statuses on the target function's response that mean "stop retrying."
// Note: 'already_gone' on a delete is a terminal success — the user's
// desired state is reached.
const TERMINAL_SUCCESS = new Set(["updated", "deleted", "created", "already_gone"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let claimed = 0;
  let succeeded = 0;
  let retried = 0;
  let abandoned = 0;

  try {
    const batch = await claimNextBatch(supabase, BATCH_SIZE);
    claimed = batch.length;
    if (claimed === 0) {
      return ok({ claimed: 0, latency_ms: Date.now() - t0 });
    }

    console.log(`[calendar-sync-retry] claimed ${claimed} jobs`);

    // Process serially. Parallelizing would require thinking about
    // whether two retries against the same user can collide (token
    // refresh contention, Google rate limits). Serial is safe and 20
    // jobs at <500ms each fits comfortably inside a function tick.
    for (const row of batch) {
      try {
        const result = await invokeTarget(supabase, row);
        if (TERMINAL_SUCCESS.has(result.sync_status)) {
          await markSucceeded(supabase, row.id, {
            final_status: result.sync_status,
            attempts_used: row.attempts,
          });
          succeeded++;
          console.log(
            `[calendar-sync-retry] ✓ ${row.action} ${row.id} → ${result.sync_status} (attempt ${row.attempts})`,
          );
        } else {
          const decision = await markFailedOrAbandon(supabase, row, {
            sync_status: result.sync_status,
            error: result.error,
            http_status: result.http_status,
          });
          if (decision.retrying) {
            retried++;
            console.log(
              `[calendar-sync-retry] ↻ ${row.action} ${row.id} → ${result.sync_status} (next: ${decision.nextAttemptAt})`,
            );
          } else {
            abandoned++;
            console.warn(
              `[calendar-sync-retry] ✗ ${row.action} ${row.id} ABANDONED → ${result.sync_status}`,
            );
          }
        }
      } catch (err) {
        // Worker-side exception (network glitch hitting the target
        // function, JSON parse, etc.) — treat as a transient failure
        // and let the queue's regular retry path handle it.
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[calendar-sync-retry] worker error on ${row.id}:`, errMsg);
        const decision = await markFailedOrAbandon(supabase, row, {
          sync_status: "invoke_failed",
          error: errMsg,
        });
        if (decision.retrying) retried++;
        else abandoned++;
      }
    }

    return ok({
      claimed,
      succeeded,
      retried,
      abandoned,
      latency_ms: Date.now() - t0,
    });
  } catch (err) {
    console.error("[calendar-sync-retry] unhandled:", err);
    return ok(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        claimed,
        succeeded,
        retried,
        abandoned,
      },
      500,
    );
  }
});

interface TargetResult {
  sync_status: string;
  error?: string;
  http_status?: number;
}

async function invokeTarget(
  supabase: SupabaseClient,
  row: CalendarSyncQueueRow,
): Promise<TargetResult> {
  const fnName = row.action === "delete"
    ? "calendar-delete-event"
    : row.action === "create"
    ? "calendar-create-event"
    : "calendar-update-event";

  const body = {
    ...row.payload,
    invoked_from: "calendar-sync-retry",
  };

  const { data, error } = await supabase.functions.invoke(fnName, { body });
  if (error) {
    return { sync_status: "invoke_failed", error: error.message };
  }
  return {
    sync_status: (data?.sync_status as string) || "invoke_failed",
    error: data?.error,
    http_status: data?.http_status,
  };
}

function ok(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
