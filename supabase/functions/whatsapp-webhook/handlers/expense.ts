// handlers/expense.ts — EXPENSE intent handler.
// ============================================================================
// Initiative 1.7 of OLIVE_REFACTOR_PLAN.md. Smallest of the three siblings
// in this PR (EXPENSE / TASK_ACTION / PARTNER_MESSAGE). Owns the
// natural-language expense capture path:
//
//   1. Media attached → route to `process-receipt` edge function (OCR
//      + AI parse) and surface the merchant + category + budget
//      status the receipt processor returned.
//   2. Text-only → `parseExpenseText` extracts amount + currency +
//      description; if no amount detected, return `expense_need_amount`.
//   3. AI categorization (lite tier) — extracts merchant + category
//      JSON. Failure is non-blocking: regex `(at|from|@) <merchant>`
//      fallback runs, category defaults to 'other'.
//   4. Insert into `expenses` table.
//   5. Budget status check via `check_budget_status` RPC; if over
//      limit or warning threshold, append the bilingual budget line.
//   6. Confirm with localized `expense_logged` copy + manage link.

import { parseExpenseText } from "../../_shared/expense-detector.ts";
import { WA_EXPENSE_CATEGORIZATION_PROMPT_VERSION } from "../../_shared/prompts/whatsapp-prompts.ts";
import type { LLMTracker } from "../../_shared/llm-tracker.ts";
import type { Handler, HandlerContext, Reply } from "../../_shared/types.ts";

// ─── Types ─────────────────────────────────────────────────────────────

export type ExpenseCallAI = (
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  tier: string,
  tracker?: LLMTracker | null,
  promptVersion?: string,
) => Promise<string>;

export interface ExpenseDeps {
  callAI: ExpenseCallAI;
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
}

// ─── Currency symbol ───────────────────────────────────────────────────

function currencySymbolFor(currency: string): string {
  if (currency === 'EUR') return '€';
  if (currency === 'GBP') return '£';
  return '$';
}

// ─── Factory ──────────────────────────────────────────────────────────

export function makeExpenseHandler(deps: ExpenseDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    console.log(
      '[WhatsApp] Processing EXPENSE (AI-classified):',
      ctx.effectiveMessage?.substring(0, 80),
    );
    const expenseText = ctx.effectiveMessage || ctx.messageBody || '';

    // ── Media attached → process-receipt path.
    if (ctx.mediaUrls.length > 0) {
      console.log('[Expense] Media attached — routing to process-receipt');
      try {
        const { data: receiptResult } = await ctx.supabase.functions.invoke(
          'process-receipt',
          {
            body: {
              image_url: ctx.mediaUrls[0],
              user_id: ctx.userId,
              couple_id: ctx.effectiveCoupleId,
              caption: expenseText || undefined,
            },
          },
        );
        // deno-lint-ignore no-explicit-any
        const rr: any = receiptResult;
        if (rr?.transaction) {
          const tx = rr.transaction;
          let response = deps.t('expense_logged', ctx.userLang, {
            amount: `$${Number(tx.amount).toFixed(2)}`,
            merchant: tx.merchant || 'Unknown',
            category: tx.category || 'Other',
          });
          if (rr.budget_status === 'over_limit') {
            response += '\n' + deps.t('expense_over_budget', ctx.userLang, {
              category: tx.category,
              spent: `$${rr.period_spending || '?'}`,
              limit: `$${rr.budget_limit || '?'}`,
            });
          }
          return { text: response };
        }
        return { text: rr?.message || deps.t('error_generic', ctx.userLang) };
      } catch (e) {
        console.error('[Expense] Receipt processing error:', e);
        return { text: deps.t('error_generic', ctx.userLang) };
      }
    }

    // ── Text-only path: parse amount/currency/description.
    const parsedExpense = parseExpenseText(expenseText);
    if (!parsedExpense) {
      return { text: deps.t('expense_need_amount', ctx.userLang) };
    }

    // ── AI categorization (lite). Failure is non-blocking.
    let merchant = parsedExpense.description;
    let category = 'other';
    try {
      const categorizationPrompt = `Extract the merchant name and expense category from this description.
Respond with ONLY valid JSON: {"merchant": "name", "category": "one_of_these"}
Categories: food, transport, shopping, entertainment, utilities, health, groceries, travel, personal, education, subscriptions, other

Description: "${parsedExpense.description}"`;
      const categResult = await deps.callAI(
        categorizationPrompt,
        parsedExpense.description,
        0.3,
        'lite',
        ctx.tracker,
        WA_EXPENSE_CATEGORIZATION_PROMPT_VERSION,
      );
      const parsed = JSON.parse(categResult.replace(/```json?|```/g, '').trim());
      if (parsed.merchant) merchant = parsed.merchant;
      if (parsed.category) category = parsed.category;
    } catch (e) {
      console.log('[Expense] AI categorization failed, using defaults:', e);
      const atMatch = parsedExpense.description.match(/(?:at|from|@)\s+(.+)$/i);
      if (atMatch) {
        merchant = atMatch[1].trim();
      }
    }

    // ── Insert into expenses table.
    try {
      const { error: txError } = await ctx.supabase
        .from('expenses')
        .insert({
          user_id: ctx.userId,
          couple_id: ctx.effectiveCoupleId || null,
          amount: parsedExpense.amount,
          name: merchant,
          category,
          currency: parsedExpense.currency,
          paid_by: ctx.userId,
          split_type: 'individual',
          expense_date: new Date().toISOString().split('T')[0],
          is_shared: false,
          original_text: ctx.messageBody || expenseText,
        });

      if (txError) {
        console.error('[Expense] Insert error:', txError);
        return { text: deps.t('error_generic', ctx.userLang) };
      }

      const currencySymbol = currencySymbolFor(parsedExpense.currency);
      let response = deps.t('expense_logged', ctx.userLang, {
        amount: `${currencySymbol}${parsedExpense.amount.toFixed(2)}`,
        merchant,
        category,
      });

      // ── Budget status check.
      try {
        const { data: budgetCheck } = await ctx.supabase.rpc('check_budget_status', {
          p_user_id: ctx.userId,
          p_category: category,
          p_amount: parsedExpense.amount,
        });
        if (budgetCheck && budgetCheck.length > 0) {
          const budget = budgetCheck[0];
          if (budget.status === 'over_limit') {
            response += '\n' + deps.t('expense_over_budget', ctx.userLang, {
              category,
              spent: `${currencySymbol}${Number(budget.new_total).toFixed(2)}`,
              limit: `${currencySymbol}${Number(budget.limit_amount).toFixed(2)}`,
            });
          } else if (budget.status === 'warning') {
            response += '\n' + deps.t('expense_budget_warning', ctx.userLang, {
              category,
              percentage: String(Math.round(budget.percentage)),
              spent: `${currencySymbol}${Number(budget.new_total).toFixed(2)}`,
              limit: `${currencySymbol}${Number(budget.limit_amount).toFixed(2)}`,
            });
          }
        }
      } catch (e) {
        console.log('[Expense] Budget check skipped:', e);
      }

      response += '\n\n🔗 Manage: https://witholive.app';
      return { text: response };
    } catch (e) {
      console.error('[Expense] Error:', e);
      return { text: deps.t('error_generic', ctx.userLang) };
    }
  };
}
