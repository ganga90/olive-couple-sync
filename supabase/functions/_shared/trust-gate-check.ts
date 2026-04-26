/**
 * Trust Gate — backend-side check helper
 * =========================================
 * Reads the user's trust matrix and either allows the action (level >= 2)
 * or queues it for approval (level 0/1). Designed to be called from edge
 * functions running with service-role credentials.
 *
 * Why not just invoke the `olive-trust-gate` function?
 *   That function parses a Clerk-issued JWT for `sub` to identify the
 *   user. Service-role function-to-function calls don't have a Clerk
 *   sub — they'd 401 at the auth check. This helper does direct DB
 *   reads/writes against the same tables, no inter-function hop, no
 *   auth gymnastics.
 *
 * Trust-level semantics (mirrors olive-trust-gate.ts):
 *   0 INFORM     queue + notify, action does NOT execute
 *   1 SUGGEST    queue + notify, action does NOT execute
 *   2 ACT+REPORT execute immediately, log to user activity
 *   3 AUTONOMOUS execute silently
 *
 * Required level for auto-execution: 2. Anything below queues.
 *
 * Behavior contracts:
 *   - **Fail-soft.** If reading the matrix or writing the queue throws,
 *     return `{ allowed: true, failed_open: true }` so the action
 *     proceeds. A trust gate must never silently drop a user-initiated
 *     action because telemetry was unreachable.
 *   - **Soul-gated.** Users without `soul_enabled = true` skip the
 *     gate entirely (`{ allowed: true, soul_disabled: true }`),
 *     preserving legacy behavior for users who haven't onboarded into
 *     soul yet. Matches the gating pattern in olive-heartbeat
 *     (PR #25) and onboarding-finalize (PR #20).
 *   - **Idempotent on the queue.** Each call inserts a NEW
 *     olive_trust_actions row — duplicate detection is the caller's
 *     responsibility (e.g. if the user re-sends the same partner
 *     message, two queue rows are normal — they'll both expire in 24h
 *     if neither is approved).
 */

export type TrustLevelName = "INFORM" | "SUGGEST" | "ACT_AND_REPORT" | "AUTONOMOUS";

const TRUST_LEVEL_NAMES: Record<number, TrustLevelName> = {
  0: "INFORM",
  1: "SUGGEST",
  2: "ACT_AND_REPORT",
  3: "AUTONOMOUS",
};

/** Minimum trust level that allows an action to execute without approval. */
const REQUIRED_LEVEL_FOR_AUTO_EXEC = 2;

export interface TrustCheckParams {
  userId: string;
  actionType: string; // 'send_whatsapp_to_partner', 'assign_task', etc.
  actionPayload?: Record<string, unknown>;
  /** Human-readable summary for the approval card. */
  actionDescription?: string;
  spaceId?: string | null;
  /** 'reactive' (user just messaged us) | 'proactive' (heartbeat-driven). */
  triggerType?: string;
  triggerContext?: Record<string, unknown>;
}

export interface TrustCheckResult {
  allowed: boolean;
  trust_level: number;
  trust_level_name: TrustLevelName;
  /** Set when the action was queued (allowed=false). Reference for approve/reject. */
  action_id?: string;
  /** True when the user has soul_enabled=false; gate skipped. */
  soul_disabled?: boolean;
  /** True when an internal error caused the gate to fail open. */
  failed_open?: boolean;
  /** Internal breadcrumb for log lines. */
  reason?: string;
}

/**
 * Read the trust_matrix JSONB from the user's trust soul layer.
 * Returns an empty matrix if the layer doesn't exist — the caller
 * will treat unknown actions as INFORM (level 0), which is the
 * conservative default.
 */
async function readTrustMatrix(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("olive_soul_layers")
    .select("content")
    .eq("layer_type", "trust")
    .eq("owner_type", "user")
    .eq("owner_id", userId)
    .maybeSingle();
  return (data?.content?.trust_matrix as Record<string, number>) || {};
}

/**
 * Check whether soul gating is enabled for this user. Mirrors the
 * gating pattern in olive-heartbeat / process-note / etc.
 */
