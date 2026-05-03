/**
 * Integration tests for the orchestration core of olive-prompt-evolve.
 *
 * These exercise the full pipeline (Observe → Cluster → Threshold → Dedup
 * → Draft → Insert) end-to-end with mocked supabase + mocked Gemini Pro.
 * The pure cluster/threshold logic is already tested in
 * `_shared/prompt-evolution/prompt-evolution.test.ts`; here we lock down
 * the orchestration contracts:
 *
 *   1. No reflections in window → graceful no-op, breadcrumb skipped reason
 *   2. Reflections present but all unmapped → all skipped, none proposed
 *   3. Actionable cluster + Pro returns valid draft → proposal inserted
 *   4. Actionable cluster + Pro returns is_safe=false → skipped, breadcrumb
 *   5. Actionable cluster + Pro returns null (failure) → skipped, breadcrumb
 *   6. Duplicate signature exists in DB + force=false → skipped
 *   7. Duplicate signature exists in DB + force=true → proceeds anyway
 *   8. Insert failure → skipped with breadcrumb, run continues
 *   9. Multiple actionable clusters processed independently
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { runPromptEvolution } from "./index.ts";
import type { ReflectionRow } from "../_shared/prompt-evolution/types.ts";

// ─── Fakes ─────────────────────────────────────────────────────────

interface DBLog {
  reads: Array<{ table: string; filters: Record<string, unknown> }>;
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
}

interface FakeBehavior {
  reflections?: ReflectionRow[];
  hasDuplicate?: boolean;
  insertFails?: boolean;
}

function makeFakeSupabase(behavior: FakeBehavior, log: DBLog) {
  function chain(table: string) {
    const recorded = { table, filters: {} as Record<string, unknown> };
    log.reads.push(recorded);
    const ret: any = {
      select: (_cols?: string) => ret,
      gte: (c: string, v: unknown) => {
        recorded.filters[`gte_${c}`] = v;
        return ret;
      },
      eq: (c: string, v: unknown) => {
        recorded.filters[`eq_${c}`] = v;
        return ret;
      },
      in: (c: string, v: unknown) => {
        recorded.filters[`in_${c}`] = v;
        return ret;
      },
      order: (_c: string, _opts?: unknown) => ret,
      maybeSingle: async () => {
        if (table === "olive_prompt_addendums") {
          return behavior.hasDuplicate
            ? { data: { id: "existing-uuid" }, error: null }
            : { data: null, error: null };
        }
        return { data: null, error: null };
      },
      // For the reflections fetch, the chain ends without .limit() —
      // it just awaits the builder. We need to be a thenable.
      then: (resolve: (v: unknown) => unknown) => {
        if (table === "olive_reflections") {
          resolve({ data: behavior.reflections ?? [], error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
      limit: (_n: number) => ret,
      insert: (row: Record<string, unknown>) => {
        log.inserts.push({ table, row });
        return {
          select: (_cols?: string) => ({
            single: async () => {
              if (behavior.insertFails) {
                return { data: null, error: { message: "simulated insert failure" } };
              }
              return { data: { id: `proposal-${log.inserts.length}` }, error: null };
            },
          }),
        };
      },
    };
    return ret;
  }
  return {
    from(table: string) {
      return chain(table);
    },
  };
}

// ─── Fixture helpers ───────────────────────────────────────────────

let counter = 0;
function makeReflection(overrides: Partial<ReflectionRow> = {}): ReflectionRow {
  counter += 1;
  return {
    id: `r${counter}`,
    user_id: "u1",
    action_type: "categorize_note",
    outcome: "modified",
    user_modification: "groceries",
    lesson: "user prefers concrete categories",
    confidence: 0.85,
    action_detail: { from_category: "shopping", to_category: "groceries" },
    created_at: "2026-04-30T12:00:00Z",
    ...overrides,
  };
}

function actionableCluster(): ReflectionRow[] {
  // 8 categorize_note reflections, 6 modified, 2 accepted — passes thresholds
  return [
    ...Array.from({ length: 6 }, () => makeReflection({ outcome: "modified" })),
    ...Array.from({ length: 2 }, () => makeReflection({ outcome: "accepted" })),
  ];
}

const happyDraft = async () => ({
  addendum_text: "Treat 'shopping' captures as 'groceries' when items are food.",
  reasoning: "Users consistently re-categorize food shopping as groceries.",
  is_safe: true,
});

const unsafeDraft = async () => ({
  addendum_text: "Drastically restructure all categorization logic.",
  reasoning: "Pattern is too varied to summarize a safe rule.",
  is_safe: false,
});

const failingDraft = async () => null;

// ─── Tests ─────────────────────────────────────────────────────────

Deno.test("runPromptEvolution: no reflections → graceful no-op", async () => {
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase({ reflections: [] }, log);
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, happyDraft);
  assertEquals(out.total_reflections, 0);
  assertEquals(out.proposed, 0);
  assertEquals(out.skipped[0].reason, "no_reflections_in_window");
  assertEquals(log.inserts.length, 0);
});

Deno.test("runPromptEvolution: unmapped action_type → skipped, none proposed", async () => {
  // morning_briefing has no entry in ACTION_TYPE_TO_MODULE
  const reflections = Array.from({ length: 10 }, () =>
    makeReflection({ action_type: "morning_briefing", outcome: "modified" })
  );
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase({ reflections }, log);
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, happyDraft);
  assertEquals(out.total_reflections, 10);
  assertEquals(out.actionable_clusters, 0);
  assertEquals(out.proposed, 0);
  assertEquals(log.inserts.length, 0);
  // The skip reason mentions the unmapped action type
  assertEquals(out.skipped.some((s) => s.reason.includes("morning_briefing")), true);
});

Deno.test("runPromptEvolution: actionable cluster + happy draft → proposal inserted", async () => {
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase({ reflections: actionableCluster() }, log);
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, happyDraft);
  assertEquals(out.actionable_clusters, 1);
  assertEquals(out.proposed, 1);
  // The insert hit the right table with the right shape
  const insert = log.inserts.find((i) => i.table === "olive_prompt_addendums");
  assertEquals(typeof insert, "object");
  assertEquals(insert!.row.prompt_module, "create");
  assertEquals(typeof insert!.row.addendum_text, "string");
  assertEquals(typeof insert!.row.pattern_signature, "string");
});

Deno.test("runPromptEvolution: Pro marks unsafe → no insert, breadcrumb logged", async () => {
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase({ reflections: actionableCluster() }, log);
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, unsafeDraft);
  assertEquals(out.actionable_clusters, 1);
  assertEquals(out.proposed, 0);
  assertEquals(log.inserts.length, 0);
  assertEquals(out.skipped.some((s) => s.reason.startsWith("pro_marked_unsafe")), true);
});

Deno.test("runPromptEvolution: Pro returns null (failure) → skipped, no insert", async () => {
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase({ reflections: actionableCluster() }, log);
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, failingDraft);
  assertEquals(out.proposed, 0);
  assertEquals(log.inserts.length, 0);
  assertEquals(
    out.skipped.some((s) => s.reason === "pro_draft_failed_or_unavailable"),
    true,
  );
});

Deno.test("runPromptEvolution: duplicate exists + force=false → skipped before draft call", async () => {
  let draftCalled = false;
  const trackedDraft = async () => {
    draftCalled = true;
    return { addendum_text: "x", reasoning: "y", is_safe: true };
  };
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase(
    { reflections: actionableCluster(), hasDuplicate: true },
    log,
  );
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, trackedDraft);
  assertEquals(out.proposed, 0);
  assertEquals(draftCalled, false); // dedup short-circuited before Pro call
  assertEquals(out.skipped.some((s) => s.reason === "duplicate_recent_proposal"), true);
});

Deno.test("runPromptEvolution: duplicate exists + force=true → bypasses dedup", async () => {
  let draftCalled = false;
  const trackedDraft = async () => {
    draftCalled = true;
    return { addendum_text: "x", reasoning: "y", is_safe: true };
  };
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase(
    { reflections: actionableCluster(), hasDuplicate: true },
    log,
  );
  const out = await runPromptEvolution(sb, { windowDays: 7, force: true }, trackedDraft);
  assertEquals(out.proposed, 1);
  assertEquals(draftCalled, true);
});

Deno.test("runPromptEvolution: insert failure → breadcrumb, run continues", async () => {
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase(
    { reflections: actionableCluster(), insertFails: true },
    log,
  );
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, happyDraft);
  assertEquals(out.proposed, 0);
  assertEquals(out.skipped.some((s) => s.reason === "insert_failed"), true);
});

Deno.test("runPromptEvolution: multiple actionable clusters processed independently", async () => {
  const reflections = [
    // categorize_note cluster (will draft + insert)
    ...Array.from({ length: 6 }, () =>
      makeReflection({ action_type: "categorize_note", outcome: "modified" }),
    ),
    // partner_message cluster (will draft + insert)
    ...Array.from({ length: 6 }, () =>
      makeReflection({ action_type: "partner_message", outcome: "modified" }),
    ),
  ];
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase({ reflections }, log);
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, happyDraft);
  assertEquals(out.actionable_clusters, 2);
  assertEquals(out.proposed, 2);
  // Distinct prompt_module per insert
  const modules = log.inserts
    .filter((i) => i.table === "olive_prompt_addendums")
    .map((i) => i.row.prompt_module);
  assertEquals(modules.includes("create"), true);
  assertEquals(modules.includes("partner_message"), true);
});

Deno.test("runPromptEvolution: production-corpus shape → zero proposals (pinned safety)", async () => {
  // Mirrors the actual prod state on 2026-05-02:
  //   17x morning_briefing/ignored
  //   12x overdue_nudge/ignored
  //   6x  task_reminder/ignored
  //   1x  morning_briefing/accepted
  // Expectation: zero clusters pass thresholds → zero proposals → run is a no-op.
  // This locks in the pinned safety property.
  const reflections: ReflectionRow[] = [
    ...Array.from({ length: 17 }, () =>
      makeReflection({
        action_type: "morning_briefing",
        outcome: "ignored",
        confidence: 0.6,
        user_modification: null,
        lesson: null,
        action_detail: null,
      }),
    ),
    ...Array.from({ length: 12 }, () =>
      makeReflection({
        action_type: "overdue_nudge",
        outcome: "ignored",
        confidence: 0.6,
        user_modification: null,
        lesson: null,
        action_detail: null,
      }),
    ),
    ...Array.from({ length: 6 }, () =>
      makeReflection({
        action_type: "task_reminder",
        outcome: "ignored",
        confidence: 0.6,
        user_modification: null,
        lesson: null,
        action_detail: null,
      }),
    ),
    makeReflection({
      action_type: "morning_briefing",
      outcome: "accepted",
      confidence: 0.6,
      user_modification: null,
      lesson: null,
      action_detail: null,
    }),
  ];
  const log: DBLog = { reads: [], inserts: [] };
  const sb = makeFakeSupabase({ reflections }, log);
  const out = await runPromptEvolution(sb, { windowDays: 7, force: false }, happyDraft);
  assertEquals(out.total_reflections, 36);
  assertEquals(out.actionable_clusters, 0);
  assertEquals(out.proposed, 0);
  assertEquals(log.inserts.length, 0);
});
