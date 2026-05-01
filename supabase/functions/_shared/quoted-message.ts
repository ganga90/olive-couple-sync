/**
 * Quoted-message resolver for WhatsApp follow-up disambiguation.
 * ==============================================================
 *
 * When the user "replies to" / quotes one of Olive's previous messages,
 * the inbound webhook payload contains `message.context.id` — the WAMID
 * of the quoted message. This is the strongest possible disambiguator:
 * the user is explicitly pointing at a specific past reply, instead of
 * leaving it to "most recent task" heuristics that race when text+image
 * arrive within seconds (the screenshot bug — Block C).
 *
 * `resolveQuotedTask` walks the sliding window stored in
 * `clerk_profiles.last_outbound_context.recent_outbound` (kept by
 * `reply()` in the webhook) and returns the task associated with the
 * matching WAMID, if any.
 *
 * Returns `null` when:
 *   - The user didn't quote a message (caller passes a null WAMID).
 *   - The quoted WAMID is older than the sliding window (typically
 *     10 entries / a few hours of activity).
 *   - The quoted message wasn't task-related (chat reply, search
 *     result, etc.) — we still keep those entries in the window for
 *     chronological completeness, but they don't carry a task_id.
 *
 * Falls back gracefully: returning null leaves the caller's existing
 * resolution path (semantic search, ordinal, "last referenced") fully
 * intact. PR4 only ADDS a higher-priority disambiguator.
 */

export interface QuotedTaskMatch {
  task_id: string;
  task_summary: string;
  sent_at: string;
}

// Typed as `any` to accept the real `SupabaseClient` (whose generic
// signature varies across @supabase/supabase-js versions) and the
// minimal mock used in tests, without requiring a structural-type
// gymnastics that breaks on every version bump. The function only
// touches the documented `from().select().eq().single()` chain at
// runtime.
// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

export async function resolveQuotedTask(
  supabase: SupabaseClientLike,
  userId: string,
  quotedMessageId: string,
): Promise<QuotedTaskMatch | null> {
  if (!quotedMessageId || !userId) return null;

  try {
    const { data: profile } = await supabase
      .from("clerk_profiles")
      .select("last_outbound_context")
      .eq("id", userId)
      .single();

    const window = profile?.last_outbound_context?.recent_outbound;
    if (!Array.isArray(window) || window.length === 0) {
      return null;
    }

    const match = window.find((entry: any) => entry?.wa_message_id === quotedMessageId);
    if (!match || !match.task_id) {
      // Either no entry matches (window doesn't reach back that far) or
      // the matched entry was a non-task message (chat / search / etc.).
      return null;
    }

    return {
      task_id: match.task_id,
      task_summary: match.task_summary || "",
      sent_at: match.sent_at || "",
    };
  } catch {
    // Quote resolution is best-effort. The webhook's other disambiguators
    // (semantic search, recent reminder match, etc.) take over when this
    // returns null, so swallowing errors here is the right move.
    return null;
  }
}