async function isSoulEnabled(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("olive_user_preferences")
      .select("soul_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.soul_enabled === true;
  } catch {
    return false;
  }
}

/**
 * Main entry point. Resolves the trust level for `actionType`, executes
 * if level >= 2, otherwise queues for user approval.
 */
export async function checkTrustForAction(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: TrustCheckParams
): Promise<TrustCheckResult> {
  const {
    userId,
    actionType,
    actionPayload = {},
    actionDescription = `Olive wants to: ${actionType}`,
    spaceId = null,
    triggerType = "reactive",
    triggerContext = {},
  } = params;

  if (!userId || !actionType) {
    return {
      allowed: true,
      trust_level: 3,
      trust_level_name: "AUTONOMOUS",
      failed_open: true,
      reason: "missing_required_params",
    };
  }

  try {
    // 1. Soul off → skip gate entirely. Legacy users keep current behavior.
    const soulOn = await isSoulEnabled(supabase, userId);
    if (!soulOn) {
      return {
        allowed: true,
        trust_level: 3,
        trust_level_name: "AUTONOMOUS",
        soul_disabled: true,
        reason: "soul_disabled",
      };
    }

    // 2. Resolve trust level from matrix.
    const matrix = await readTrustMatrix(supabase, userId);
    const level = matrix[actionType] ?? 0;
    const levelName = TRUST_LEVEL_NAMES[level] || "INFORM";

    // 3. Level high enough → allow, no queue.
    if (level >= REQUIRED_LEVEL_FOR_AUTO_EXEC) {
      return {
        allowed: true,
        trust_level: level,
        trust_level_name: levelName,
      };
    }

    // 4. Level too low → queue + notify.
    const { data: queued, error: insertErr } = await supabase
      .from("olive_trust_actions")
      .insert({
        user_id: userId,
        space_id: spaceId,
        action_type: actionType,
        action_payload: actionPayload,
        action_description: actionDescription,
        trust_level: level,
        required_level: REQUIRED_LEVEL_FOR_AUTO_EXEC,
        trigger_type: triggerType,
        trigger_context: triggerContext,
      })
      .select("id")
      .single();

    if (insertErr || !queued) {
      // Couldn't queue — fail open. Better to send the message than to drop it.
      console.warn("[trust-gate] queue insert failed (failing open):", insertErr);
      return {
        allowed: true,
        trust_level: level,
        trust_level_name: levelName,
        failed_open: true,
        reason: "queue_insert_failed",
      };
    }

    // 5. Best-effort notification — UI surface for the approval card.
    try {
      await supabase.from("olive_trust_notifications").insert({
        user_id: userId,
        type: "action_approval",
        title: level === 0
          ? `Olive wants approval: ${actionDescription}`
          : `Olive suggests: ${actionDescription}`,
        body: level === 0
          ? "I noticed this and wanted to let you know. Want me to proceed?"
          : "I think this would be helpful. Shall I go ahead?",
        metadata: { action_type: actionType, action_id: queued.id, trust_level: level },
        trust_action_id: queued.id,
      });
    } catch (notifErr) {
      // A notification failure shouldn't undo the queue. The user will
      // still see the pending action via the trust-actions list endpoint.
      console.warn("[trust-gate] notification insert failed (non-blocking):", notifErr);
    }

    return {
      allowed: false,
      trust_level: level,
      trust_level_name: levelName,
      action_id: queued.id as string,
    };
  } catch (err) {
    // Any unexpected error → fail open. NEVER silently drop a user action
    // because the gate had a problem.
    console.warn("[trust-gate] checkTrustForAction failed (failing open):", err);
    return {
      allowed: true,
      trust_level: 3,
      trust_level_name: "AUTONOMOUS",
      failed_open: true,
      reason: "exception",
    };
  }
}

/**
 * Convenience predicate: did this check fall back to allow because the
 * gate had an error / soul was off, vs. a real "trust earned" allow?
 * Useful when downstream code wants to log differently for telemetry —
 * e.g. don't credit the user with successful trust escalation if we
 * failed open.
 */
export function isFailSoftOrSoulOff(r: TrustCheckResult): boolean {
  return Boolean(r.failed_open || r.soul_disabled);
}
