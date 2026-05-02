// Tests for the inbound clustering primitives. These cover the
// in-memory contract of `bufferEvent` / `hasActiveCluster` /
// `isStillLeader` / `claimCluster` against a hand-rolled mock that
// implements the minimal Supabase chain the helpers actually call.
//
// We deliberately don't spin up a real Postgres for these tests —
// the SQL-level invariants (UNIQUE on (user_id, wa_message_id),
// FOR UPDATE SKIP LOCKED on the claim, the partial index on
// flushed_at IS NULL) are owned by the migration and are exercised
// in the production smoke-test step. Here we lock down the JS-side
// contract of each helper so refactors don't silently break it.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BufferableEvent,
  type BufferedEvent,
  bufferEvent,
  CLUSTER_WINDOW_MS,
  claimCluster,
  hasActiveCluster,
  isClusterTrigger,
  isStillLeader,
} from "./inbound-cluster.ts";

// ─── In-memory mock of the Supabase client ────────────────────────────
// Models a single table (`olive_inbound_buffer`) and a single RPC
// (`claim_inbound_cluster`). Just enough to exercise the helpers'
// query shapes — not a general-purpose Supabase emulator.

interface MockState {
  rows: BufferedEvent[];
  rpcLog: Array<{ fn: string; args: any }>;
  /** Force the next .insert() to fail with the given error. */
  forceInsertError?: { code: string; message: string };
  /** Force the next .select() / RPC to fail. */
  forceQueryError?: string;
}

function mockSupabase(state: MockState) {
  // The chain we model:
  //   .from(table).select(cols, opts?).eq(c,v).is(c,v).neq(c,v).gt(c,v).limit(n)
  //   .from(table).insert({...}).select(...).single()
  //   .rpc(name, args)
  //
  // .single() and the implicit terminator at the end of a select chain
  // both resolve with { data, error }.

  function makeSelectChain(rows: BufferedEvent[], opts: { headOnly?: boolean }) {
    const filters: Array<(r: BufferedEvent) => boolean> = [];
    let limit = Infinity;
    const chain: any = {
      eq: (col: keyof BufferedEvent, val: any) => {
        filters.push((r) => r[col] === val);
        return chain;
      },
      is: (col: keyof BufferedEvent, val: any) => {
        // Only `null` matters for our usage.
        filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
        return chain;
      },
      neq: (col: keyof BufferedEvent, val: any) => {
        filters.push((r) => r[col] !== val);
        return chain;
      },
      gt: (col: keyof BufferedEvent, val: any) => {
        filters.push((r) => (r[col] as any) > val);
        return chain;
      },
      limit: (n: number) => {
        limit = n;
        return chain;
      },
      then: (resolve: any) => {
        if (state.forceQueryError) {
          const err = state.forceQueryError;
          state.forceQueryError = undefined;
          resolve({ data: null, error: { message: err } });
          return;
        }
        const matched = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
        if (opts.headOnly) {
          resolve({ data: null, error: null, count: matched.length });
        } else {
          resolve({ data: matched, error: null });
        }
      },
    };
    return chain;
  }

  function makeInsertChain(payload: Record<string, any>) {
    let captured: BufferedEvent | null = null;
    const chain: any = {
      select: (_cols: string) => chain,
      single: () => {
        if (state.forceInsertError) {
          const err = state.forceInsertError;
          state.forceInsertError = undefined;
          return Promise.resolve({ data: null, error: err });
        }
        // Enforce UNIQUE (user_id, wa_message_id).
        const dup = state.rows.find(
          (r) => r.user_id === payload.user_id && r.wa_message_id === payload.wa_message_id,
        );
        if (dup) {
          return Promise.resolve({
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          });
        }
        // Preserve the exact payload values, including nulls — the
        // tests assert on what the helper passed to insert().
        captured = {
          id: `mock-${state.rows.length + 1}`,
          user_id: payload.user_id,
          wa_message_id: payload.wa_message_id,
          message_body: payload.message_body ?? null,
          // Intentionally NOT defaulting to []; null is the helper's
          // choice for empty media and tests need to see it.
          media_urls: payload.media_urls,
          media_types: payload.media_types,
          latitude: payload.latitude ?? null,
          longitude: payload.longitude ?? null,
          quoted_message_id: payload.quoted_message_id ?? null,
          received_at: payload.received_at,
          cluster_id: null,
          flushed_at: null,
          created_at: new Date().toISOString(),
        };
        state.rows.push(captured);
        return Promise.resolve({ data: { id: captured.id }, error: null });
      },
    };
    return chain;
  }

  return {
    from: (_table: string) => ({
      select: (_cols: string, opts?: { count?: string; head?: boolean }) =>
        makeSelectChain(state.rows, { headOnly: !!opts?.head }),
      insert: (payload: Record<string, any>) => makeInsertChain(payload),
    }),
    rpc: (fn: string, args: any) => {
      state.rpcLog.push({ fn, args });
      if (state.forceQueryError) {
        const err = state.forceQueryError;
        state.forceQueryError = undefined;
        return Promise.resolve({ data: null, error: { message: err } });
      }
      if (fn !== "claim_inbound_cluster") {
        return Promise.resolve({ data: null, error: { message: `unknown RPC ${fn}` } });
      }
      // Match SQL: claim all unflushed for user with received_at <= max.
      const claimed = state.rows
        .filter(
          (r) =>
            r.user_id === args.p_user_id &&
            r.flushed_at === null &&
            r.received_at <= args.p_max_received_at,
        )
        .sort((a, b) => a.received_at.localeCompare(b.received_at));
      // Mutate in place to reflect the UPDATE the RPC performs.
      for (const c of claimed) {
        c.flushed_at = new Date().toISOString();
        c.cluster_id = args.p_cluster_id;
      }
      return Promise.resolve({ data: claimed, error: null });
    },
  };
}

