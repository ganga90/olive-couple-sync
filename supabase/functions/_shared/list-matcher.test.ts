// Tests for list-matcher.ts.
// ============================================================================
// Covers:
//   * findUserList — regex + AI-hint resolution against the user's lists.
//   * resolveSaveTargetList — the SAVE_ARTIFACT resolver. AI-suggestion
//     match, new-list creation, equivalence collision guard, category-
//     canonical fallback, and the 23505 race-condition refetch.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  __internals__,
  findUserList,
  normalizeListName,
  resolveSaveTargetList,
  singularize,
  type UserList,
} from "./list-matcher.ts";

// ─── normalizeListName / singularize ─────────────────────────────────

Deno.test("normalizeListName: strips articles and lowercases", () => {
  assertEquals(normalizeListName("The Book List"), "book list");
  assertEquals(normalizeListName("My Travel"), "travel");
  assertEquals(normalizeListName("OUR  HOME "), "home");
});

Deno.test("singularize: common English plurals", () => {
  assertEquals(singularize("books"), "book");
  assertEquals(singularize("stories"), "story");
  assertEquals(singularize("dishes"), "dish");
  assertEquals(singularize("class"), "class");          // not plural — unchanged
  assertEquals(singularize("media"), "media");          // already singular-ish
});

// ─── findUserList ────────────────────────────────────────────────────

Deno.test("findUserList: AI hint matches by exact normalized name", () => {
  const lists: UserList[] = [{ id: "1", name: "Books" }, { id: "2", name: "Travel" }];
  const match = findUserList("show me", lists, "books");
  assertEquals(match?.listId, "1");
  assertEquals(match?.matchedVia, "ai_hint");
});

Deno.test("findUserList: regex pulls list name from natural-language query", () => {
  const lists: UserList[] = [{ id: "1", name: "Books" }];
  const match = findUserList("What's in my book list?", lists);
  assertEquals(match?.listId, "1");
  assert(match?.matchedVia === "regex" || match?.matchedVia === "fuzzy");
});

Deno.test("findUserList: generic words (tasks, stuff) → no match", () => {
  const lists: UserList[] = [{ id: "1", name: "Tasks" }];
  const match = findUserList("show me my tasks", lists);
  assertEquals(match, null);
});

// ─── Internal helpers ────────────────────────────────────────────────

Deno.test("areNamesEquivalent: singular/plural collapse", () => {
  const { areNamesEquivalent } = __internals__;
  assert(areNamesEquivalent("Travel", "Travels"));
  assert(areNamesEquivalent("Recipe", "Recipes"));
});

Deno.test("areNamesEquivalent: canonical alias overlap", () => {
  const { areNamesEquivalent } = __internals__;
  assert(areNamesEquivalent("Groceries", "Grocery"));
  assert(areNamesEquivalent("Health", "Wellness"));
});

Deno.test("areNamesEquivalent: unrelated names → false", () => {
  const { areNamesEquivalent } = __internals__;
  assert(!areNamesEquivalent("Travel", "Recipes"));
});

Deno.test("titleCaseCategory: snake_case becomes Title Case", () => {
  const { titleCaseCategory } = __internals__;
  assertEquals(titleCaseCategory("real_estate"), "Real Estate");
  assertEquals(titleCaseCategory("home_improvement"), "Home Improvement");
  assertEquals(titleCaseCategory("travel"), "Travel");
});

// ─── resolveSaveTargetList ──────────────────────────────────────────
//
// Each test builds a tiny Supabase stub. The resolver only calls
// `.from('clerk_lists').insert([...]).select().single()` on the create
// path, and `.from('clerk_lists').select(...).ilike(...).or(...).limit(...).single()`
// on the 23505 refetch. Everything else is pure logic.

interface InsertCapture {
  inserts: Array<Record<string, unknown>>;
  /** Force insert() to return this row instead of the default success. */
  insertOverride?: { data: unknown; error: unknown };
  /** Force the refetch (after a 23505) to return this row. */
  refetchOverride?: { data: unknown; error: unknown };
}

