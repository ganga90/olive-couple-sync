/**
 * Soul Proposals — backend helper for major-change confirmation flow
 * ====================================================================
 * When `olive-soul-evolve` detects an `is_major=true` change, it calls
 * `proposeMajorChange()` here instead of silently dropping the diff.
 * The proposal lands in `olive_soul_change_proposals` and a notification
 * is written into `olive_trust_notifications` so the user's web app
 * surfaces an approval card.
 *
 * Why a helper, not a function-to-function call?
 *   Same reason as `_shared/trust-gate-check.ts`: the edge functions
 *   that own user-facing flows (`olive-soul-safety`) parse Clerk JWTs.
 *   Service-role calls from `olive-soul-evolve` don't have a Clerk
 *   `sub` to parse. Direct DB ops keep the code path simple, fast,
 *   and free of auth gymnastics.
 *
 * Approval/rejection happens via `olive-soul-safety/{approve_change,
 * reject_change}` — those endpoints live there because the user
 * (browser or mobile app) needs to authenticate as themselves.
 *
 * Behavior contracts:
 *   - **Idempotent within a single layer cycle.** Two propose calls for
 *     the same `(user_id, layer_type, base_version, summary)` will
 *     produce two rows. The caller (soul-evolve) is expected to
 *     deduplicate before calling.
 *   - **Fail-soft on the notification.** If the notification insert
 *     fails, the proposal still exists (the user can find it via
 *     `list_pending_proposals`); a notification failure must not
 *     poison soul evolution.
 *   - **No retry.** A proposal insert failure returns
 *     `{ ok: false, error }` and the caller decides whether to skip
 *     this evolution cycle or fall back to deferred-log behavior.
 */

export type ProposalLayerType = "user" | "space" | "trust";

export type ProposalTrigger =
  | "pattern_detection"
  | "engagement_decay"
  | "feedback"
  | "reflection"
  | "trust_escalation"
  | "industry_shift"
  | "manual"
  | "system";

export interface ProposeMajorChangeParams {
  userId: string;
  layerType: ProposalLayerType;
  /** Full new content for the layer once approved. NOT a diff. */
  proposedContent: Record<string, unknown>;
  /** Human-readable summary surfaced to the user. */
  summary: string;
  trigger: ProposalTrigger;
  /** Skip notification insert (e.g. for tests, or callers that handle UX themselves). */
  skipNotification?: boolean;
}

export interface ProposeMajorChangeResult {
  ok: boolean;
  proposal_id?: string;
  expires_at?: string;
  /** When status='stale' immediately because base version couldn't be read. */
  reason?: string;
  error?: string;
}

/**
 * Read the current version for the layer. We need this to seal the
 * proposal's `base_version` so concurrent evolutions can be detected
 * at approval time.
 */
async function readCurrentLayerVersion(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  layerType: ProposalLayerType,
  userId: string
): Promise<number | null> {
  const ownerType = layerType === "trust" || layerType === "user" ? "user" : "space";
  const { data } = await supabase
    .from("olive_soul_layers")
    .select("version")
    .eq("layer_type", layerType)
    .eq("owner_type", ownerType)
    .eq("owner_id", userId)
    .maybeSingle();
  return (data?.version as number) ?? null;
}

/**
 * Top-level entry point. Inserts the proposal row, then best-effort
 * inserts the notification row. Caller (soul-evolve) reads the result
 * and updates its own counters.
 */
export async function proposeMajorChange(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: ProposeMajorChangeParams
): Promise<ProposeMajorChangeResult> {
  const {
    userId,
    layerType,
    proposedContent,
    summary,
    trigger,
    skipNotification = false,
  } = params;

  if (!userId || !layerType || !summary) {
    return { ok: false, reason: "missing_required_params" };
  }

  try {
    // 1. Read current version. If the layer doesn't exist yet, treat
    // as version=0 so the proposal can still apply (upsertSoulLayer
    // will create it).
    const baseVersion = (await readCurrentLayerVersion(supabase, layerType, userId)) ?? 0;

    // 2. Insert the proposal.
    const { data: inserted, error: insertErr } = await supabase
      .from("olive_soul_change_proposals")
      .insert({
        user_id: userId,
        layer_type: layerType,
        proposed_content: proposedContent,
        summary,
        trigger,
        base_version: baseVersion,
        // status, expires_at, created_at all use defaults
      })
      .select("id, expires_at")
      .single();

    if (insertErr || !inserted) {
      console.warn("[soul-proposals] insert failed:", insertErr);
      return {
        ok: false,
        error: insertErr?.message || "insert_failed",
        reason: "insert_failed",
      };
    }

    // 3. Best-effort notification — UI surface for the approval card.
    // Failure is non-fatal; the proposal still exists and can be
    // surfaced via list_pending_proposals.
    if (!skipNotification) {
      try {
        await supabase.from("olive_trust_notifications").insert({
          user_id: userId,
          type: "soul_change_proposal",
          title: "🌿 Olive wants to evolve",
          body: summary,
          metadata: {
            proposal_id: inserted.id,
            layer_type: layerType,
            trigger,
          },
        });
      } catch (notifErr) {
        console.warn("[soul-proposals] notification insert failed (non-blocking):", notifErr);
      }
    }

    return {
      ok: true,
      proposal_id: inserted.id as string,
      expires_at: inserted.expires_at as string,
    };
  } catch (err) {
    console.warn("[soul-proposals] unexpected error:", err);
    return {
      ok: false,
      error: String(err),
      reason: "exception",
    };
  }
}
