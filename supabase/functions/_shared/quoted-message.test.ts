// Tests for resolveQuotedTask — the quoted-message disambiguator.
//
// The screenshot bug (Block C): when text+image arrive within seconds,
// both reply()s update `last_outbound_context` in a race; whichever
// finishes last wins, and a follow-up correction lands on the wrong
// note. PR4 fixes this by storing a sliding window of WAMID → task_id
// mappings and resolving the user's QUOTED message directly when the
// inbound payload includes `context.id`.
//
// We test the resolver against fabricated profile shapes — no real
// Supabase needed. The mock implements the minimal `from().select().eq().single()`
// chain the resolver actually calls.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveQuotedTask } from "./quoted-message.ts";

interface MockProfile {
  last_outbound_context?: {
    recent_outbound?: Array<{
      wa_message_id: string | null;
      task_id: string | null;
      task_summary?: string;
      sent_at?: string;
      message_type?: string;
    }>;
  };
}

function mockSupabase(profile: MockProfile | null, throwOnQuery = false) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => {
            if (throwOnQuery) throw new Error("DB unavailable");
            return { data: profile, error: null };
          },
        }),
      }),
    }),
  };
}

// ---------- Empty / null inputs ----------

Deno.test("resolveQuotedTask: null quotedMessageId → null", async () => {
  const supa = mockSupabase({ last_outbound_context: { recent_outbound: [] } });
  // deno-lint-ignore no-explicit-any
  const result = await resolveQuotedTask(supa as any, "user-1", null as any);
  assertEquals(result, null);
});

Deno.test("resolveQuotedTask: empty quotedMessageId → null", async () => {
  const supa = mockSupabase({ last_outbound_context: { recent_outbound: [] } });
  const result = await resolveQuotedTask(supa as any, "user-1", "");
  assertEquals(result, null);
});

Deno.test("resolveQuotedTask: empty userId → null", async () => {
  const supa = mockSupabase({ last_outbound_context: { recent_outbound: [] } });
  const result = await resolveQuotedTask(supa as any, "", "wamid.X");
  assertEquals(result, null);
});

// ---------- Profile shape variations ----------

Deno.test("resolveQuotedTask: profile has no last_outbound_context → null", async () => {
  const supa = mockSupabase({});
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.X");
  assertEquals(result, null);
});

Deno.test("resolveQuotedTask: last_outbound_context has no recent_outbound → null", async () => {
  // Backward-compat: profiles created before PR4 only have the single-slot
  // top-level fields, no `recent_outbound` array. Resolver must handle
  // this without throwing.
  const supa = mockSupabase({ last_outbound_context: {} });
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.X");
  assertEquals(result, null);
});

Deno.test("resolveQuotedTask: recent_outbound is empty array → null", async () => {
  const supa = mockSupabase({ last_outbound_context: { recent_outbound: [] } });
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.X");
  assertEquals(result, null);
});

Deno.test("resolveQuotedTask: recent_outbound is wrong type → null (no crash)", async () => {
  // deno-lint-ignore no-explicit-any
  const supa = mockSupabase({ last_outbound_context: { recent_outbound: "not-an-array" as any } });
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.X");
  assertEquals(result, null);
});

// ---------- Match cases ----------

Deno.test("resolveQuotedTask: matching WAMID with task_id → returns match", async () => {
  const supa = mockSupabase({
    last_outbound_context: {
      recent_outbound: [
        { wa_message_id: "wamid.A", task_id: "task-A", task_summary: "Medical Analysis", sent_at: "2026-05-01T07:43:00Z" },
        { wa_message_id: "wamid.B", task_id: "task-B", task_summary: "Electronic Prescription", sent_at: "2026-05-01T07:43:30Z" },
      ],
    },
  });
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.A");
  assertEquals(result, {
    task_id: "task-A",
    task_summary: "Medical Analysis",
    sent_at: "2026-05-01T07:43:00Z",
  });
});

Deno.test("resolveQuotedTask: SCREENSHOT SCENARIO — quoting first message resolves to FIRST task, not the more recent one", async () => {
  // The exact bug from the screenshot. Two replies sent within seconds:
  // "Saved: Medical Analysis" (first) and "Saved: Electronic Prescription"
  // (second, immediately after). The user QUOTED the first one and said
  // "fai alle 8". Pre-PR4 the system used `last_outbound_context.task_id`
  // which was overwritten by the second reply → set time on Electronic
  // Prescription (wrong). PR4 uses the WAMID match to resolve to the
  // task the user actually pointed at.
  const supa = mockSupabase({
    last_outbound_context: {
      recent_outbound: [
        { wa_message_id: "wamid.MED", task_id: "task-medical", task_summary: "Medical Analysis", sent_at: "2026-05-01T07:43:00Z" },
        { wa_message_id: "wamid.RX",  task_id: "task-prescription", task_summary: "Electronic Prescription", sent_at: "2026-05-01T07:43:02Z" },
      ],
    },
  });
  // User quoted the FIRST message (wamid.MED).
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.MED");
  assertEquals(result?.task_id, "task-medical");
  assertEquals(result?.task_summary, "Medical Analysis");
});

Deno.test("resolveQuotedTask: WAMID not in window → null (older than sliding window)", async () => {
  const supa = mockSupabase({
    last_outbound_context: {
      recent_outbound: [
        { wa_message_id: "wamid.recent1", task_id: "task-1", task_summary: "Task 1" },
        { wa_message_id: "wamid.recent2", task_id: "task-2", task_summary: "Task 2" },
      ],
    },
  });
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.OLDquoteThatNoLongerExists");
  assertEquals(result, null);
});

Deno.test("resolveQuotedTask: matching WAMID but no task_id → null (non-task quote)", async () => {
  // The user quoted a chat reply or a search result — those are stored
  // in the window for chronological completeness but have task_id=null.
  // Resolver must NOT pre-resolve a task in that case (would be the
  // wrong task or NULL → DB error).
  const supa = mockSupabase({
    last_outbound_context: {
      recent_outbound: [
        { wa_message_id: "wamid.chat", task_id: null, message_type: "chat" },
      ],
    },
  });
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.chat");
  assertEquals(result, null);
});

// ---------- Resilience ----------

Deno.test("resolveQuotedTask: DB query throws → null (best-effort, no rethrow)", async () => {
  const supa = mockSupabase(null, /* throwOnQuery */ true);
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.X");
  assertEquals(result, null);
});

Deno.test("resolveQuotedTask: missing task_summary defaults to empty string", async () => {
  const supa = mockSupabase({
    last_outbound_context: {
      recent_outbound: [
        // deno-lint-ignore no-explicit-any
        { wa_message_id: "wamid.X", task_id: "task-X" } as any,
      ],
    },
  });
  const result = await resolveQuotedTask(supa as any, "user-1", "wamid.X");
  assertEquals(result?.task_id, "task-X");
  assertEquals(result?.task_summary, "");
});
