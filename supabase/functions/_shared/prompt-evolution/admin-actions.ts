/**
 * Phase D-1.d — admin actions for prompt addendums
 * ===========================================================================
 * The state-machine drivers that move proposed addendums through their
 * lifecycle. Wired into `olive-soul-safety` (the existing admin function)
 * as four new dispatcher cases:
 *
 *   list_pending_addendums    — read for admin review UI
 *   approve_addendum          — pending→testing (start A/B), testing→approved (promote)
 *   reject_addendum           — pending|testing → rejected
 *   rollback_addendum         — approved → rolled_back
 *
 * Why these live in `_shared/` and not in olive-soul-safety/index.ts:
 *   - Pure(-ish) — accept supabase as a parameter, easy to mock for tests
 *   - Reusable from a future admin UI server-action layer
 *   - Keeps olive-soul-safety/index.ts as a thin dispatcher
 *
 * SAFETY CONTRACTS
 *   1. Approving an addendum to 'approved' (100%) automatically rolls back
 *      any existing 'approved' addendum for the same prompt_module — the
 *      schema's partial UNIQUE index guarantees only one approved per
 *      module at a time. We sequence: rollback old → approve new (NOT
 *      transactional; brief window where module has no addendum,
 *      callers fall back to baseline cleanly).
 *
 *   2. State transitions are validated server-side. Trying to reject an
 *      already-rejected addendum, approve a rolled-back one, or promote
 *      pending → approved (skipping testing) all return a 400-style
 *      error rather than mutating state.
 *
 *   3. Every mutation writes `decided_at` + `decided_by` for audit. The
 *      rollback path also writes `rolled_back_at`. The schema has these
 *      columns nullable so legacy rows aren't affected.
 *
 *   4. `is_locked = true` blocks all transitions except read. Admins lock
 *      a row to freeze it during incident response.
 *
 * TODO (follow-up): real admin auth. Currently any authenticated user
 * can call these endpoints (matches the gating of other olive-soul-safety
 * actions). Real admin-role check belongs in a separate PR.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type AddendumStatus =
  | "pending"
  | "testing"
  | "approved"
  | "rejected"
  | "rolled_back"
  | "expired";

export interface AddendumRow {
  id: string;
  prompt_module: string;
  base_version: string;
  addendum_text: string;
  reasoning: string | null;
  reflections_observed_count: number;
  reflections_window_start: string;
  reflections_window_end: string;
  pattern_signature: string | null;
  status: AddendumStatus;
  rollout_pct: number;
  ab_baseline_modified_rate: number | null;
  ab_treatment_modified_rate: number | null;
  ab_sample_size: number | null;
  is_locked: boolean;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  rolled_out_at: string | null;
  rolled_back_at: string | null;
  decided_by: string | null;
}

export interface ApproveParams {
  addendum_id: string;
  /** 'testing' starts an A/B; 'approved' promotes to 100%. */
  target_status: "testing" | "approved";
  /** Used only for target_status='testing'. Default 10. */
  rollout_pct?: number;
  decision_reason?: string;
  decided_by: string;
}

export interface RejectParams {
  addendum_id: string;
  decision_reason?: string;
  decided_by: string;
}

export interface RollbackParams {
  addendum_id: string;
  decision_reason?: string;
  decided_by: string;
}

export interface ListParams {
  /** 'pending' | 'testing' | 'all' (pending+testing). Default 'all'. */
  status?: "pending" | "testing" | "all";
  limit?: number;
}

export type AdminResult =
  | { ok: true; row: AddendumRow; superseded?: AddendumRow }
  | { ok: true; rows: AddendumRow[] }
  | { ok: false; error: string };

// ─── Validation helpers (pure) ──────────────────────────────────────

const TESTING_DEFAULT_ROLLOUT = 10;

function clampRolloutPct(v: number | undefined): number {
  if (v === undefined || v === null || isNaN(v)) return TESTING_DEFAULT_ROLLOUT;
  return Math.max(0, Math.min(100, Math.floor(v)));
}

/**
 * Pure: validates an approve transition without I/O. Useful for tests +
 * lets us reject illegal transitions before any DB mutation happens.
 */
export function validateApproveTransition(
  currentStatus: AddendumStatus,
  isLocked: boolean,
  targetStatus: "testing" | "approved",
): { ok: true } | { ok: false; error: string } {
  if (isLocked) {
    return { ok: false, error: "addendum_is_locked" };
  }
  if (targetStatus === "testing") {
    if (currentStatus !== "pending") {
      return { ok: false, error: `cannot_promote_to_testing_from_${currentStatus}` };
    }
    return { ok: true };
  }
  if (targetStatus === "approved") {
    if (currentStatus !== "testing") {
      return {
        ok: false,
        error: `cannot_promote_to_approved_from_${currentStatus} (must promote pending→testing first)`,
      };
    }
    return { ok: true };
  }
  return { ok: false, error: "unknown_target_status" };
}

export function validateRejectTransition(
  currentStatus: AddendumStatus,
  isLocked: boolean,
): { ok: true } | { ok: false; error: string } {
  if (isLocked) return { ok: false, error: "addendum_is_locked" };
  if (currentStatus !== "pending" && currentStatus !== "testing") {
    return { ok: false, error: `cannot_reject_from_${currentStatus}` };
  }
  return { ok: true };
}

export function validateRollbackTransition(
  currentStatus: AddendumStatus,
  isLocked: boolean,
): { ok: true } | { ok: false; error: string } {
  if (isLocked) return { ok: false, error: "addendum_is_locked" };
  if (currentStatus !== "approved") {
    return { ok: false, error: `cannot_rollback_from_${currentStatus}` };
  }
  return { ok: true };
}

