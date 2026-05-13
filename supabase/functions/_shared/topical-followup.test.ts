// Tests for the topical-follow-up detector — Change 3 of the brain-dump
// organization programme.
//
// We unit-test in two layers:
//
//   1. Pure functions (extractFollowupIntent, topicalMatchScore). These
//      need zero mocking. Each test pins down ONE pattern so a future
//      change to the regex / scoring is fast to debug.
//
//   2. Supabase-touching helpers (findFollowupParent, attachToParent,
//      revertAttach). We use a hand-rolled fake supabase client that
//      mimics the .from().select().gte().eq().order().limit() chain —
//      no network, deterministic. The fake captures every call so
//      tests can assert on the exact query shape.
//
// Why this matters: a false-positive follow-up silently buries a real
// note inside the wrong parent. Pinning behavior with focused unit
// tests is the only way to stay safe as the detector grows.

import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  attachToParent,
  extractFollowupIntent,
  findFollowupParent,
  FOLLOWUP_MATCH_THRESHOLD,
  FOLLOWUP_WINDOW_MS,
  isUndoReply,
  revertAttach,
  topicalMatchScore,
} from "./topical-followup.ts";

// ─── Fake Supabase client ─────────────────────────────────────────────
//
// Implements only the surface findFollowupParent / attachToParent /
// revertAttach actually touches. The chainable shape matches the
// fluent API we call at the call site, so a test can write
// `fakeSupabase({...})` and the helper sees the same interface it
// would in production.

interface FakeNote {
  id: string;
  summary: string;
  items: unknown;
  created_at: string;
  author_id?: string;
  couple_id?: string | null;
  completed?: boolean;
}

interface FakeCall {
  table: string;
  op: "select" | "update";
  filters: Array<{ key: string; value: unknown }>;
  or?: string;
  gte?: { col: string; value: string };
  limit?: number;
  payload?: Record<string, unknown>;
}

function fakeSupabase(opts: {
  notes?: FakeNote[];
  updateError?: { message: string } | null;
  selectError?: { message: string } | null;
}) {
  const calls: FakeCall[] = [];
  // Auto-default `completed: false` on every fixture note so tests
  // don't have to spell it out on every literal. The real column is
  // `NOT NULL DEFAULT false` in the schema, and the helper filters on
  // it explicitly — leaving it undefined on a fixture would
  // unrealistically fail an `.eq("completed", false)` filter.
  const notes = (opts.notes || []).map((n) => ({
    completed: false,
    ...n,
  }));
  const updateError = opts.updateError ?? null;
  const selectError = opts.selectError ?? null;

  function builder(table: string) {
    const call: FakeCall = { table, op: "select", filters: [] };
    calls.push(call);

    // Resolve the query lazily — every chain method is thenable, so
    // whichever method the caller awaits triggers resolution. The
    // resolved value depends on the op recorded at .update() time.
    const resolve = () => {
      if (call.op === "update") {
        return updateError
          ? { data: null, error: updateError }
          : { data: null, error: null };
      }
      return selectError
        ? { data: null, error: selectError }
        : { data: filterNotes(notes, call), error: null };
    };

    const chain: any = {};
    const wireThenable = () => {
      chain.then = (onFulfilled: any, onRejected?: any) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected);
    };
    chain.select = (_cols: string) => { wireThenable(); return chain; };
    chain.gte = (col: string, value: string) => {
      call.gte = { col, value };
      wireThenable();
      return chain;
    };
    chain.eq = (key: string, value: unknown) => {
      call.filters.push({ key, value });
      wireThenable();
      return chain;
    };
    chain.or = (expr: string) => {
      call.or = expr;
      wireThenable();
      return chain;
    };
    chain.order = (_col: string, _opts?: unknown) => {
      wireThenable();
      return chain;
    };
    chain.limit = (n: number) => {
      call.limit = n;
      wireThenable();
      return chain;
    };
    chain.update = (payload: Record<string, unknown>) => {
      call.op = "update";
      call.payload = payload;
      wireThenable();
      return chain;
    };
    return chain;
  }

  return {
    from(table: string) { return builder(table); },
    _calls: calls,
  };
}