function makeEvent(overrides: Partial<BufferableEvent> = {}): BufferableEvent {
  return {
    user_id: "user-A",
    wa_message_id: "wamid.A1",
    message_body: null,
    media_urls: [],
    media_types: [],
    latitude: null,
    longitude: null,
    quoted_message_id: null,
    received_at: "2026-05-02T12:00:00.000Z",
    ...overrides,
  };
}

// ─── isClusterTrigger ─────────────────────────────────────────────────

Deno.test("isClusterTrigger: image media triggers", () => {
  assertEquals(isClusterTrigger({ message_body: null, media_urls: ["https://x/a.jpg"] }), true);
});

Deno.test("isClusterTrigger: voice media triggers", () => {
  assertEquals(isClusterTrigger({ message_body: null, media_urls: ["https://x/a.ogg"] }), true);
});

Deno.test("isClusterTrigger: text containing http URL triggers", () => {
  assertEquals(isClusterTrigger({ message_body: "check this out https://example.com", media_urls: [] }), true);
});

Deno.test("isClusterTrigger: text containing https URL triggers", () => {
  assertEquals(isClusterTrigger({ message_body: "https://witholive.app", media_urls: [] }), true);
});

Deno.test("isClusterTrigger: plain text does NOT trigger", () => {
  assertEquals(isClusterTrigger({ message_body: "buy milk tomorrow", media_urls: [] }), false);
});

Deno.test("isClusterTrigger: empty event does NOT trigger", () => {
  assertEquals(isClusterTrigger({ message_body: null, media_urls: [] }), false);
});

Deno.test("isClusterTrigger: text mentioning 'http' but no URL does NOT trigger", () => {
  // "https" alone without a colon-slash-slash is not a URL.
  assertEquals(isClusterTrigger({ message_body: "I prefer https over http for security", media_urls: [] }), false);
});

// ─── CLUSTER_WINDOW_MS contract ──────────────────────────────────────

Deno.test("CLUSTER_WINDOW_MS: locked at 7000ms (the product spec)", () => {
  // Exposed as a constant so the webhook and tests both read the same
  // value. Changing it here changes the latency contract — must be
  // accompanied by a product decision and a plan update.
  assertEquals(CLUSTER_WINDOW_MS, 7000);
});

