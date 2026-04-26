/**
 * Tests for space-scope.ts
 * Run: deno test supabase/functions/_shared/space-scope.test.ts --allow-net --allow-read --allow-env
 */
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveScope,
  buildPersonalOrSharedFilter,
  buildSpaceOnlyFilter,
  scopeColumnsForWrite,
} from "./space-scope.ts";

// ─── resolveScope ────────────────────────────────────────────────────────

Deno.test("resolveScope: prefers space_id over couple_id when both present", () => {
  const r = resolveScope({ space_id: "space-uuid", couple_id: "couple-uuid" });
  assertEquals(r.spaceId, "space-uuid");
});

Deno.test("resolveScope: falls back to couple_id when only that is present", () => {
  const r = resolveScope({ couple_id: "couple-uuid" });
  assertEquals(r.spaceId, "couple-uuid");
});

Deno.test("resolveScope: returns null for empty input (personal)", () => {
  assertEquals(resolveScope({}).spaceId, null);
  assertEquals(resolveScope({ space_id: null, couple_id: null }).spaceId, null);
});

Deno.test("resolveScope: handles undefined and null distinctly", () => {
  // Explicit null space_id should still allow couple_id fallback (?? operator)
  // because nullish coalescing treats both null and undefined the same.
  assertEquals(resolveScope({ space_id: null, couple_id: "c1" }).spaceId, "c1");
  assertEquals(resolveScope({ space_id: undefined, couple_id: "c1" }).spaceId, "c1");
});

// ─── buildPersonalOrSharedFilter ─────────────────────────────────────────

Deno.test("buildPersonalOrSharedFilter: with spaceId returns OR clause", () => {
  const filter = buildPersonalOrSharedFilter({
    userId: "user_abc",
    spaceId: "space-123",
  });
  assertEquals(filter, "author_id.eq.user_abc,space_id.eq.space-123");
});

Deno.test("buildPersonalOrSharedFilter: without spaceId returns author-only", () => {
  const filter = buildPersonalOrSharedFilter({
    userId: "user_abc",
    spaceId: null,
  });
  assertEquals(filter, "author_id.eq.user_abc");
});

Deno.test("buildPersonalOrSharedFilter: respects custom authorCol", () => {
  const filter = buildPersonalOrSharedFilter({
    userId: "user_abc",
    spaceId: "space-123",
    authorCol: "user_id",
  });
  assertEquals(filter, "user_id.eq.user_abc,space_id.eq.space-123");
});

Deno.test("buildPersonalOrSharedFilter: rejects userId with comma", () => {
  assertThrows(
    () => buildPersonalOrSharedFilter({ userId: "user_a,bad", spaceId: "s1" }),
    Error,
    "illegal separator",
  );
});

Deno.test("buildPersonalOrSharedFilter: rejects spaceId with parens", () => {
  assertThrows(
    () => buildPersonalOrSharedFilter({ userId: "user_a", spaceId: "s(bad)" }),
    Error,
    "illegal separator",
  );
});

// ─── buildSpaceOnlyFilter ────────────────────────────────────────────────

Deno.test("buildSpaceOnlyFilter: returns space_id eq clause", () => {
  assertEquals(buildSpaceOnlyFilter("s1"), "space_id.eq.s1");
});

Deno.test("buildSpaceOnlyFilter: rejects illegal separators", () => {
  assertThrows(() => buildSpaceOnlyFilter("s,1"), Error);
});

// ─── scopeColumnsForWrite ────────────────────────────────────────────────

Deno.test("scopeColumnsForWrite: returns {space_id} only — never couple_id", () => {
  const cols = scopeColumnsForWrite("space-uuid");
  assertEquals(cols, { space_id: "space-uuid" });
  // Crucially, no couple_id key — that gets derived by the DB trigger
  // (and writing it for a non-couple space would FK-violate).
  assertEquals(Object.keys(cols), ["space_id"]);
});

Deno.test("scopeColumnsForWrite: passes through null for personal scope", () => {
  assertEquals(scopeColumnsForWrite(null), { space_id: null });
});
