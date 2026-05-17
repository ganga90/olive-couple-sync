// WhatsApp gateway session helpers.
//
// Why this module exists
//   Extracted from supabase/functions/whatsapp-webhook/index.ts
//   (TASK-10X-Phase8b). The monolith had inline `touchGatewaySession`
//   for per-thread message instrumentation. Moving it to _shared/
//   lets other entry points (group webhook in development, voice
//   pipeline) participate in the same telemetry without duplicating
//   the upsert + RPC dance.
//
// Contract
//   * Fire-and-forget: never throws. Every failure path returns null
//     and logs a `[GatewaySession]` warning. A telemetry hiccup must
//     not block message handling.
//   * Idempotent on the session row: select-then-insert (no upsert
//     because there's no unique constraint on (user_id, channel)).
//   * Atomic counter increment via the
//     `increment_gateway_session_message` RPC — avoids TOCTOU races
//     when the same user has two messages in-flight at once.

export interface GatewaySessionCounters {
  messageCount: number;
  totalMessagesEver: number;
}

/**
 * Phase 1-D — WhatsApp thread instrumentation
 * Increment per-thread and lifetime message counters for the user's
 * gateway session. Creates the session row if it doesn't exist (for
 * users that message Olive for the first time via WhatsApp).
 *
 * Returns the new counters so downstream logic can decide when to
 * compact the conversation. Fire-and-forget — failures are logged
 * and swallowed so a telemetry problem never blocks the actual
 * message-handling flow.
 */
// deno-lint-ignore no-explicit-any -- supabase-js v2 client type bleeds `any` via createClient
export async function touchGatewaySession(
  supabase: any,
  userId: string
): Promise<GatewaySessionCounters | null> {
  try {
    // Step 1: Ensure a session row exists. Use select+insert rather
    // than upsert because there's no unique constraint on
    // (user_id, channel).
    const { data: existing } = await supabase
      .from('olive_gateway_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('is_active', true)
      .order('last_activity', { ascending: false })
      .limit(1)
      .maybeSingle();

    let sessionId: string | null = existing?.id ?? null;

    if (!sessionId) {
      const { data: created, error: insertErr } = await supabase
        .from('olive_gateway_sessions')
        .insert({
          user_id: userId,
          channel: 'whatsapp',
          is_active: true,
          conversation_context: {},
        })
        .select('id')
        .single();
      if (insertErr) {
        console.warn('[GatewaySession] Insert failed (non-blocking):', insertErr.message);
        return null;
      }
      sessionId = created.id;
    }

    // Step 2: Atomic increment via RPC (avoids TOCTOU races).
    const { data: incRows, error: rpcErr } = await supabase.rpc(
      'increment_gateway_session_message',
      { p_session_id: sessionId }
    );
    if (rpcErr || !incRows || incRows.length === 0) {
      if (rpcErr) console.warn('[GatewaySession] RPC failed (non-blocking):', rpcErr.message);
      return null;
    }

    const row = incRows[0];
    return {
      messageCount: row.message_count,
      totalMessagesEver: row.total_messages_ever,
    };
  // deno-lint-ignore no-explicit-any -- catch shape from supabase-js
  } catch (err: any) {
    console.warn('[GatewaySession] touchGatewaySession error (non-blocking):', err?.message);
    return null;
  }
}