// ─── bufferEvent ─────────────────────────────────────────────────────

Deno.test("bufferEvent: success returns id and isDuplicate=false", async () => {
  const state: MockState = { rows: [], rpcLog: [] };
  const supa = mockSupabase(state);
  const result = await bufferEvent(supa, makeEvent());
  assertEquals(result?.isDuplicate, false);
  assertEquals(typeof (result as any)?.id, "string");
  assertEquals(state.rows.length, 1);
  assertEquals(state.rows[0].user_id, "user-A");
  assertEquals(state.rows[0].wa_message_id, "wamid.A1");
  assertEquals(state.rows[0].flushed_at, null);
});

Deno.test("bufferEvent: duplicate WAMID returns isDuplicate=true (Meta retry)", async () => {
  // Meta retries the webhook if it doesn't see a 200 fast enough, so
  // we MUST be idempotent on (user_id, wa_message_id). The migration
  // enforces this with a UNIQUE index; the helper detects it via the
  // 23505 unique_violation code and signals the caller to bail.
  const state: MockState = { rows: [], rpcLog: [] };
  const supa = mockSupabase(state);
  await bufferEvent(supa, makeEvent());
  const second = await bufferEvent(supa, makeEvent());
  assertEquals(second?.isDuplicate, true);
  assertEquals(second?.id, null);
  assertEquals(state.rows.length, 1); // still just the original
});

Deno.test("bufferEvent: non-unique-violation insert error returns null", async () => {
  // Anything other than 23505 (e.g., connection error) returns null
  // and the caller is expected to fail-soft to the existing fast path.
  const state: MockState = {
    rows: [],
    rpcLog: [],
    forceInsertError: { code: "53300", message: "too_many_connections" },
  };
  const supa = mockSupabase(state);
  const result = await bufferEvent(supa, makeEvent());
  assertEquals(result, null);
});

Deno.test("bufferEvent: empty media arrays serialize as null (matches column nullability)", async () => {
  // Postgres `text[]` distinguishes NULL from `{}`. Storing `{}` for
  // every text-only buffered event would bloat the table; we
  // collapse empty-array → NULL to keep the storage tight.
  const state: MockState = { rows: [], rpcLog: [] };
  const supa = mockSupabase(state);
  await bufferEvent(supa, makeEvent({ media_urls: [], media_types: [] }));
  // The mock captures whatever the helper passed to insert(); empty
  // array → null is expected.
  assertEquals(state.rows[0].media_urls, null as any);
  assertEquals(state.rows[0].media_types, null as any);
});

Deno.test("bufferEvent: non-empty media arrays preserved verbatim", async () => {
  const state: MockState = { rows: [], rpcLog: [] };
  const supa = mockSupabase(state);
  await bufferEvent(
    supa,
    makeEvent({ media_urls: ["u1", "u2"], media_types: ["image/jpeg", "image/png"] }),
  );
  assertEquals(state.rows[0].media_urls, ["u1", "u2"]);
  assertEquals(state.rows[0].media_types, ["image/jpeg", "image/png"]);
});

// ─── hasActiveCluster ────────────────────────────────────────────────

Deno.test("hasActiveCluster: no rows → false", async () => {
  const state: MockState = { rows: [], rpcLog: [] };
  const supa = mockSupabase(state);
  assertEquals(await hasActiveCluster(supa, "user-A", null), false);
});

