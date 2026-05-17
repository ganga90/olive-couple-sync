// WhatsApp outbound-context retrieval helpers.
//
// Why this module exists
//   Extracted from supabase/functions/whatsapp-webhook/index.ts
//   (TASK-10X-Phase8c). The three helpers + RecentOutbound interface
//   form a cohesive read-only layer: given a user, fetch what Olive
//   last said to them via WhatsApp (a reminder, briefing, nudge, or
//   recap), parse the task it referred to, and look up the task_id
//   if one was stored. That context turns bare replies like "done"
//   or "snooze" into actions on the correct task.
//
// Three functions, one shape
//   getRecentOutboundMessages — reads multiple sources in priority
//       order: clerk_profiles.last_outbound_context (primary —
//       written by the gateway after every send), olive_outbound_queue
//       (queue-driven sends), olive_heartbeat_log (proactive cron
//       sends). Returns up to 5 messages from the last 60 minutes,
//       most recent first.
//   extractTaskFromOutbound — pure string parser that recovers the
//       task title from a reminder/briefing/nudge body. No DB calls.
//   getOutboundContextWithTaskId — fast path for the most reliable
//       case: when send-reminders stored the actual task_id alongside
//       the outbound message, we can skip text parsing entirely.
//
// Contract
//   * Every function is fail-soft: errors are logged with a [Context]
//     prefix and degrade to null/[] rather than throwing. A
//     context-fetch failure must not block the user's incoming
//     message from being handled.
//   * 60-minute freshness window is shared across all three helpers
//     and intentional — outbound context older than that is more
//     likely to confuse the AI than help it.
//
// Reusability
//   Future entry points (the in-development group webhook, the voice
//   pipeline, the planned email channel) can import these helpers
//   to participate in the same context-aware reply resolution
//   without duplicating the DB queries.

export interface RecentOutbound {
  type: string;        // 'reminder' | 'morning_briefing' | 'proactive_nudge' | etc.
  content: string;     // The message content sent to the user
  sent_at: string;     // ISO timestamp
  source: 'queue' | 'heartbeat';
}

export interface OutboundTaskContext {
  task_id: string;
  task_summary: string;
  all_task_ids?: Array<{ id: string; summary: string }>;
}

// deno-lint-ignore no-explicit-any -- supabase-js v2 client bleeds `any` via createClient
export async function getRecentOutboundMessages(supabase: any, userId: string): Promise<RecentOutbound[]> {
  const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const results: RecentOutbound[] = [];

  try {
    // PRIMARY SOURCE: Read last_outbound_context from clerk_profiles.
    // This is the most reliable source — stored directly by the gateway
    // after sending.
    const { data: profile, error: profileErr } = await supabase
      .from('clerk_profiles')
      .select('last_outbound_context')
      .eq('id', userId)
      .single();

    if (profileErr) {
      console.log('[Context] Profile query error:', profileErr.message);
    }

    if (profile?.last_outbound_context) {
      const ctx = profile.last_outbound_context;
      const sentAt = ctx.sent_at || '';
      // Skip error replies — they carry no useful conversational
      // context and would confuse the AI in the next turn (e.g.,
      // "Sorry, I had trouble...")
      if (ctx.is_error || ctx.message_type === 'error') {
        console.log('[Context] Skipping error reply from outbound context');
      } else if (sentAt && new Date(sentAt).getTime() > Date.now() - 60 * 60 * 1000) {
        console.log('[Context] Found outbound context in profile:', ctx.message_type, ctx.content?.substring(0, 80));
        results.push({
          type: ctx.message_type || 'unknown',
          content: ctx.content || '',
          sent_at: sentAt,
          source: 'queue',
        });
      } else {
        console.log('[Context] Profile outbound context is stale (>60min)');
      }
    } else {
      console.log('[Context] No last_outbound_context in profile');
    }

    // SECONDARY: Also check olive_outbound_queue and
    // olive_heartbeat_log (may be empty if the primary path returned
    // a result).
    if (results.length === 0) {
      const { data: queueMsgs } = await supabase
        .from('olive_outbound_queue')
        .select('message_type, content, sent_at')
        .eq('user_id', userId)
        .eq('status', 'sent')
        .gte('sent_at', sixtyMinAgo)
        .order('sent_at', { ascending: false })
        .limit(3);

      if (queueMsgs) {
        // deno-lint-ignore no-explicit-any -- supabase row shape inferred to `any` by client
        for (const msg of queueMsgs as any[]) {
          results.push({
            type: msg.message_type || 'unknown',
            content: msg.content || '',
            sent_at: msg.sent_at,
            source: 'queue',
          });
        }
      }

      const { data: heartbeatMsgs } = await supabase
        .from('olive_heartbeat_log')
        .select('job_type, message_preview, created_at')
        .eq('user_id', userId)
        .eq('status', 'sent')
        .gte('created_at', sixtyMinAgo)
        .order('created_at', { ascending: false })
        .limit(3);

      if (heartbeatMsgs) {
        // deno-lint-ignore no-explicit-any
        for (const msg of heartbeatMsgs as any[]) {
          results.push({
            type: msg.job_type || 'unknown',
            content: msg.message_preview || '',
            sent_at: msg.created_at,
            source: 'heartbeat',
          });
        }
      }
    }
  } catch (e) {
    console.log('[Context] Could not fetch recent outbound:', e);
  }

  // Sort by most recent first
  results.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  return results.slice(0, 5);
}

