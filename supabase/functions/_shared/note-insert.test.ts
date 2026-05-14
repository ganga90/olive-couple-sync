/**
 * note-insert.test.ts — type-safe clerk_notes insert helper
 * ==========================================================
 * Run with: deno test supabase/functions/_shared/note-insert.test.ts --allow-net --allow-env
 */

import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  insertNote,
  insertNotesBatch,
  NOTE_SOURCES,
  whatsappSourceFromMessageType,
} from "./note-insert.ts";

// deno-lint-ignore no-explicit-any
function mockSupabase(captured: any[]): any {
  return {
    from(_table: string) {
      return {
        // deno-lint-ignore no-explicit-any
        insert(payload: any) {
          captured.push({ op: "insert", payload });
          return {
            select(_cols: string) {
              return {
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "test-id",
                      summary: Array.isArray(payload)
                        ? payload[0]?.summary ?? null
                        : payload?.summary ?? null,
                      list_id: null,
                    },
                    error: null,
                  }),
                then: (resolve: (v: unknown) => void) =>
                  resolve({
                    data: Array.isArray(payload)
                      ? payload.map((p, i) => ({
                          id: `test-id-${i}`,
                          summary: p.summary ?? null,
                          list_id: null,
                        }))
                      : [{ id: "test-id", summary: payload.summary ?? null, list_id: null }],
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
  };
}

Deno.test("insertNote — populates source and calls clerk_notes", async () => {
  // deno-lint-ignore no-explicit-any
  const captured: any[] = [];
  const supabase = mockSupabase(captured);
  const r = await insertNote(supabase, {
    author_id: "user_1",
    source: "whatsapp",
    source_ref: "wamid.HBgN...",
    summary: "buy milk",
  });
  assertEquals(r.error, null);
  assertEquals(captured.length, 1);
  assertEquals(captured[0].payload.source, "whatsapp");
  assertEquals(captured[0].payload.source_ref, "wamid.HBgN...");
});

Deno.test("insertNote — rejects missing source at runtime", async () => {
  // deno-lint-ignore no-explicit-any
  const captured: any[] = [];
  const supabase = mockSupabase(captured);
  const r = await insertNote(supabase, {
    author_id: "user_1",
    // deno-lint-ignore no-explicit-any
    source: undefined as any,
  });
  assertEquals(r.data, null);
  assertEquals(r.error?.message.includes("source is required"), true);
  assertEquals(captured.length, 0); // no DB call attempted
});

Deno.test("insertNotesBatch — rejects if any row missing source", async () => {
  // deno-lint-ignore no-explicit-any
  const captured: any[] = [];
  const supabase = mockSupabase(captured);
  const r = await insertNotesBatch(supabase, [
    { author_id: "u1", source: "whatsapp", summary: "a" },
    // deno-lint-ignore no-explicit-any
    { author_id: "u1", source: undefined as any, summary: "b" },
  ]);
  assertEquals(r.data, null);
  assertEquals(r.error?.message.includes("missing source"), true);
  assertEquals(captured.length, 0);
});

Deno.test("insertNotesBatch — happy path forwards the array unchanged", async () => {
  // deno-lint-ignore no-explicit-any
  const captured: any[] = [];
  const supabase = mockSupabase(captured);
  const r = await insertNotesBatch(supabase, [
    { author_id: "u1", source: "whatsapp", source_ref: "w1", summary: "a" },
    { author_id: "u1", source: "whatsapp", source_ref: "w2", summary: "b" },
  ]);
  assertEquals(r.error, null);
  assertEquals(captured.length, 1);
  assertEquals(captured[0].payload.length, 2);
  assertEquals(captured[0].payload[0].source, "whatsapp");
  assertEquals(captured[0].payload[1].source_ref, "w2");
});

Deno.test("NOTE_SOURCES enum is closed and matches expected values", () => {
  // Defensive: if someone adds a value, the migration CHECK constraint
  // (when applied) must be updated. This test fails if a new value isn't
  // in the expected list.
  const expected = [
    "whatsapp",
    "whatsapp-voice",
    "whatsapp-media",
    "olive-chat",
    "web",
    "ios",
    "email",
    "receipt",
    "save-link",
    "brain-dump",
    "partner-relay",
    "system",
  ];
  assertEquals([...NOTE_SOURCES].sort(), [...expected].sort());
});

Deno.test("whatsappSourceFromMessageType — text → whatsapp", () => {
  assertEquals(whatsappSourceFromMessageType("text"), "whatsapp");
});
Deno.test("whatsappSourceFromMessageType — audio/voice → whatsapp-voice", () => {
  assertEquals(whatsappSourceFromMessageType("audio"), "whatsapp-voice");
  assertEquals(whatsappSourceFromMessageType("voice"), "whatsapp-voice");
});
Deno.test("whatsappSourceFromMessageType — image/document/video/sticker → whatsapp-media", () => {
  assertEquals(whatsappSourceFromMessageType("image"), "whatsapp-media");
  assertEquals(whatsappSourceFromMessageType("document"), "whatsapp-media");
  assertEquals(whatsappSourceFromMessageType("video"), "whatsapp-media");
  assertEquals(whatsappSourceFromMessageType("sticker"), "whatsapp-media");
});
Deno.test("whatsappSourceFromMessageType — unknown / null → whatsapp (safe default)", () => {
  assertEquals(whatsappSourceFromMessageType(null), "whatsapp");
  assertEquals(whatsappSourceFromMessageType(undefined), "whatsapp");
  assertEquals(whatsappSourceFromMessageType("interactive"), "whatsapp");
});