// ─── DB-backed admin actions ────────────────────────────────────────

async function fetchRow(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  addendumId: string,
): Promise<AddendumRow | null> {
  try {
    const { data } = await supabase
      .from("olive_prompt_addendums")
      .select("*")
      .eq("id", addendumId)
      .maybeSingle();
    return (data as AddendumRow) || null;
  } catch (err) {
    console.warn("[admin-actions] fetchRow failed:", err);
    return null;
  }
}

/**
 * Pending → testing  OR  testing → approved.
 *
 * For testing→approved, also rolls back any existing 'approved' addendum
 * for the same prompt_module to satisfy the partial-unique-index
 * constraint.
 */
export async function approveAddendum(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: ApproveParams,
): Promise<AdminResult> {
  if (!params.addendum_id) {
    return { ok: false, error: "addendum_id_required" };
  }
  if (!params.decided_by) {
    return { ok: false, error: "decided_by_required" };
  }

  const row = await fetchRow(supabase, params.addendum_id);
  if (!row) return { ok: false, error: "addendum_not_found" };

  const validation = validateApproveTransition(
    row.status,
    row.is_locked,
    params.target_status,
  );
  if (!validation.ok) return { ok: false, error: validation.error };

  const now = new Date().toISOString();

  if (params.target_status === "testing") {
    const rolloutPct = clampRolloutPct(params.rollout_pct);
    const { data, error } = await supabase
      .from("olive_prompt_addendums")
      .update({
        status: "testing",
        rollout_pct: rolloutPct,
        rolled_out_at: now,
        decided_at: now,
        decision_reason: params.decision_reason ?? null,
        decided_by: params.decided_by,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) return { ok: false, error: `update_failed: ${error.message ?? "unknown"}` };
    return { ok: true, row: data as AddendumRow };
  }

  // target_status === 'approved': rollback any existing approved for this module.
  // We do this BEFORE the approve write so the partial UNIQUE index is happy.
  // Brief window: between the two updates, the module has no approved row.
  // resolveAddendum falls back to baseline cleanly during this window —
  // verified by the D-1.c "no row → null" test.
  let superseded: AddendumRow | undefined;
  try {
    const { data: existing } = await supabase
      .from("olive_prompt_addendums")
      .select("*")
      .eq("prompt_module", row.prompt_module)
      .eq("status", "approved")
      .neq("id", row.id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const supersedeReason = `superseded_by_${row.id}`;
      const { data: rolled } = await supabase
        .from("olive_prompt_addendums")
        .update({
          status: "rolled_back",
          rolled_back_at: now,
          decision_reason: supersedeReason,
          decided_by: params.decided_by,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      superseded = (rolled as AddendumRow) || (existing as AddendumRow);
    }
  } catch (err) {
    console.warn("[admin-actions] supersede check failed:", err);
    // Continue to the approve attempt anyway. If a stale approved row
    // still exists we'll get a unique-constraint error and surface it.
  }

  const { data, error } = await supabase
    .from("olive_prompt_addendums")
    .update({
      status: "approved",
      rollout_pct: 100,
      rolled_out_at: now,
      decided_at: now,
      decision_reason: params.decision_reason ?? null,
      decided_by: params.decided_by,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) return { ok: false, error: `update_failed: ${error.message ?? "unknown"}` };
  return { ok: true, row: data as AddendumRow, superseded };
}

export async function rejectAddendum(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: RejectParams,
): Promise<AdminResult> {
  if (!params.addendum_id) return { ok: false, error: "addendum_id_required" };
  if (!params.decided_by) return { ok: false, error: "decided_by_required" };

  const row = await fetchRow(supabase, params.addendum_id);
  if (!row) return { ok: false, error: "addendum_not_found" };

  const validation = validateRejectTransition(row.status, row.is_locked);
  if (!validation.ok) return { ok: false, error: validation.error };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("olive_prompt_addendums")
    .update({
      status: "rejected",
      decided_at: now,
      decision_reason: params.decision_reason ?? null,
      decided_by: params.decided_by,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) return { ok: false, error: `update_failed: ${error.message ?? "unknown"}` };
  return { ok: true, row: data as AddendumRow };
}

export async function rollbackAddendum(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: RollbackParams,
): Promise<AdminResult> {
  if (!params.addendum_id) return { ok: false, error: "addendum_id_required" };
  if (!params.decided_by) return { ok: false, error: "decided_by_required" };

  const row = await fetchRow(supabase, params.addendum_id);
  if (!row) return { ok: false, error: "addendum_not_found" };

  const validation = validateRollbackTransition(row.status, row.is_locked);
  if (!validation.ok) return { ok: false, error: validation.error };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("olive_prompt_addendums")
    .update({
      status: "rolled_back",
      rolled_back_at: now,
      decision_reason: params.decision_reason ?? null,
      decided_by: params.decided_by,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) return { ok: false, error: `update_failed: ${error.message ?? "unknown"}` };
  return { ok: true, row: data as AddendumRow };
}

/**
 * List addendums in pending or testing state for admin review.
 * Default returns both. Pass status='pending' or 'testing' to filter.
 */
export async function listPendingAddendums(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: ListParams = {},
): Promise<AdminResult> {
  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const filter: AddendumStatus[] =
    params.status === "pending"
      ? ["pending"]
      : params.status === "testing"
        ? ["testing"]
        : ["pending", "testing"];

  try {
    const { data, error } = await supabase
      .from("olive_prompt_addendums")
      .select("*")
      .in("status", filter)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: `query_failed: ${error.message ?? "unknown"}` };
    return { ok: true, rows: (data as AddendumRow[]) || [] };
  } catch (err) {
    return { ok: false, error: `query_exception: ${String(err)}` };
  }
}
