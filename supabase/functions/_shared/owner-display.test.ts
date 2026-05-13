/**
 * owner-display.test.ts
 * ─────────────────────
 * Pure-function tests for the owner-label resolver that powers the
 * task chips on Home, PartnerActivityWidget, and ContextRail.
 *
 * The tests live here (under `_shared/`) so they run alongside the
 * Deno test suite — the frontend has no Vitest/Jest runner yet. Adding
 * a frontend runner is a separate concern; co-locating these tests
 * with the edge-function tests means they get exercised on every CI
 * run today via the existing `deno test supabase/functions/_shared/`
 * command.
 *
 * We import the implementation from the frontend `src/lib/` directory
 * via a relative path. Deno can compile the TypeScript directly
 * because owner-display.ts has zero React / DOM imports — it's a pure
 * function over a small typed shape.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isAssignedToCurrentUser,
  resolveOwnerLabel,
} from "../../../src/lib/owner-display.ts";

// ── Test fixtures ─────────────────────────────────────────────────
const ME = "user_marco";
const ALMU = "user_almu";
const GHOST = "user_ghost"; // a user_id not present in the members list

const members = [
  { user_id: ME, display_name: "Marco" },
  { user_id: ALMU, display_name: "Almu" },
];

const t = { you: "You", everyone: "Everyone" };

// Tiny constructor for a minimal Note shape — only the fields the
// helper reads. Keeps test rows compact and readable.
function note(overrides: {
  task_owner?: string | null;
  task_owner_name?: string;
  authorId?: string;
  isShared?: boolean;
}) {
  return {
    task_owner: null as string | null,
    task_owner_name: undefined as string | undefined,
    authorId: undefined as string | undefined,
    isShared: false,
    ...overrides,
  };
}

// ── resolveOwnerLabel ─────────────────────────────────────────────

Deno.test("resolveOwnerLabel: shared task assigned to me → You", () => {
  const label = resolveOwnerLabel({
    note: note({ task_owner: ME, isShared: true, authorId: ME }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "You");
});

Deno.test("resolveOwnerLabel: shared task assigned to partner → partner display name", () => {
  // This is the exact regression scenario from the bug report:
  // I authored 'Almu book hotel for Mallorca', then reassigned to Almu
  // via the Owner Popover. Old resolver kept returning "You" because
  // it compared against the literal 'You' returned by
  // getMemberName(currentUserId). The new helper compares user_ids.
  const label = resolveOwnerLabel({
    note: note({ task_owner: ALMU, isShared: true, authorId: ME }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "Almu");
});

Deno.test("resolveOwnerLabel: provider-supplied task_owner_name takes precedence over members[] lookup", () => {
  // The provider may set task_owner_name via memberMap before the
  // members[] for this surface is hydrated. Trust the provider.
  const label = resolveOwnerLabel({
    note: note({ task_owner: ALMU, task_owner_name: "Almu", authorId: ME, isShared: true }),
    currentUserId: ME,
    members: [], // surface-level members not loaded yet
    t,
  });
  assertEquals(label, "Almu");
});

Deno.test("resolveOwnerLabel: shared task assigned to a user that left the space → 'Everyone' fallback (not raw user_id)", () => {
  // The user has been removed from the space; the user_id no longer
  // resolves. We must NOT leak the raw 'user_xxx' to the UI.
  const label = resolveOwnerLabel({
    note: note({ task_owner: GHOST, authorId: ME, isShared: true }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "Everyone");
});

Deno.test("resolveOwnerLabel: shared task with no owner authored by me → You", () => {
  const label = resolveOwnerLabel({
    note: note({ task_owner: null, authorId: ME, isShared: true }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "You");
});

Deno.test("resolveOwnerLabel: shared task with no owner authored by partner → partner display name", () => {
  const label = resolveOwnerLabel({
    note: note({ task_owner: null, authorId: ALMU, isShared: true }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "Almu");
});

Deno.test("resolveOwnerLabel: private task authored by me → You", () => {
  const label = resolveOwnerLabel({
    note: note({ task_owner: null, authorId: ME, isShared: false }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "You");
});

Deno.test("resolveOwnerLabel: private task authored by partner → partner display name", () => {
  const label = resolveOwnerLabel({
    note: note({ task_owner: null, authorId: ALMU, isShared: false }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "Almu");
});

Deno.test("resolveOwnerLabel: orphan note (no owner, no author) → Everyone", () => {
  const label = resolveOwnerLabel({
    note: note({ task_owner: null, authorId: undefined }),
    currentUserId: ME,
    members,
    t,
  });
  assertEquals(label, "Everyone");
});

Deno.test("resolveOwnerLabel: currentUserId null (logged out / loading) → no 'You' shortcut", () => {
  // We must never accidentally label a task "You" for a non-current
  // user (e.g. when the auth context is still hydrating). Owner
  // resolution falls back to display name lookups.
  const label = resolveOwnerLabel({
    note: note({ task_owner: ALMU, authorId: ME, isShared: true }),
    currentUserId: null,
    members,
    t,
  });
  assertEquals(label, "Almu");
});

// ── isAssignedToCurrentUser ───────────────────────────────────────

Deno.test("isAssignedToCurrentUser: shared task assigned to me → true", () => {
  const result = isAssignedToCurrentUser(
    note({ task_owner: ME, isShared: true }),
    ME,
  );
  assertEquals(result, true);
});

Deno.test("isAssignedToCurrentUser: shared task assigned to partner → false", () => {
  const result = isAssignedToCurrentUser(
    note({ task_owner: ALMU, isShared: true }),
    ME,
  );
  assertEquals(result, false);
});

Deno.test("isAssignedToCurrentUser: shared task with no owner → false (nobody specific)", () => {
  // Shared tasks without an explicit owner are NOT "assigned to me"
  // even when I authored them — the UI should reflect that they
  // belong to the whole space, not me personally.
  const result = isAssignedToCurrentUser(
    note({ task_owner: null, authorId: ME, isShared: true }),
    ME,
  );
  assertEquals(result, false);
});

Deno.test("isAssignedToCurrentUser: private task authored by me → true (private = assigned to me)", () => {
  const result = isAssignedToCurrentUser(
    note({ task_owner: null, authorId: ME, isShared: false }),
    ME,
  );
  assertEquals(result, true);
});

Deno.test("isAssignedToCurrentUser: currentUserId null → false", () => {
  const result = isAssignedToCurrentUser(
    note({ task_owner: ME, isShared: true }),
    null,
  );
  assertEquals(result, false);
});

Deno.test("isAssignedToCurrentUser: legacy task_owner = literal 'you' → false (canonical user_id only)", () => {
  // Post-migration, 'you' never lives in task_owner anymore. If a
  // stale write somehow re-introduces it, we must NOT match it as
  // the current user — that would re-enable the pre-fix bug.
  const result = isAssignedToCurrentUser(
    // deno-lint-ignore no-explicit-any
    { task_owner: "you" as any, isShared: true } as any,
    ME,
  );
  assertEquals(result, false);
});
