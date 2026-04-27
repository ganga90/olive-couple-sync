/**
 * Unit tests for soul-proposals.
 *
 * Focuses on the orchestrator behavior. Like trust-gate-check.test.ts,
 * uses a hand-rolled fake supabase client that records every call so we
 * can assert correct DB writes — and that fail-soft cases never cascade.
 *
 * Coverage:
 *   1. Happy path: layer exists at v3 → proposal inserted with base_version=3
 *      + notification row inserted
 *   2. Layer doesn't exist → base_version=0 (proposal can still apply)
 *   3. Insert error → ok:false with reason
 *   4. Notification error → ok:true (proposal still succeeds)
 *   5. skipNotification=true → no notification insert
 *   6. Missing params → ok:false without DB writes
 *   7. Unexpected exception → ok:false with reason
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { proposeMajorChange } from "./soul-proposals.ts";

interface CallLog {
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
}

interface FakeBehavior {
  layer?: { data?: { version: number } | null; error?: unknown };
  insertProposal?: { data?: { id: string; expires_at: string } | null; error?: unknown };
  notificationThrows?: boolean;
  layerReadThrows?: boolean;
}

function makeFakeSupabase(behavior: FakeBehavior, log: CallLog) {
  return {
    from(table: string) {
      return {
        select: (_cols?: string) => ({
          eq: (_c: string, _v: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              eq: (_c3: string, _v3: unknown) => ({
                maybeSingle: async () => {
                  if (table === "olive_soul_layers") {
                    if (behavior.layerReadThrows) throw new Error("simulated read failure");
                    return behavior.layer ?? { data: null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          log.inserts.push({ table, row });
          return {
            select: (_cols?: string) => ({
              single: async () => {
                if (table === "olive_soul_change_proposals") {
                  return behavior.insertProposal ?? {
                    data: { id: "proposal-uuid-1", expires_at: "2026-05-04T00:00:00Z" },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            }),
            // Notification insert is awaited directly without .select.single()
            then: (resolve: (v: unknown) => unknown) => {
              if (table === "olive_trust_notifications" && behavior.notificationThrows) {
                throw new Error("simulated notification insert failure");
              }
              resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
}

// ─── Happy path ────────────────────────────────────────────────────

Deno.test("proposeMajorChange: layer at v3 → proposal stamped with base_version=3", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      layer: { data: { version: 3 }, error: null },
    },
    log,
  );

  const result = await proposeMajorChange(sb, {
    userId: "user_abc",
    layerType: "user",
    proposedContent: { identity: { tone: "professional" } },
    summary: "Switch to professional tone — detected business usage",
    trigger: "industry_shift",
  });

  assertEquals(result.ok, true);
  assertEquals(result.proposal_id, "proposal-uuid-1");

  const proposalInsert = log.inserts.find((i) => i.table === "olive_soul_change_proposals");
  assertNotEquals(proposalInsert, undefined);
  assertEquals(proposalInsert!.row.base_version, 3);
  assertEquals(proposalInsert!.row.user_id, "user_abc");
  assertEquals(proposalInsert!.row.trigger, "industry_shift");
});

Deno.test("proposeMajorChange: layer missing → base_version=0 so proposal can still apply", async () => {
  // First-time evolution for a brand-new user has no existing layer.
  // The proposal should still be valid; upsertSoulLayer will create
  // the layer when approve_change runs.
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      layer: { data: null, error: null },
    },
    log,
  );

  const result = await proposeMajorChange(sb, {
    userId: "user_new",
    layerType: "user",
    proposedContent: { identity: { tone: "warm" } },
    summary: "Initial seed",
    trigger: "system",
  });

  assertEquals(result.ok, true);
  const proposalInsert = log.inserts.find((i) => i.table === "olive_soul_change_proposals");
  assertEquals(proposalInsert!.row.base_version, 0);
});

// ─── Notification side-channel ─────────────────────────────────────

Deno.test("proposeMajorChange: writes notification row by default", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      layer: { data: { version: 1 }, error: null },
    },
    log,
  );

  await proposeMajorChange(sb, {
    userId: "user_abc",
    layerType: "user",
    proposedContent: { identity: { tone: "direct" } },
    summary: "More direct tone",
    trigger: "feedback",
  });

  const notif = log.inserts.find((i) => i.table === "olive_trust_notifications");
  assertNotEquals(notif, undefined);
  assertEquals(notif!.row.type, "soul_change_proposal");
  assertEquals((notif!.row.title as string).includes("evolve"), true);
});

Deno.test("proposeMajorChange: skipNotification=true → no notification insert", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      layer: { data: { version: 1 }, error: null },
    },
    log,
  );

  const result = await proposeMajorChange(sb, {
    userId: "user_abc",
    layerType: "user",
    proposedContent: {},
    summary: "Test without UI",
    trigger: "manual",
    skipNotification: true,
  });

  assertEquals(result.ok, true);
  const notif = log.inserts.find((i) => i.table === "olive_trust_notifications");
  assertEquals(notif, undefined);
});

Deno.test("proposeMajorChange: notification failure does not poison the proposal", async () => {
  // The notification is best-effort. If it throws, the proposal row
  // is still committed; the user can find it via list_pending_proposals.
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      layer: { data: { version: 1 }, error: null },
      notificationThrows: true,
    },
    log,
  );

  const result = await proposeMajorChange(sb, {
    userId: "user_abc",
    layerType: "user",
    proposedContent: {},
    summary: "Test",
    trigger: "manual",
  });

  assertEquals(result.ok, true);
  assertEquals(result.proposal_id, "proposal-uuid-1");
});

// ─── Failure paths ────────────────────────────────────────────────

Deno.test("proposeMajorChange: insert failure returns ok:false with reason", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      layer: { data: { version: 1 }, error: null },
      insertProposal: { data: null, error: { message: "DB unavailable" } },
    },
    log,
  );

  const result = await proposeMajorChange(sb, {
    userId: "user_abc",
    layerType: "user",
    proposedContent: {},
    summary: "Test",
    trigger: "manual",
  });

  assertEquals(result.ok, false);
  assertEquals(result.reason, "insert_failed");
});

Deno.test("proposeMajorChange: layer read throws → returns ok:false (caller decides)", async () => {
  // Distinct from notification failure: if we can't even read the
  // current version, we can't safely propose. Caller should fall back
  // to deferred-log behavior.
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase(
    {
      layerReadThrows: true,
    },
    log,
  );

  const result = await proposeMajorChange(sb, {
    userId: "user_abc",
    layerType: "user",
    proposedContent: {},
    summary: "Test",
    trigger: "manual",
  });

  assertEquals(result.ok, false);
  assertEquals(result.reason, "exception");
});

Deno.test("proposeMajorChange: missing userId → no DB writes", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase({}, log);

  const result = await proposeMajorChange(sb, {
    userId: "",
    layerType: "user",
    proposedContent: {},
    summary: "Test",
    trigger: "manual",
  });

  assertEquals(result.ok, false);
  assertEquals(result.reason, "missing_required_params");
  assertEquals(log.inserts.length, 0);
});

Deno.test("proposeMajorChange: missing summary → no DB writes", async () => {
  const log: CallLog = { inserts: [] };
  const sb = makeFakeSupabase({}, log);

  const result = await proposeMajorChange(sb, {
    userId: "user_abc",
    layerType: "user",
    proposedContent: {},
    summary: "",
    trigger: "manual",
  });

  assertEquals(result.ok, false);
  assertEquals(log.inserts.length, 0);
});
