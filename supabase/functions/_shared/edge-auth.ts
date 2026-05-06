/**
 * Edge-function auth resolution
 * ==============================
 * Resolves the acting user id for an edge function from a bearer token plus
 * (optionally) a body-supplied `user_id`. Supports two caller shapes:
 *
 *   1. **Clerk-authed user** — token payload has `sub` (the Clerk user id).
 *      `user_id` from the request body is IGNORED, so a Clerk user cannot
 *      impersonate another user by passing a different id.
 *
 *   2. **Service-role caller** — token payload has `role === "service_role"`.
 *      The caller MUST pass `user_id` in the request body. Accepting
 *      user_id from a service-role caller is no more permissive than the
 *      alternative: anyone holding the service-role key can already write
 *      directly to any user's data via the Supabase client. Requiring it
 *      explicitly makes intent visible in logs and avoids silent fallback
 *      to a "system user" id.
 *
 * Notes:
 *   - This module does NOT verify JWT signatures. Supabase's auth gateway
 *     is expected to have done that before the function code executes.
 *     Matches the convention in olive-soul-safety, olive-trust-gate, and
 *     other auth-checking edge functions in this repo.
 *   - Pure, no I/O. Trivially testable.
 */

export type AuthResolution =
  | {
    ok: true;
    userId: string;
    /** True when the caller's token is a service-role JWT. */
    isServiceRole: boolean;
  }
  | {
    ok: false;
    /** HTTP status code the caller should return. */
    status: 400 | 401;
    error: string;
  };

/**
 * Inspect a bearer token and an optional body `user_id` to determine the
 * acting user. Returns a tagged union: callers should `if (!result.ok)`
 * and use `{ result.error, result.status }` to build the error response.
 *
 * @param bearerToken — the JWT from the Authorization header,
 *                     with the "Bearer " prefix already stripped
 * @param bodyUserId — value of `user_id` from the parsed request body,
 *                     or `undefined` if the body did not include one
 */
export function resolveCallerUserId(
  bearerToken: string,
  bodyUserId: unknown,
): AuthResolution {
  if (!bearerToken || typeof bearerToken !== "string") {
    return { ok: false, status: 401, error: "Missing token" };
  }

  // Parse JWT payload — second segment, base64url-decoded, JSON.
  // Any failure here means the token is malformed; respond 401.
  let payload: Record<string, unknown>;
  try {
    const parts = bearerToken.split(".");
    if (parts.length < 2) throw new Error("not a JWT");
    payload = JSON.parse(atob(parts[1]));
    if (!payload || typeof payload !== "object") throw new Error("not an object");
  } catch {
    return { ok: false, status: 401, error: "Invalid token" };
  }

  // ─── Service-role path ──────────────────────────────────────────
  // Checked FIRST: if both `role === "service_role"` and `sub` are
  // present (shouldn't happen in practice but be explicit), treat as
  // service-role. The role claim is a stronger signal than sub presence
  // and prevents a service-role-bearing JWT from accidentally acting as
  // its embedded sub when bodyUserId is supplied.
  if (payload.role === "service_role") {
    if (typeof bodyUserId !== "string" || bodyUserId.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Service-role calls must include user_id in request body",
      };
    }
    return { ok: true, userId: bodyUserId, isServiceRole: true };
  }

  // ─── Clerk-authed user path ─────────────────────────────────────
  // Body `user_id` is intentionally ignored: a Clerk-authed user must
  // not be able to impersonate by passing a different id in the body.
  if (typeof payload.sub === "string" && payload.sub.length > 0) {
    return { ok: true, userId: payload.sub, isServiceRole: false };
  }

  return {
    ok: false,
    status: 401,
    error: "Token missing sub claim and is not service-role",
  };
}