/**
 * Extract task summary/name from a recent outbound message.
 * Pure string parser — parses reminder, briefing, and nudge formats.
 */
export function extractTaskFromOutbound(message: RecentOutbound): string | null {
  const content = message.content;
  if (!content) return null;

  // Reminder: "⏰ Reminder: "Answer email from CHAI" is due in 24 hours"
  const reminderMatch = content.match(/Reminder:\s*"?([^"""\n]+)"?/i);
  if (reminderMatch) return reminderMatch[1].trim();

  // Reminder alt: "⏰ Reminder: Answer email from CHAI"
  const reminderAlt = content.match(/^⏰\s*Reminder:\s*(.+?)(?:\n|$)/i);
  if (reminderAlt) return reminderAlt[1].replace(/is due.*$/i, '').replace(/["""]/g, '').trim();

  // Nudge: "• Buy Christmas gifts\n"
  const nudgeMatch = content.match(/•\s*(.+?)(?:\n|$)/);
  if (nudgeMatch) return nudgeMatch[1].trim();

  // Briefing numbered: "1. Buy groceries 🔥"
  const briefingMatch = content.match(/\d+\.\s*(.+?)(?:\s*🔥)?\s*(?:\n|$)/);
  if (briefingMatch) return briefingMatch[1].trim();

  return null;
}

/**
 * Get outbound context with task_id (stored by send-reminders).
 * This is the most reliable way to resolve bare replies to reminders:
 * the task_id round-trips through the user's last_outbound_context
 * column instead of needing to be inferred from message text.
 */
// deno-lint-ignore no-explicit-any
export async function getOutboundContextWithTaskId(
  supabase: any,
  userId: string
): Promise<OutboundTaskContext | null> {
  try {
    const { data: profile } = await supabase
      .from('clerk_profiles')
      .select('last_outbound_context')
      .eq('id', userId)
      .single();

    const ctx = profile?.last_outbound_context;
    if (!ctx?.task_id) return null;

    // Only use if sent within last 60 minutes
    const sentAt = ctx.sent_at || '';
    if (sentAt && new Date(sentAt).getTime() < Date.now() - 60 * 60 * 1000) {
      console.log('[Context] Outbound context with task_id is stale (>60min)');
      return null;
    }

    return {
      task_id: ctx.task_id,
      task_summary: ctx.task_summary || '',
      all_task_ids: ctx.all_task_ids || undefined,
    };
  } catch (e) {
    console.error('[Context] Error reading outbound context task_id:', e);
    return null;
  }
}