function filterNotes(notes: FakeNote[], call: FakeCall): FakeNote[] {
  // Honor the gte filter (created_at window) and the simple eq filters
  // — enough for the assertions our tests need. The OR expression for
  // (author_id OR couple_id) is parsed loosely: any row whose
  // author_id matches the user_id token (or whose couple_id matches
  // the couple token) is accepted. Tests using the OR path pass
  // matching author_ids on their fixtures, so this stays simple.
  let out = notes.slice();
  if (call.gte) {
    const since = new Date(call.gte.value).getTime();
    out = out.filter((n) => new Date(n.created_at).getTime() >= since);
  }
  for (const f of call.filters) {
    out = out.filter((n) => (n as any)[f.key] === f.value);
  }
  if (call.or) {
    // Parse "author_id.eq.<id>,couple_id.eq.<id>" loosely.
    const terms = call.or.split(",").map((t) => t.trim());
    out = out.filter((n) =>
      terms.some((term) => {
        const m = term.match(/^(\w+)\.eq\.(.+)$/);
        if (!m) return false;
        return (n as any)[m[1]] === m[2];
      })
    );
  }
  // Order by created_at DESC so "most recent first" matches production.
  out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  if (call.limit !== undefined) out = out.slice(0, call.limit);
  return out;
}

// ─── extractFollowupIntent — the pattern parser ──────────────────────

Deno.test("extractFollowupIntent: the screenshot bug — email follow-up", () => {
  const out = extractFollowupIntent(
    "Email address for Hard Rock\ngroisinblit@dolphins.com",
  );
  assertExists(out);
  assertEquals(out!.label, "Email");
  assertEquals(out!.topic, "Hard Rock");
  assertEquals(out!.value, "groisinblit@dolphins.com");
});

Deno.test("extractFollowupIntent: phone for proper noun", () => {
  const out = extractFollowupIntent("Phone number for Sarah\n555-123-4567");
  assertExists(out);
  assertEquals(out!.label, "Phone");
  assertEquals(out!.topic, "Sarah");
  assertEquals(out!.value, "555-123-4567");
});

Deno.test("extractFollowupIntent: address with inline colon", () => {
  const out = extractFollowupIntent("Address for the rental: 123 Main St");
  assertExists(out);
  assertEquals(out!.label, "Address");
  assertEquals(out!.topic, "the rental");
  assertEquals(out!.value, "123 Main St");
});

Deno.test("extractFollowupIntent: website / link", () => {
  const out = extractFollowupIntent(
    "Website for the project\nhttps://example.com/foo",
  );
  assertExists(out);
  assertEquals(out!.label, "Link");
  assertEquals(out!.value, "https://example.com/foo");
});

Deno.test("extractFollowupIntent: Spanish — Correo para X", () => {
  const out = extractFollowupIntent("Correo para Hard Rock\nfoo@bar.com");
  assertExists(out);
  assertEquals(out!.label, "Email");
  assertEquals(out!.topic, "Hard Rock");
  assertEquals(out!.value, "foo@bar.com");
});

Deno.test("extractFollowupIntent: Spanish — Teléfono", () => {
  const out = extractFollowupIntent("Teléfono para Sarah\n555 1234567");
  assertExists(out);
  assertEquals(out!.label, "Phone");
  assertEquals(out!.topic, "Sarah");
});

Deno.test("extractFollowupIntent: Italian — Email per X", () => {
  const out = extractFollowupIntent("Email per Hard Rock\nfoo@bar.com");
  assertExists(out);
  assertEquals(out!.label, "Email");
  assertEquals(out!.topic, "Hard Rock");
  assertEquals(out!.value, "foo@bar.com");
});

Deno.test("extractFollowupIntent: Italian — Telefono per X", () => {
  const out = extractFollowupIntent("Telefono per Sarah\n+39 333 1234567");
  assertExists(out);
  assertEquals(out!.label, "Phone");
});

Deno.test("extractFollowupIntent: multi-line address (apt + city)", () => {
  const out = extractFollowupIntent(
    "Address for the rental\n123 Main St\nApt 4B\nMiami FL 33101",
  );
  assertExists(out);
  assertEquals(out!.label, "Address");
  assertEquals(out!.value, "123 Main St Apt 4B Miami FL 33101");
});

