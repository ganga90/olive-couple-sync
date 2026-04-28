/**
 * Context Soul — EXPENSE planner
 * ================================
 * Fires for the EXPENSE intent: capturing a receipt, asking about
 * spending, checking a budget, etc. Loads ONLY data the LLM actually
 * needs to answer expense questions:
 *
 *   1. Last 30d totals — overall + top categories
 *   2. Most-recent transactions (5)
 *   3. Active recurring expenses with their next-due dates
 *
 * Skipped (by design):
 *   - Notes, lists, calendar — irrelevant to expense reasoning
 *   - Memories / patterns — too generic; soul Layer 1 already carries
 *     the user's preferences if they matter
 *   - Other-space expenses — RLS would already filter, but we scope
 *     explicitly via user_id + space_id for clarity
 *
 * Token efficiency goal: ~150-300 tokens for a typical user, far
 * tighter than the kitchen-sink dump in SLOT_DYNAMIC today.
 */

import { registerPlanner } from "../registry.ts";
import { buildBudgetedSection, estimateTokens } from "../budget.ts";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface ExpenseRow {
  amount: number | string;
  currency: string | null;
  category: string | null;
  name: string | null;
  expense_date: string | null;
}

interface RecurringRow {
  name: string | null;
  amount: number | string;
  currency: string | null;
  recurrence_frequency: string | null;
  next_recurrence_date: string | null;
}

registerPlanner("EXPENSE", async (supabase, params) => {
  const { userId, spaceId, budgetTokens } = params;
  const sectionsLoaded: string[] = [];
  const lines: string[] = [];

  // ─── Recent expenses (last 30d) ────────────────────────────────
  // Pull from the user's own expenses + the space's shared expenses
  // (when applicable). RLS would also gate this, but explicit scope
  // makes the query intent-readable.
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  // Build the chain with scoping FIRST so .limit() is the canonical
  // terminal call. Avoids the "calling builder methods on a Promise"
  // foot-gun if a future refactor makes any of these auto-await.
  let recent: ExpenseRow[] = [];
  try {
    let recentQuery = supabase
      .from("expenses")
      .select("amount, currency, category, name, expense_date")
      .gte("expense_date", cutoff);

    if (spaceId) {
      recentQuery = recentQuery.or(`user_id.eq.${userId},space_id.eq.${spaceId}`);
    } else {
      recentQuery = recentQuery.eq("user_id", userId);
    }

    const { data } = await recentQuery
      .order("expense_date", { ascending: false })
      .limit(50);
    recent = (data as ExpenseRow[]) || [];
  } catch (err) {
    console.warn("[expense-planner] recent fetch failed:", err);
  }

  if (recent.length > 0) {
    sectionsLoaded.push("recent-30d");
    let total = 0;
    const byCategory: Record<string, number> = {};
    let currency = "USD";
    for (const e of recent) {
      const amt = Number(e.amount) || 0;
      total += amt;
      const cat = e.category || "uncategorized";
      byCategory[cat] = (byCategory[cat] || 0) + amt;
      if (e.currency) currency = e.currency;
    }

    const topCats = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const summaryBody: string[] = [
      `Total ${currency} ${total.toFixed(2)} across ${recent.length} transactions`,
    ];
    for (const [cat, amt] of topCats) {
      summaryBody.push(`- ${cat}: ${currency} ${amt.toFixed(2)}`);
    }

    // Most recent 3 transactions for grounded LLM answers
    summaryBody.push("");
    summaryBody.push("Most recent:");
    for (const e of recent.slice(0, 3)) {
      const date = e.expense_date
        ? new Date(e.expense_date).toISOString().slice(0, 10)
        : "n/a";
      summaryBody.push(
        `- ${date} ${e.name || "(no name)"} — ${e.currency || currency} ${Number(e.amount).toFixed(2)} [${e.category || "uncategorized"}]`,
      );
    }

    lines.push(`## Recent expenses (last 30d)\n${summaryBody.join("\n")}`);
  } else {
    sectionsLoaded.push("recent-30d-empty");
    lines.push(`## Recent expenses (last 30d)\nNo expenses recorded.`);
  }

  // ─── Recurring expenses ─────────────────────────────────────────
  // Active recurring rows for this user with a future next-due date.
  // Helps Olive answer "what subscriptions am I paying for?" or
  // anticipate budget alerts.
  let recurring: RecurringRow[] = [];
  try {
    const { data } = await supabase
      .from("expenses")
      .select("name, amount, currency, recurrence_frequency, next_recurrence_date")
      .eq("user_id", userId)
      .eq("is_recurring", true)
      .gte("next_recurrence_date", new Date().toISOString())
      .order("next_recurrence_date", { ascending: true })
      .limit(5);
    recurring = (data as RecurringRow[]) || [];
  } catch (err) {
    console.warn("[expense-planner] recurring fetch failed:", err);
  }

  if (recurring.length > 0) {
    sectionsLoaded.push("recurring");
    const recurringLines: string[] = [];
    for (const r of recurring) {
      const next = r.next_recurrence_date
        ? new Date(r.next_recurrence_date).toISOString().slice(0, 10)
        : "n/a";
      recurringLines.push(
        `- ${r.name || "(unnamed)"}: ${r.currency || "USD"} ${Number(r.amount).toFixed(2)} ${r.recurrence_frequency || ""} — next ${next}`.trim(),
      );
    }
    lines.push(`## Recurring expenses\n${recurringLines.join("\n")}`);
  }

  if (lines.length === 0) {
    return {
      prompt: "",
      tokensUsed: 0,
      sectionsLoaded: ["expense-empty"],
      fellBackToDefault: false,
    };
  }

  const fullText = lines.join("\n\n");
  const clamped = buildBudgetedSection("", fullText, budgetTokens);
  return {
    prompt: clamped.text,
    tokensUsed: clamped.tokens || estimateTokens(clamped.text),
    sectionsLoaded,
    fellBackToDefault: false,
  };
});
