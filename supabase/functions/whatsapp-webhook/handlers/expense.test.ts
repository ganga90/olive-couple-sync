// Tests for the EXPENSE handler.
// ============================================================================
// Coverage (Initiative 1.7 acceptance criteria — happy path + 2 edge cases):
//
//   #  | Test                                                       | Asserts
//   ───|────────────────────────────────────────────────────────────|──────────────
//   1  | text-only happy path: amount parsed + categorized + insert | t() called, insert payload correct
//   2  | parseExpenseText returns null → expense_need_amount         | no insert
//   3  | AI categorization throws → regex fallback for merchant      | insert proceeds with regex merchant
//   4  | media attached → process-receipt invoked + transaction echo | functions.invoke called, no expenses insert
//   5  | over_limit budget status → over-budget line appended        | reply text contains the localized warning

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { HandlerContext, ConversationContext } from "../../_shared/types.ts";
import { makeExpenseHandler, type ExpenseCallAI } from "./expense.ts";

// ─── Test scaffolding ──────────────────────────────────────────────────

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  insertError?: { message: string } | null;
  rpcData?: Record<string, DbResponse>;
  invokeData?: Record<string, DbResponse>;
}

interface Recorded {
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  invokes: Array<{ name: string; body: Record<string, unknown> }>;
}

function makeChainable(response: DbResponse): unknown {
  const target = { response };
  // deno-lint-ignore no-explicit-any
  const handler: ProxyHandler<any> = {
    get(t, prop) {
      if (prop === 'then') {
        return (resolve: (v: DbResponse) => void) => resolve(t.response);
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return () => Promise.resolve(t.response);
      }
      return () => new Proxy(t, handler);
    },
  };
  return new Proxy(target, handler);
}

function buildSupabaseStub(opts: StubOptions = {}) {
  const recorded: Recorded = { inserts: [], rpcs: [], invokes: [] };
  const rpcData = opts.rpcData ?? {};
  const invokeData = opts.invokeData ?? {};

  const stub = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          recorded.inserts.push({ table, payload: row });
          // `expenses` table insert in the handler doesn't chain — it
          // resolves directly to { data, error }. Return a chainable
          // that resolves with the programmed error (or null).
          return makeChainable({ data: null, error: opts.insertError ?? null });
        },
      };
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      recorded.rpcs.push({ name, args });
      return Promise.resolve(rpcData[name] ?? { data: null, error: null });
    },
    functions: {
      invoke(name: string, opts2: { body?: Record<string, unknown> } = {}) {
        recorded.invokes.push({ name, body: opts2.body ?? {} });
        return Promise.resolve(invokeData[name] ?? { data: null, error: null });
      },
    },
  };
  return { stub, recorded };
}

function buildCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  const session = overrides.session ?? {
    id: 'sess-1',
    user_id: 'user-1',
    context_data: {} as ConversationContext,
  };
  return {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: 'user-1',
    userLang: 'en',
    userTimezone: 'America/New_York',
    profile: {
      id: 'user-1',
      display_name: 'Test',
      phone_number: '+15555550100',
      timezone: 'America/New_York',
      language_preference: 'en',
      default_privacy: 'shared',
    },
    coupleId: null,
    effectiveCoupleId: null,
    session,
    messageBody: '$25 lunch at Chipotle',
    cleanMessage: '$25 lunch at Chipotle',
    effectiveMessage: '$25 lunch at Chipotle',
    mediaUrls: [],
    mediaTypes: [],
    wamid: 'wamid-1',
    inboundNoteSource: 'whatsapp',
    quotedMessageId: null,
    receivedAtIso: new Date().toISOString(),
    tracker: null,
    intentResult: { intent: 'EXPENSE' },
    members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

function scriptedCategorizer(opts: { returns?: string; throws?: boolean } = {}): ExpenseCallAI {
  return async () => {
    if (opts.throws) throw new Error('AI categorization down');
    return opts.returns ?? '{"merchant": "Chipotle", "category": "food"}';
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

Deno.test("text-only happy path: parses + categorizes + inserts", async () => {
  const { stub, recorded } = buildSupabaseStub();
  const handler = makeExpenseHandler({
    callAI: scriptedCategorizer(), t: fakeT,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // Reply contains the localized expense_logged copy.
  assert(reply.text.includes('expense_logged'));
  // Insert went through with merchant=Chipotle, category=food, amount=25.
  const expenseInsert = recorded.inserts.find((i) => i.table === 'expenses');
  assertExists(expenseInsert);
  // deno-lint-ignore no-explicit-any
  const payload = expenseInsert.payload as any;
  assertEquals(payload.name, 'Chipotle');
  assertEquals(payload.category, 'food');
  assertEquals(payload.amount, 25);
  assertEquals(payload.currency, 'USD');
});

Deno.test("parseExpenseText returns null → expense_need_amount, no insert", async () => {
  const { stub, recorded } = buildSupabaseStub();
  const handler = makeExpenseHandler({
    callAI: scriptedCategorizer(), t: fakeT,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    messageBody: 'lunch was great',
    cleanMessage: 'lunch was great',
    effectiveMessage: 'lunch was great',
  }));

  assertEquals(reply.text, 'expense_need_amount');
  assertEquals(recorded.inserts.length, 0);
});

Deno.test("AI categorization throws → regex 'at <merchant>' fallback runs", async () => {
  const { stub, recorded } = buildSupabaseStub();
  const handler = makeExpenseHandler({
    callAI: scriptedCategorizer({ throws: true }), t: fakeT,
  });
  await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    effectiveMessage: '$12 coffee at Blue Bottle',
  }));

  const expenseInsert = recorded.inserts.find((i) => i.table === 'expenses')!;
  // deno-lint-ignore no-explicit-any
  const payload = expenseInsert.payload as any;
  // Regex extracted "Blue Bottle" from "at Blue Bottle"
  assertEquals(payload.name, 'Blue Bottle');
  // Category falls back to 'other'.
  assertEquals(payload.category, 'other');
});

Deno.test("media attached → process-receipt invoked, no expenses insert", async () => {
  const { stub, recorded } = buildSupabaseStub({
    invokeData: {
      'process-receipt': {
        data: {
          transaction: { amount: 47.5, merchant: 'Whole Foods', category: 'groceries' },
          budget_status: 'ok',
        },
        error: null,
      },
    },
  });
  const handler = makeExpenseHandler({
    callAI: scriptedCategorizer(), t: fakeT,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    mediaUrls: ['https://example.com/receipt.jpg'],
    mediaTypes: ['image/jpeg'],
  }));

  // process-receipt was invoked.
  assertEquals(recorded.invokes.length, 1);
  assertEquals(recorded.invokes[0].name, 'process-receipt');
  // Reply uses the receipt processor's transaction values.
  assert(reply.text.includes('Whole Foods'));
  assert(reply.text.includes('groceries'));
  // No insert into expenses (process-receipt handles that).
  assertEquals(recorded.inserts.length, 0);
});

Deno.test("over_limit budget status → over-budget line appended", async () => {
  const { stub } = buildSupabaseStub({
    rpcData: {
      check_budget_status: {
        data: [{
          status: 'over_limit',
          new_total: 720,
          limit_amount: 600,
          percentage: 120,
        }],
        error: null,
      },
    },
  });
  const handler = makeExpenseHandler({
    callAI: scriptedCategorizer(), t: fakeT,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  assert(reply.text.includes('expense_logged'));
  assert(reply.text.includes('expense_over_budget'));
  assert(reply.text.includes('spent=$720'));
  assert(reply.text.includes('limit=$600'));
});