Deno.test("extractFollowupIntent: no value → null", () => {
  // User started typing but never sent the value. Without a value
  // there's nothing to attach, so this must NOT be treated as a
  // follow-up.
  const out = extractFollowupIntent("Email for Sarah");
  assertEquals(out, null);
});

Deno.test("extractFollowupIntent: not a label-for-topic pattern → null", () => {
  assertEquals(extractFollowupIntent("buy milk on the way home"), null);
  assertEquals(extractFollowupIntent("how is Sarah doing?"), null);
  assertEquals(extractFollowupIntent("Hard Rock concert tonight"), null);
});

Deno.test("extractFollowupIntent: value too long (paragraph) → null", () => {
  const longValue = "x".repeat(250);
  const out = extractFollowupIntent(`Notes for Sarah\n${longValue}`);
  // 250-char value exceeds the 200 cap. Notes are valid follow-ups in
  // shape but a paragraph is more likely a real new note. Bail.
  assertEquals(out, null);
});

Deno.test("extractFollowupIntent: empty / very long input → null", () => {
  assertEquals(extractFollowupIntent(""), null);
  assertEquals(extractFollowupIntent("x".repeat(700)), null);
});

Deno.test("extractFollowupIntent: too many lines → null", () => {
  // 7 lines suggests a multi-task brain dump, not a single follow-up
  // field. The multi-item-detect path should pick it up instead.
  const out = extractFollowupIntent(
    "Email for Sarah\nfoo@bar.com\nline 3\nline 4\nline 5\nline 6\nline 7",
  );
  assertEquals(out, null);
});

// ─── topicalMatchScore — the scorer ──────────────────────────────────

Deno.test("topicalMatchScore: exact substring + caps → 1.0", () => {
  const score = topicalMatchScore("Hard Rock", "Hard Rock Stadium examples");
  assertEquals(score, 1.0);
});

Deno.test("topicalMatchScore: lowercase substring → boosted by multi-token", () => {
  // "hard rock" lowercase loses the caps signal but still substring-
  // matches AND shares 2 tokens. 0.6 + 0.2 = 0.8 ≥ threshold.
  const score = topicalMatchScore("hard rock", "Hard Rock Stadium examples");
  assertEquals(score >= FOLLOWUP_MATCH_THRESHOLD, true);
});

Deno.test("topicalMatchScore: single proper noun → match", () => {
  const score = topicalMatchScore("Sarah", "Sarah dentist appointment");
  // Substring (0.6) + capitalized shared (0.2). 1 shared token only
  // → no signal-2 boost. Threshold reached.
  assertEquals(score >= FOLLOWUP_MATCH_THRESHOLD, true);
});

Deno.test("topicalMatchScore: 'the meeting' vs 'Project kickoff meeting' → 0", () => {
  // 'meeting' is a stop word; 'the' is a stop word. Zero meaningful
  // shared tokens, no substring (summary doesn't contain "the
  // meeting"), no shared caps.
  const score = topicalMatchScore("the meeting", "Project kickoff meeting");
  assertEquals(score, 0);
});

Deno.test("topicalMatchScore: 'the project' vs 'Project kickoff' → 0", () => {
  // 'project' is a stop word in our list (over-indexed false-positive
  // word). 'the' is a stop word. No proper-noun overlap in topic.
  const score = topicalMatchScore("the project", "Project kickoff");
  assertEquals(score < FOLLOWUP_MATCH_THRESHOLD, true);
});

Deno.test("topicalMatchScore: unrelated topics → 0", () => {
  const score = topicalMatchScore("Hard Rock", "Doctor appointment Tuesday");
  assertEquals(score, 0);
});

Deno.test("topicalMatchScore: empty inputs → 0", () => {
  assertEquals(topicalMatchScore("", "anything"), 0);
  assertEquals(topicalMatchScore("Hard Rock", ""), 0);
  assertEquals(topicalMatchScore("", ""), 0);
});

// ─── findFollowupParent — Supabase integration ───────────────────────

