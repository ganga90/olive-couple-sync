/**
 * Unit tests for trust-gate-check.
 *
 * These tests use a hand-rolled fake supabase client because the real
 * one needs network access. The fake records every call so we can
 * assert that the helper made the right inserts/reads in the right
 * order — and that fail-soft cases never write to the queue.
 *
 * Test plan:
 *   1. soul_disabled → allowed=true with soul_disabled flag, no DB writes
 *   2. level 3 (autonomous) → allowed=true, no queue insert
 *   3. level 2 (act+report) → allowed=true, no queue insert
 *   4. level 1 (suggest) → allowed=false, queue + notification inserted
 *   5. level 0 (inform) → allowed=false, different copy on notification
 *   6. unknown action_type defaults to level 0 (queues)
 *   7. queue insert fails → failed_open=true (gate fails open)
 *   8. matrix read throws → failed_open=true
 *   9. missing params → returns failed_open
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkTrustForAction, isFailSoftOrSoulOff } from "./trust-gate-check.ts";

// ─── Fake supabase client ───────────────────────────────────────────
//
// Records every method call. Tests configure return values per-table.

type ChainResult = { data?: unknown; error?: unknown };

interface FakeBehavior {
  prefs?: ChainResult; // for olive_user_preferences.maybeSingle()
  soulLayer?: ChainResult; // for olive_soul_layers.maybeSingle()
  insertAction?: ChainResult; // for olive_trust_actions.insert(...).select.single()
  insertNotification?: ChainResult; // for olive_trust_notifications.insert(...)
  matrixThrows?: boolean;
  insertActionThrows?: boolean;
}

interface CallLog {
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
}

function makeFakeSupabase(behavior: FakeBehavior = {}, log: CallLog) {
  return {
    from(table: string) {
      // All shapes return chainable shapes that resolve to ChainResult-ish.
      return {
        select: (_cols?: string) => ({
          eq: (_c: string, _v: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              eq: (_c3: string, _v3: unknown) => ({
                maybeSingle: async () => {
                  if (table === "olive_soul_layers") {
                    if (behavior.matrixThrows) throw new Error("simulated read failure");
                    return behavior.soulLayer ?? { data: null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
              maybeSingle: async () => {
                if (table === "olive_user_preferences") {
                  return behavior.prefs ?? { data: null, error: null };
                }
                return { data: null, error: null };
              },
            }),
            maybeSingle: async () => {
              if (table === "olive_user_preferences") {
                return behavior.prefs ?? { data: null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          log.inserts.push({ table, row });
          return {
            select: (_cols?: string) => ({
              single: async () => {
                if (table === "olive_trust_actions") {
                  if (behavior.insertActionThrows) throw new Error("simulated insert failure");
                  return behavior.insertAction ?? { data: { id: "queued-uuid-1" }, error: null };
                }
                return { data: null, error: null };
              },
            }),
            // some callsites await insert directly without .select
            then: (resolve: (v: ChainResult) => unknown) => {
              if (table === "olive_trust_notifications") {
                resolve(behavior.insertNotification ?? { data: null, error: null });
              } else {
                resolve({ data: null, error: null });
              }
            },
          };
        },
      };
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

Deno.test("checkTrustForAction: soul_disabled → allowed without DB writes", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    { prefs: { data: { soul_enabled: false }, error: null } },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "send_whatsapp_to_partner",
  });
  assertEquals(r.allowed, true);
  assertEquals(r.soul_disabled, true);
  assertEquals(log.inserts.length, 0);
  assertEquals(isFailSoftOrSoulOff(r), true);
});

Deno.test("checkTrustForAction: level 3 (autonomous) → allowed, no queue", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      prefs: { data: { soul_enabled: true }, error: null },
      soulLayer: {
        data: { content: { trust_matrix: { send_reminder_to_self: 3 } } },
        error: null,
      },
    },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "send_reminder_to_self",
  });
  assertEquals(r.allowed, true);
  assertEquals(r.trust_level, 3);
  assertEquals(r.trust_level_name, "AUTONOMOUS");
  assertEquals(log.inserts.length, 0);
});

Deno.test("checkTrustForAction: level 2 (act+report) → allowed, no queue", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      prefs: { data: { soul_enabled: true }, error: null },
      soulLayer: {
        data: { content: { trust_matrix: { send_whatsapp_to_self: 2 } } },
        error: null,
      },
    },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "send_whatsapp_to_self",
  });
  assertEquals(r.allowed, true);
  assertEquals(r.trust_level, 2);
  assertEquals(log.inserts.length, 0);
});

Deno.test("checkTrustForAction: level 1 (suggest) → queued with notification", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      prefs: { data: { soul_enabled: true }, error: null },
      soulLayer: {
        data: { content: { trust_matrix: { assign_task: 1 } } },
        error: null,
      },
    },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "assign_task",
    actionDescription: "assign 'buy milk' to Marco",
  });
  assertEquals(r.allowed, false);
  assertEquals(r.trust_level, 1);
  assertEquals(r.trust_level_name, "SUGGEST");
  assertEquals(typeof r.action_id, "string");
  // Both inserts happened: queue + notification
  const tables = log.inserts.map((i) => i.table);
  assertEquals(tables.includes("olive_trust_actions"), true);
  assertEquals(tables.includes("olive_trust_notifications"), true);
});

Deno.test("checkTrustForAction: level 0 (inform) → still queued, copy differs", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      prefs: { data: { soul_enabled: true }, error: null },
      soulLayer: {
        data: { content: { trust_matrix: { send_invoice: 0 } } },
        error: null,
      },
    },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "send_invoice",
    actionDescription: "send $1200 invoice to client X",
  });
  assertEquals(r.allowed, false);
  assertEquals(r.trust_level, 0);
  assertEquals(r.trust_level_name, "INFORM");
  // Notification body should differ between INFORM and SUGGEST levels.
  const notif = log.inserts.find((i) => i.table === "olive_trust_notifications");
  assertNotEquals(notif, undefined);
  // INFORM notifications open with "wants approval"
  const title = (notif as unknown as { row: { title: string } }).row.title;
  assertEquals(title.includes("wants approval"), true);
});

Deno.test("checkTrustForAction: unknown action_type defaults to level 0 → queued", async () => {
  // If an action_type isn't in the matrix, we treat it as INFORM.
  // Conservative default — better to over-gate a new action than to
  // silently auto-execute something we never agreed to.
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      prefs: { data: { soul_enabled: true }, error: null },
      soulLayer: {
        data: { content: { trust_matrix: {} } },
        error: null,
      },
    },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "frobnicate_widget",
  });
  assertEquals(r.allowed, false);
  assertEquals(r.trust_level, 0);
});

Deno.test("checkTrustForAction: queue insert error → fails open (allowed)", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      prefs: { data: { soul_enabled: true }, error: null },
      soulLayer: {
        data: { content: { trust_matrix: { assign_task: 1 } } },
        error: null,
      },
      insertAction: { data: null, error: { message: "DB unavailable" } },
    },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "assign_task",
  });
  assertEquals(r.allowed, true);
  assertEquals(r.failed_open, true);
  assertEquals(r.reason, "queue_insert_failed");
});

Deno.test("checkTrustForAction: matrix read throws → fails open (allowed)", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      prefs: { data: { soul_enabled: true }, error: null },
      matrixThrows: true,
    },
    log,
  );
  const r = await checkTrustForAction(sb, {
    userId: "u1",
    actionType: "assign_task",
  });
  assertEquals(r.allowed, true);
  assertEquals(r.failed_open, true);
});

Deno.test("checkTrustForAction: missing userId → fails open without throwing", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase({}, log);
  const r = await checkTrustForAction(sb, {
    userId: "",
    actionType: "assign_task",
  });
  assertEquals(r.allowed, true);
  assertEquals(r.failed_open, true);
  assertEquals(log.inserts.length, 0);
});

Deno.test("isFailSoftOrSoulOff: distinguishes earned-allow from fallback-allow", () => {
  assertEquals(
    isFailSoftOrSoulOff({ allowed: true, trust_level: 3, trust_level_name: "AUTONOMOUS" }),
    false,
  );
  assertEquals(
    isFailSoftOrSoulOff({
      allowed: true,
      trust_level: 0,
      trust_level_name: "INFORM",
      failed_open: true,
    }),
    true,
  );
  assertEquals(
    isFailSoftOrSoulOff({
      allowed: true,
      trust_level: 3,
      trust_level_name: "AUTONOMOUS",
      soul_disabled: true,
    }),
    true,
  );
});
