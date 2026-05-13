/**
 * owner-display — pure helpers for rendering "who is this task assigned to?"
 *
 * Background
 * ──────────
 * `clerk_notes.task_owner` is canonical (NULL or a `user_id` like
 * `user_xxx`) after migration 20260513032720_canonicalize_task_owner.
 * The Note type carries:
 *
 *   - `task_owner: string | null`   — the canonical user_id
 *   - `task_owner_name: string`     — resolved display name (provider-set)
 *   - `authorId: string`            — the note's creator
 *
 * Three places need the "who owns this?" label:
 *
 *   1. Home weekly/priority cards
 *   2. PartnerActivityWidget rows
 *   3. ContextRail upcoming-task hints
 *
 * Before this helper, each surface inlined its own branchy resolver
 * with overlapping bugs (notably: comparing display-name strings to
 * the literal "You" returned by `getMemberName(currentUser.id)`,
 * which silently returns the wrong label after a reassignment).
 *
 * All three now call `resolveOwnerLabel({ note, currentUserId, members, t })`
 * and get the same answer.
 */

import type { Note } from "@/types/note";

export interface OwnerMember {
  user_id: string;
  display_name: string;
}

export interface ResolveOwnerLabelArgs {
  /**
   * The note whose owner label we want to render. We read:
   *   - `task_owner` (canonical user_id, or null)
   *   - `task_owner_name` (resolved display name, optional)
   *   - `authorId` (creator user_id)
   *   - `isShared` (private notes follow author; shared follow owner)
   */
  note: Pick<Note, "task_owner" | "task_owner_name" | "authorId" | "isShared">;
  /** Current logged-in user's user_id. Used to emit "You" / `t.you`. */
  currentUserId: string | null | undefined;
  /** All space members for display-name lookups. */
  members: OwnerMember[];
  /** Translator: pass i18n keys for the user-facing labels. */
  t: {
    you: string;
    everyone: string;
  };
}

/**
 * Returns the label to show in a task chip, e.g. "You", "Almu", "Everyone".
 *
 * Decision tree (in priority order):
 *   1. The task is shared AND has an explicit owner →
 *      → if owner is the current user, return `t.you`
 *      → else return the owner's display name (or "Unknown" if a
 *        legacy unresolvable value somehow survived).
 *   2. The task is private (or shared with no owner) AND has an
 *      author →
 *      → if the author is the current user, return `t.you`
 *      → else return the author's display name.
 *   3. No author, no owner → `t.everyone`.
 *
 * Pure function: no React, no providers, no side effects. Easy to
 * unit-test with synthetic notes (see owner-display.test.ts).
 */
export function resolveOwnerLabel({
  note,
  currentUserId,
  members,
  t,
}: ResolveOwnerLabelArgs): string {
  const memberById = (id: string | null | undefined): OwnerMember | undefined => {
    if (!id) return undefined;
    return members.find((m) => m.user_id === id);
  };

  // 1. Explicit owner on a shared task
  if (note.task_owner) {
    if (currentUserId && note.task_owner === currentUserId) return t.you;
    // Prefer the provider-resolved display name (already member-resolved
    // and language-aware). Fall back to the members array.
    if (note.task_owner_name) return note.task_owner_name;
    const member = memberById(note.task_owner);
    if (member) return member.display_name;
    // Canonical user_id with no member match (left the space, etc.) —
    // intentionally show a stable fallback rather than the raw id.
    return t.everyone;
  }

  // 2. No explicit owner — fall back to the note's author
  if (note.authorId) {
    if (currentUserId && note.authorId === currentUserId) return t.you;
    const member = memberById(note.authorId);
    if (member) return member.display_name;
    // Author left the space or profile not loaded yet.
    return t.everyone;
  }

  // 3. Anonymous / nothing to attribute
  return t.everyone;
}

/**
 * "Is this task assigned to the current user?"
 *
 * Used by widgets that highlight rows the user is on the hook for
 * (PartnerActivityWidget, ContextRail). Replaces the previous
 * triple-OR check (`task_owner === 'you' || === youName || === userId`)
 * that was leaking the literal token 'you' through the comparison.
 */
export function isAssignedToCurrentUser(
  note: Pick<Note, "task_owner" | "authorId" | "isShared">,
  currentUserId: string | null | undefined,
): boolean {
  if (!currentUserId) return false;
  if (note.task_owner) return note.task_owner === currentUserId;
  // No explicit owner: shared tasks belong to nobody specifically;
  // private tasks belong to the author.
  if (note.isShared) return false;
  return note.authorId === currentUserId;
}