Deno.test("hasActiveCluster: only flushed rows → false", async () => {
  const state: MockState = {
    rows: [
      {
        id: "r1",
        user_id: "user-A",
        wa_message_id: "x",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T11:50:00Z",
        cluster_id: "c1",
        flushed_at: "2026-05-02T11:50:07Z",
        created_at: "2026-05-02T11:50:00Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  assertEquals(await hasActiveCluster(supa, "user-A", null), false);
});

Deno.test("hasActiveCluster: unflushed row from same user → true", async () => {
  const state: MockState = {
    rows: [
      {
        id: "r1",
        user_id: "user-A",
        wa_message_id: "x",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T11:59:55Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T11:59:55Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  assertEquals(await hasActiveCluster(supa, "user-A", null), true);
});

Deno.test("hasActiveCluster: another user's unflushed row → false (user-scoped)", async () => {
  const state: MockState = {
    rows: [
      {
        id: "r1",
        user_id: "user-OTHER",
        wa_message_id: "x",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T11:59:55Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T11:59:55Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  assertEquals(await hasActiveCluster(supa, "user-A", null), false);
});

Deno.test("hasActiveCluster: excludeId skips the just-inserted row", async () => {
  // The webhook inserts its own event THEN asks "is there an OTHER
  // active row?". Without excludeId, the helper would always say yes
  // (the just-inserted row counts) and we'd never send a brief ack.
  const state: MockState = {
    rows: [
      {
        id: "self-row",
        user_id: "user-A",
        wa_message_id: "x",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:00Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:00Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  assertEquals(await hasActiveCluster(supa, "user-A", "self-row"), false);
});

Deno.test("hasActiveCluster: query error → fail-safe true (don't double-ack)", async () => {
  // Better to suppress an ack on a transient DB hiccup than to spam.
  const state: MockState = { rows: [], rpcLog: [], forceQueryError: "DB unavailable" };
  const supa = mockSupabase(state);
  assertEquals(await hasActiveCluster(supa, "user-A", null), true);
});

// ─── isStillLeader ───────────────────────────────────────────────────

Deno.test("isStillLeader: no newer events → true (I'm still the leader)", async () => {
  const state: MockState = {
    rows: [
      {
        id: "self",
        user_id: "user-A",
        wa_message_id: "x",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:00Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:00Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  assertEquals(await isStillLeader(supa, "user-A", "2026-05-02T12:00:00Z"), true);
});

Deno.test("isStillLeader: newer unflushed event → false (yield)", async () => {
  const state: MockState = {
    rows: [
      {
        id: "newer",
        user_id: "user-A",
        wa_message_id: "y",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:03Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:03Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  assertEquals(await isStillLeader(supa, "user-A", "2026-05-02T12:00:00Z"), false);
});

Deno.test("isStillLeader: newer event already flushed → still leader for unflushed window", async () => {
  // If a newer event raced past me, claimed, and finished, I'm
  // technically still a viable leader for whatever unflushed remains.
  // (In practice the claim takes everything, so this is a safety check.)
  const state: MockState = {
    rows: [
      {
        id: "newer-flushed",
        user_id: "user-A",
        wa_message_id: "y",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:03Z",
        cluster_id: "c1",
        flushed_at: "2026-05-02T12:00:10Z",
        created_at: "2026-05-02T12:00:03Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  assertEquals(await isStillLeader(supa, "user-A", "2026-05-02T12:00:00Z"), true);
});

Deno.test("isStillLeader: query error → fail-CLOSED (yield, false)", async () => {
  // Critical safety: if we can't determine leadership, we must NOT
  // proceed to claim. Better to drop a cluster than to double-process.
  const state: MockState = { rows: [], rpcLog: [], forceQueryError: "DB unavailable" };
  const supa = mockSupabase(state);
  assertEquals(await isStillLeader(supa, "user-A", "2026-05-02T12:00:00Z"), false);
});

// ─── claimCluster ────────────────────────────────────────────────────

Deno.test("claimCluster: returns all unflushed events for the user, sorted by received_at", async () => {
  const state: MockState = {
    rows: [
      {
        id: "e1",
        user_id: "user-A",
        wa_message_id: "w1",
        message_body: "first",
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:00Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:00Z",
      },
      {
        id: "e2",
        user_id: "user-A",
        wa_message_id: "w2",
        message_body: "second",
        media_urls: ["u"],
        media_types: ["image/jpeg"],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:03Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:03Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  const claimed = await claimCluster(supa, "user-A", "cluster-123");
  assertEquals(claimed.length, 2);
  assertEquals(claimed[0].wa_message_id, "w1");
  assertEquals(claimed[1].wa_message_id, "w2");
  // Both rows mutated to flushed.
  assertEquals(state.rows.every((r) => r.flushed_at !== null), true);
  assertEquals(state.rows.every((r) => r.cluster_id === "cluster-123"), true);
});

Deno.test("claimCluster: ignores other users' events (user-scoped)", async () => {
  const state: MockState = {
    rows: [
      {
        id: "e1",
        user_id: "user-A",
        wa_message_id: "w1",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:00Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:00Z",
      },
      {
        id: "e2",
        user_id: "user-B",
        wa_message_id: "w2",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:00Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:00Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  const claimed = await claimCluster(supa, "user-A", "c");
  assertEquals(claimed.length, 1);
  assertEquals(claimed[0].user_id, "user-A");
  // user-B's event stays unflushed.
  assertEquals(state.rows.find((r) => r.id === "e2")?.flushed_at, null);
});

Deno.test("claimCluster: respects max_received_at cutoff", async () => {
  // The webhook passes "now" as the cutoff — anything that arrived
  // strictly later than the leader's frame is left for the next round.
  const state: MockState = {
    rows: [
      {
        id: "e1",
        user_id: "user-A",
        wa_message_id: "w1",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:00Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:00Z",
      },
      {
        id: "e2",
        user_id: "user-A",
        wa_message_id: "w2",
        message_body: null,
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:10Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:10Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  const claimed = await claimCluster(supa, "user-A", "c", "2026-05-02T12:00:05Z");
  assertEquals(claimed.length, 1);
  assertEquals(claimed[0].wa_message_id, "w1");
  // e2 still pending.
  assertEquals(state.rows.find((r) => r.id === "e2")?.flushed_at, null);
});

Deno.test("claimCluster: empty result on race-loss / nothing to claim", async () => {
  const state: MockState = { rows: [], rpcLog: [] };
  const supa = mockSupabase(state);
  const claimed = await claimCluster(supa, "user-A", "c");
  assertEquals(claimed, []);
});

Deno.test("claimCluster: RPC error → empty array (caller no-ops)", async () => {
  const state: MockState = { rows: [], rpcLog: [], forceQueryError: "DB unavailable" };
  const supa = mockSupabase(state);
  const claimed = await claimCluster(supa, "user-A", "c");
  assertEquals(claimed, []);
});

Deno.test("claimCluster: passes the right RPC name and args", async () => {
  // Lock the wire format. If someone later renames the RPC or changes
  // its argument shape, this test fails in CI before production drifts.
  const state: MockState = { rows: [], rpcLog: [] };
  const supa = mockSupabase(state);
  await claimCluster(supa, "user-A", "cluster-X", "2026-05-02T12:00:05Z");
  assertEquals(state.rpcLog.length, 1);
  assertEquals(state.rpcLog[0].fn, "claim_inbound_cluster");
  assertEquals(state.rpcLog[0].args, {
    p_user_id: "user-A",
    p_cluster_id: "cluster-X",
    p_max_received_at: "2026-05-02T12:00:05Z",
  });
});

// ─── Concurrent leader scenario ──────────────────────────────────────

Deno.test("integration: two leaders race past isStillLeader; first claim wins", async () => {
  // Simulates the race we explicitly designed for: both webhooks see
  // themselves as still-leader, both call claimCluster. The mock
  // mirrors the SQL-level FOR UPDATE SKIP LOCKED behavior — the
  // first call gets the rows, the second sees them already flushed.
  const state: MockState = {
    rows: [
      {
        id: "e1",
        user_id: "user-A",
        wa_message_id: "w1",
        message_body: "shared",
        media_urls: [],
        media_types: [],
        latitude: null,
        longitude: null,
        quoted_message_id: null,
        received_at: "2026-05-02T12:00:00Z",
        cluster_id: null,
        flushed_at: null,
        created_at: "2026-05-02T12:00:00Z",
      },
    ],
    rpcLog: [],
  };
  const supa = mockSupabase(state);
  const winner = await claimCluster(supa, "user-A", "cluster-A");
  const loser = await claimCluster(supa, "user-A", "cluster-B");
  assertEquals(winner.length, 1);
  assertEquals(loser.length, 0);
  // First cluster_id sticks.
  assertEquals(state.rows[0].cluster_id, "cluster-A");
});
