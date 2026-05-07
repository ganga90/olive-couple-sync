/**
 * Admin role check for edge-function endpoints.
 * ===============================================
 * Wraps the existing `has_role(p_user_id, p_role)` SECURITY DEFINER SQL
 * function (defined in migration 20260226203138). Use this to gate any
 * endpoint that performs system-wide administrative actions — e.g. the
 * Phase D-1.d prompt-addendum lifecycle endpoints (list / approve /
 * reject / rollback), which mutate the global pool of proposals that
 * can be folded into production prompts.
 *
 * # Differences from trust-gate-check.ts
 *
 * trust-gate-check.ts FAILS OPEN on internal errors — better to send a
 * user-initiated message than drop it because telemetry was unreachable.
 *
 * This helper FAILS CLOSED. An admin gate is the opposite contract:
 * approving a prompt addendum that goes into every Gemini call is
 * destructive at scale, so we never grant access on uncertainty.
 *
 * # Service-role bypass
 *
 * Service-role callers (resolveCallerUserId returns isServiceRole=true)
 * bypass the check. Anyone with the service-role key can already write
 * directly to user_roles to make themselves admin, so the bypass adds
 * no privilege — it just removes a redundant lookup. Matches the
 * service-role pattern in trust-gate.
 *
 * The audit-trail field (`decided_by` on approve/reject/rollback) still
 * comes from the resolved user id, so a service-role caller acting on
 * behalf of an admin records the admin's id, not "system".
 */

export type AdminCheckResult =
  | { ok: true; isServiceRole: boolean }
  | { ok: false; reason: "not_admin" | "lookup_failed" | "missing_user_id" };

/**
 * Returns `{ ok: true }` if the caller may perform an admin action.
 * Returns `{ ok: false, reason }` otherwise — the caller should respond
 * with HTTP 403 in either failure case (the distinction between
 * not_admin / lookup_failed / missing_user_id is for logs, not for
 * disclosure to the requester).
 *
 * @param supabase — service-role Supabase client (RPCs run with elevated
 *                   privilege via SECURITY DEFINER on has_role)
 * @param userId — the resolved acting user id (from edge-auth.ts)
 * @param isServiceRole — true if the bearer token was a service-role JWT
 */
export async function requireAdmin(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  isServiceRole: boolean,
): Promise<AdminCheckResult> {
  if (isServiceRole) {
    return { ok: true, isServiceRole: true };
  }
  if (!userId || typeof userId !== "string") {
    return { ok: false, reason: "missing_user_id" };
  }
  try {
    const { data, error } = await supabase.rpc("has_role", {
      p_user_id: userId,
      p_role: "admin",
    });
    if (error) {
      // RPC reached the DB but returned an error — fail closed.
      console.warn(
        "[admin-check] has_role RPC error (failing closed):",
        error,
      );
      return { ok: false, reason: "lookup_failed" };
    }
    if (data === true) {
      return { ok: true, isServiceRole: false };
    }
    return { ok: false, reason: "not_admin" };
  } catch (err) {
    // Network / supabase client crash — fail closed.
    console.warn(
      "[admin-check] has_role threw (failing closed):",
      err,
    );
    return { ok: false, reason: "lookup_failed" };
  }
}