function buildSupabaseStub(capture: InsertCapture) {
  return {
    from(_table: string) {
      return {
        insert(rows: Array<Record<string, unknown>>) {
          for (const r of rows) capture.inserts.push(r);
          return {
            select() {
              return {
                async single() {
                  return capture.insertOverride ?? {
                    data: { id: 'new-list-id', name: (rows[0] as { name: string }).name },
                    error: null,
                  };
                },
              };
            },
          };
        },
        select(_cols: string) {
          // Used on the 23505 refetch path. Chain through ilike → or → limit → single.
          const chain = {
            ilike() { return chain; },
            or() { return chain; },
            limit() { return chain; },
            async single() {
              return capture.refetchOverride ?? { data: null, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
}

Deno.test("resolveSaveTargetList: AI matches existing list verbatim", async () => {
  const capture: InsertCapture = { inserts: [] };
  const existingLists: UserList[] = [
    { id: 'l1', name: 'Mallorca Trip' },
    { id: 'l2', name: 'Restaurants' },
  ];

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists,
    aiSuggestion: { name: 'Mallorca Trip', isNew: false, confidence: 'high' },
    classification: { category: 'travel', tags: ['hotel'], title: 'Calatrava Hotel' },
  });

  assertEquals(result?.listId, 'l1');
  assertEquals(result?.listName, 'Mallorca Trip');
  assertEquals(result?.created, false);
  assertEquals(capture.inserts.length, 0);   // No INSERT — matched existing.
});

Deno.test("resolveSaveTargetList: AI proposes NEW list, no collision → INSERT", async () => {
  const capture: InsertCapture = { inserts: [] };
  const existingLists: UserList[] = [{ id: 'l1', name: 'Mallorca Trip' }];

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: 'space-1',
    existingLists,
    aiSuggestion: { name: 'Tokyo Trip', isNew: true, confidence: 'high' },
    classification: { category: 'travel', tags: ['sushi'], title: 'Best Sushi in Tokyo' },
  });

  assertEquals(result?.listId, 'new-list-id');
  assertEquals(result?.listName, 'Tokyo Trip');
  assertEquals(result?.created, true);
  assertEquals(capture.inserts.length, 1);
  assertEquals(capture.inserts[0].name, 'Tokyo Trip');
  assertEquals(capture.inserts[0].is_manual, false);
  assertEquals(capture.inserts[0].space_id, 'space-1');
  assertEquals(capture.inserts[0].author_id, 'u1');
});

Deno.test("resolveSaveTargetList: AI proposes NEW but equivalent exists → match existing, no INSERT", async () => {
  const capture: InsertCapture = { inserts: [] };
  // User has "Travel" — AI proposes "Travels" (singular/plural collision).
  const existingLists: UserList[] = [{ id: 'l1', name: 'Travel' }];

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists,
    aiSuggestion: { name: 'Travels', isNew: true, confidence: 'high' },
    classification: { category: 'travel', tags: [], title: 'Trip plans' },
  });

  assertEquals(result?.listId, 'l1');
  assertEquals(result?.listName, 'Travel');
  assertEquals(result?.created, false);
  assertEquals(capture.inserts.length, 0);   // Equivalence guard prevented duplicate.
});

Deno.test("resolveSaveTargetList: low confidence → does NOT create", async () => {
  const capture: InsertCapture = { inserts: [] };

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists: [],
    aiSuggestion: { name: 'Random Thoughts', isNew: true, confidence: 'low' },
    classification: { category: 'general', tags: [], title: 'X' },
  });

  // No canonical for 'general' (it's not in the map), AI confidence too low.
  assertEquals(result, null);
  assertEquals(capture.inserts.length, 0);
});

Deno.test("resolveSaveTargetList: AI null + category=travel + existing Travel list → category-canonical match", async () => {
  const capture: InsertCapture = { inserts: [] };
  const existingLists: UserList[] = [{ id: 'l1', name: 'Travel' }];

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists,
    aiSuggestion: { name: null, isNew: false, confidence: 'low' },
    classification: { category: 'travel', tags: [], title: 'Itinerary' },
  });

  assertEquals(result?.listId, 'l1');
  assertEquals(result?.listName, 'Travel');
  assertEquals(result?.created, false);
});

Deno.test("resolveSaveTargetList: AI generic name 'task' → suppressed, no INSERT", async () => {
  const capture: InsertCapture = { inserts: [] };

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists: [],
    aiSuggestion: { name: 'tasks', isNew: true, confidence: 'high' },
    classification: { category: 'task', tags: [], title: 'X' },
  });

  assertEquals(result, null);
  assertEquals(capture.inserts.length, 0);
});

Deno.test("resolveSaveTargetList: 23505 race → refetch returns existing list", async () => {
  const capture: InsertCapture = {
    inserts: [],
    insertOverride: { data: null, error: { code: '23505', message: 'duplicate' } },
    refetchOverride: { data: { id: 'existing-id', name: 'Tokyo Trip' }, error: null },
  };

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists: [],
    aiSuggestion: { name: 'Tokyo Trip', isNew: true, confidence: 'high' },
    classification: { category: 'travel', tags: [], title: 'X' },
  });

  assertEquals(result?.listId, 'existing-id');
  assertEquals(result?.listName, 'Tokyo Trip');
  // `created=true` is acceptable here — the INSERT path was taken and
  // returned an id; the race was handled internally. Document expectation
  // either way to surface intent.
  assertEquals(result?.created, true);
});

Deno.test("resolveSaveTargetList: confidenceFloor='medium' allows medium-confidence create", async () => {
  const capture: InsertCapture = { inserts: [] };

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists: [],
    aiSuggestion: { name: 'Mallorca Trip', isNew: true, confidence: 'medium' },
    classification: { category: 'travel', tags: [], title: 'X' },
    confidenceFloor: 'medium',
  });

  assertEquals(result?.created, true);
  assertEquals(capture.inserts.length, 1);
});

Deno.test("resolveSaveTargetList: AI=null + no canonical match → returns null", async () => {
  const capture: InsertCapture = { inserts: [] };

  const result = await resolveSaveTargetList({
    // deno-lint-ignore no-explicit-any
    supabase: buildSupabaseStub(capture) as any,
    userId: 'u1',
    coupleId: null,
    spaceId: null,
    existingLists: [{ id: 'l1', name: 'Books' }],
    aiSuggestion: { name: null, isNew: false, confidence: 'low' },
    classification: { category: 'travel', tags: [], title: 'X' },
  });

  // category=travel canonical → 'Travel', but user only has 'Books'.
  assertEquals(result, null);
});
