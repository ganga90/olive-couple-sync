/**
 * space-scope.ts — canonical scope resolution for edge functions
 * ================================================================
 *
 * Background
 * ----------
 * Olive is migrating from a 2-person `clerk_couples` model to a 1–10
 * member `olive_spaces` model. Both columns coexist on every scoped
 * table (clerk_notes, clerk_lists, expenses, expense_settlements):
 *
 *   * For couple-type spaces, BEFORE INSERT/UPDATE triggers keep
 *     `couple_id` and `space_id` in lockstep (1:1 bridge — both equal
 *     the same UUID).
 *   * For non-couple spaces (family / business / custom), only
 *     `space_id` is populated. `couple_id` stays NULL because there
 *     is no matching clerk_couples row to FK against.
 *
 * RLS on all four tables now accepts EITHER `is_couple_member(couple_id)`
 * OR `is_space_member(space_id)`. So a query that filters by `space_id`
 * is the canonical, future-proof scope filter — it returns the same rows
 * for couple-type spaces AND the additional rows that only exist in
 * non-couple spaces.
 *
 * Why this helper
 * ---------------
 * Every edge function that reads or writes a scoped row used to call
 * something like:
 *
 *     .or(`author_id.eq.${userId},couple_id.eq.${coupleId}`)
 *
 * which silently returns nothing for non-couple spaces. We want one
 * tested helper instead of repeating the resolution logic 20+ times.
 *
 * Design rules
 * ------------
 * 1. Always prefer `space_id` over `couple_id` when both are provided.
 *    They mean the same thing for couple-type spaces and `space_id` is
 *    the only correct scope for non-couple spaces.
 * 2. Never write `couple_id` directly when inserting / updating a row
 *    in a scoped table. Write `space_id` and let the BEFORE trigger
 *    derive `couple_id` (only for couple-type spaces). Otherwise we
 *    will trip the clerk_couples FK on non-couple spaces.
 * 3. The helper is pure (no Supabase / network calls) so it can be
 *    unit-tested without mocks.
 */

/** Inputs from an edge function request payload. */
export interface RawScopeInput {
  /** Legacy field; UI may still pass this. */
  couple_id?: string | null;
  /** Canonical scope going forward. */
  space_id?: string | null;
}

/**
 * Resolves the canonical scope (space_id) from raw input, preferring
 * space_id when both are present. Returns null for personal scope.
 */
export function resolveScope(input: RawScopeInput): { spaceId: string | null } {
  const spaceId = input.space_id ?? input.couple_id ?? null;
  return { spaceId };
}

/**
 * Builds the Supabase `.or(...)` filter string for a personal-OR-shared
 * read on a scoped table (clerk_notes, clerk_lists, expenses, etc.).
 *
 * Returns a string the caller can pass directly to PostgREST `.or()`:
 *
 *     query.or(buildPersonalOrSharedFilter({ userId, spaceId, authorCol: 'author_id' }))
 *
 * If `spaceId` is null (no space context), the filter scopes to the
 * authoring user only — equivalent to "personal items only".
 *
 * NOTE: Supabase OR strings cannot contain commas in values — these
 * UUIDs and Clerk user IDs never do, but we still validate to fail
 * fast in case of accidental injection.
 */
export function buildPersonalOrSharedFilter(opts: {
  userId: string;
  spaceId: string | null;
  /** Column that holds the row's author / owner ID (defaults to `author_id`). */
  authorCol?: string;
}): string {
  const authorCol = opts.authorCol ?? "author_id";
  validateNoSeparators(opts.userId, "userId");
  if (opts.spaceId !== null) validateNoSeparators(opts.spaceId, "spaceId");

  if (opts.spaceId === null) {
    return `${authorCol}.eq.${opts.userId}`;
  }
  // RLS already enforces that the caller is a member of `spaceId`, so
  // we can read back any row scoped to it (regardless of author).
  return `${authorCol}.eq.${opts.userId},space_id.eq.${opts.spaceId}`;
}

/**
 * Builds the strict-shared filter for cases where we want ONLY rows
 * scoped to a specific space (no personal fallback) — e.g. partner /
 * other-member activity feeds.
 *
 * Throws if `spaceId` is null because the resulting query would have
 * undefined semantics.
 */
export function buildSpaceOnlyFilter(spaceId: string): string {
  validateNoSeparators(spaceId, "spaceId");
  return `space_id.eq.${spaceId}`;
}

/**
 * Returns the insert/update columns to set for a scoped write.
 *
 * Always returns `{ space_id }` (never `{ couple_id }`) — the BEFORE
 * trigger on clerk_notes / clerk_lists / expenses derives couple_id
 * automatically for couple-type spaces and leaves it NULL for
 * non-couple spaces (so the clerk_couples FK is satisfied).
 *
 * Pass the result via spread:
 *
 *     const insertData = { ...scopeColumnsForWrite(spaceId), summary, ... };
 */
export function scopeColumnsForWrite(spaceId: string | null): { space_id: string | null } {
  return { space_id: spaceId };
}

// ─── internal ───────────────────────────────────────────────────────────

function validateNoSeparators(value: string, label: string): void {
  if (value.includes(",") || value.includes("(") || value.includes(")")) {
    throw new Error(`[space-scope] ${label} contains illegal separator: ${value}`);
  }
}