Deno.test("findFollowupParent: the screenshot bug end-to-end", async () => {
  const now = Date.now();
  const fake = fakeSupabase({
    notes: [
      {
        id: "note-1",
        summary: "Hard Rock Stadium examples",
        items: ["Replay", "Suite support", "Music"],
        created_at: new Date(now - 5 * 60 * 1000).toISOString(),
        author_id: "user-1",
      },
    ],
  });

  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email address for Hard Rock\ngroisinblit@dolphins.com",
  );

  assertExists(match);
  assertEquals(match!.parentNoteId, "note-1");
  assertEquals(match!.parentSummary, "Hard Rock Stadium examples");
  assertEquals(match!.addition, "Email: groisinblit@dolphins.com");
  // Existing items preserved + the new addition appended.
  assertEquals(match!.nextItems, [
    "Replay",
    "Suite support",
    "Music",
    "Email: groisinblit@dolphins.com",
  ]);
  assertEquals(match!.confidence >= FOLLOWUP_MATCH_THRESHOLD, true);
});

Deno.test("findFollowupParent: no recent notes → null", async () => {
  const fake = fakeSupabase({ notes: [] });
  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email for Sarah\nfoo@bar.com",
  );
  assertEquals(match, null);
});

Deno.test("findFollowupParent: recent note but topic unrelated → null", async () => {
  const fake = fakeSupabase({
    notes: [
      {
        id: "note-1",
        summary: "Doctor appointment Tuesday",
        items: [],
        created_at: new Date(Date.now() - 60_000).toISOString(),
        author_id: "user-1",
      },
    ],
  });

  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email for Hard Rock\nfoo@bar.com",
  );
  assertEquals(match, null);
});

Deno.test("findFollowupParent: candidate older than window → null", async () => {
  const fake = fakeSupabase({
    notes: [
      {
        id: "note-1",
        summary: "Hard Rock Stadium examples",
        items: [],
        // Just past the 30-minute window.
        created_at: new Date(Date.now() - FOLLOWUP_WINDOW_MS - 60_000).toISOString(),
        author_id: "user-1",
      },
    ],
  });

  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email for Hard Rock\nfoo@bar.com",
  );
  // The gte filter drops the only candidate; nothing to match against.
  assertEquals(match, null);
});

Deno.test("findFollowupParent: picks the highest-scoring of multiple candidates", async () => {
  const now = Date.now();
  const fake = fakeSupabase({
    notes: [
      // Newest first — recent-first ordering preserved by fake.
      {
        id: "note-newer",
        summary: "Sarah lunch tomorrow",
        items: [],
        created_at: new Date(now - 1 * 60_000).toISOString(),
        author_id: "user-1",
      },
      {
        id: "note-older",
        summary: "Hard Rock Stadium examples",
        items: [],
        created_at: new Date(now - 10 * 60_000).toISOString(),
        author_id: "user-1",
      },
    ],
  });

  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email for Hard Rock\nfoo@bar.com",
  );

  assertExists(match);
  // Even though Sarah's note is more recent, the Hard Rock note scores
  // higher against this topic. We pick the highest-scoring match, not
  // just the most-recent.
  assertEquals(match!.parentNoteId, "note-older");
});

Deno.test("findFollowupParent: same value already in items[] → null (dedup)", async () => {
  const fake = fakeSupabase({
    notes: [
      {
        id: "note-1",
        summary: "Hard Rock Stadium examples",
        items: ["Email: groisinblit@dolphins.com", "Replay"],
        created_at: new Date(Date.now() - 60_000).toISOString(),
        author_id: "user-1",
      },
    ],
  });

  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email for Hard Rock\ngroisinblit@dolphins.com",
  );
  // User re-sending the same email shouldn't double-attach.
  assertEquals(match, null);
});

Deno.test("findFollowupParent: non-string items in JSONB are skipped safely", async () => {
  // Defensive: some legacy rows may have items shaped as
  // {text: "..."} objects. The detector should tolerate either
  // shape and produce a clean string[] result.
  const fake = fakeSupabase({
    notes: [
      {
        id: "note-1",
        summary: "Hard Rock Stadium examples",
        items: [
          { text: "Replay" },
          "Music",
          { not_text: "ignored" },
          null,
        ],
        created_at: new Date(Date.now() - 60_000).toISOString(),
        author_id: "user-1",
      },
    ],
  });

  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email for Hard Rock\nfoo@bar.com",
  );

  assertExists(match);
  // Strings normalized: Replay, Music, plus the new addition.
  assertEquals(match!.nextItems, [
    "Replay",
    "Music",
    "Email: foo@bar.com",
  ]);
});

Deno.test("findFollowupParent: not a follow-up shape → skips the supabase round-trip", async () => {
  const fake = fakeSupabase({ notes: [] });
  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "just a random note",
  );
  assertEquals(match, null);
  // Sanity: should not have issued a query at all.
  assertEquals(fake._calls.length, 0);
});

Deno.test("findFollowupParent: supabase error → null (fail-safe)", async () => {
  const fake = fakeSupabase({
    selectError: { message: "boom" },
  });
  const match = await findFollowupParent(
    fake,
    "user-1",
    null,
    "Email for Hard Rock\nfoo@bar.com",
  );
  // We never want a transient DB hiccup to be silently treated as a
  // match. Null = fall through to normal note creation.
  assertEquals(match, null);
});

// ─── attachToParent / revertAttach ───────────────────────────────────

Deno.test("attachToParent: writes the new items array", async () => {
  const fake = fakeSupabase({ notes: [] });
  const ok = await attachToParent(fake, "note-1", ["a", "b", "Email: foo@bar.com"]);
  assertEquals(ok, true);
  const updateCall = fake._calls.find((c) => c.op === "update");
  assertExists(updateCall);
  assertEquals(updateCall!.payload, { items: ["a", "b", "Email: foo@bar.com"] });
  // Targeted at the right note.
  assertNotEquals(
    updateCall!.filters.find((f) => f.key === "id" && f.value === "note-1"),
    undefined,
  );
});

Deno.test("attachToParent: error → false", async () => {
  const fake = fakeSupabase({ updateError: { message: "rls denied" } });
  const ok = await attachToParent(fake, "note-1", ["a"]);
  assertEquals(ok, false);
});

Deno.test("revertAttach: restores the prior items array", async () => {
  const fake = fakeSupabase({ notes: [] });
  const ok = await revertAttach(fake, "note-1", ["a", "b"]);
  assertEquals(ok, true);
  const updateCall = fake._calls.find((c) => c.op === "update");
  assertEquals(updateCall!.payload, { items: ["a", "b"] });
});

// ─── isUndoReply — the undo classifier ───────────────────────────────

Deno.test("isUndoReply: bare undo / no / split / separate → true", () => {
  for (const m of ["undo", "no", "no thanks", "nope", "split", "separate", "keep separate"]) {
    assertEquals(isUndoReply(m), true, `expected ${m} → true`);
  }
});

Deno.test("isUndoReply: multi-word undo phrases → true", () => {
  for (const m of [
    "save separately",
    "save it separately",
    "make it separate",
    "as a new note",
    "as a separate note",
  ]) {
    assertEquals(isUndoReply(m), true, `expected "${m}" → true`);
  }
});

Deno.test("isUndoReply: Spanish equivalents → true", () => {
  for (const m of ["deshacer", "no gracias", "separar", "por separado", "aparte"]) {
    assertEquals(isUndoReply(m), true, `expected "${m}" → true`);
  }
});

Deno.test("isUndoReply: Italian equivalents → true", () => {
  for (const m of ["annulla", "no grazie", "separato", "a parte"]) {
    assertEquals(isUndoReply(m), true, `expected "${m}" → true`);
  }
});

Deno.test("isUndoReply: regular notes containing undo words → false", () => {
  // A real note that happens to contain "split" or "no" must NOT be
  // misread as an undo command. The length-gate and full-match anchor
  // are what prevent the false positive.
  for (const m of [
    "split the bill with Sarah at lunch",
    "no idea what to cook tonight",
    "make sure to remember the keys",
    "buy more milk",
    "separate the recyclables before pickup",
  ]) {
    assertEquals(isUndoReply(m), false, `expected "${m}" → false`);
  }
});

Deno.test("isUndoReply: empty / overly long → false", () => {
  assertEquals(isUndoReply(""), false);
  assertEquals(isUndoReply(null), false);
  assertEquals(isUndoReply(undefined), false);
  assertEquals(isUndoReply("x".repeat(50)), false);
});

Deno.test("isUndoReply: punctuation / emoji tolerated", () => {
  assertEquals(isUndoReply("undo!"), true);
  assertEquals(isUndoReply("undo."), true);
  assertEquals(isUndoReply("no, thanks"), true);
  assertEquals(isUndoReply("👎 split"), true);
});
