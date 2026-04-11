/**
 * Expense Detection & Creation Module
 * ====================================
 * Detects monetary amounts in note text and auto-creates expense records.
 * Shared by process-note and whatsapp-webhook.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ─── Expense Text Parser ──────────────────────────────────────
/**
 * Robust multi-format amount extraction from natural language text.
 * Supports: "$57.85 Amazon", "Amazon $57.85", "57.85 Amazon", "€45 groceries",
 *           "lunch at Chipotle 25", "25 lunch", "coffee £4.50", etc.
 */
export function parseExpenseText(text: string): { amount: number; description: string; currency: string } | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  let amount: number | null = null;
  let description = '';
  let currency = 'USD';

  // Pattern 1: Currency symbol + amount at the START: "$57.85 Amazon", "€45 groceries"
  const startMatch = cleaned.match(/^([£€$])\s*(\d+\.?\d*)\s+(.+)$/);
  if (startMatch) {
    currency = startMatch[1] === '€' ? 'EUR' : startMatch[1] === '£' ? 'GBP' : 'USD';
    amount = parseFloat(startMatch[2]);
    description = startMatch[3].trim();
  }

  // Pattern 2: Amount (no symbol) at the START: "57.85 Amazon", "25 lunch at Chipotle"
  if (amount === null) {
    const numStartMatch = cleaned.match(/^(\d+\.?\d*)\s+(.+)$/);
    if (numStartMatch) {
      amount = parseFloat(numStartMatch[1]);
      description = numStartMatch[2].trim();
    }
  }

  // Pattern 3: Currency symbol + amount at the END or MIDDLE: "Amazon $57.85", "coffee €4.50"
  if (amount === null) {
    const endMatch = cleaned.match(/^(.+?)\s+([£€$])\s*(\d+\.?\d*)\s*$/);
    if (endMatch) {
      description = endMatch[1].trim();
      currency = endMatch[2] === '€' ? 'EUR' : endMatch[2] === '£' ? 'GBP' : 'USD';
      amount = parseFloat(endMatch[3]);
    }
  }

  // Pattern 4: Amount (no symbol) at the END: "Amazon 57.85", "lunch 25"
  if (amount === null) {
    const numEndMatch = cleaned.match(/^(.+?)\s+(\d+\.?\d*)$/);
    if (numEndMatch && parseFloat(numEndMatch[2]) > 0) {
      description = numEndMatch[1].trim();
      amount = parseFloat(numEndMatch[2]);
    }
  }

  // Pattern 5: Inline currency+amount: "Bought coffee for $4.50 at Starbucks"
  if (amount === null) {
    const inlineMatch = cleaned.match(/([£€$])\s*(\d+\.?\d*)/);
    if (inlineMatch) {
      currency = inlineMatch[1] === '€' ? 'EUR' : inlineMatch[1] === '£' ? 'GBP' : 'USD';
      amount = parseFloat(inlineMatch[2]);
      description = cleaned.replace(inlineMatch[0], '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  if (amount === null || amount <= 0 || !description) return null;

  return { amount, description, currency };
}

// Currency detection from text
export function detectCurrency(text: string): string {
  if (/€|EUR/i.test(text)) return 'EUR';
  if (/£|GBP/i.test(text)) return 'GBP';
  if (/¥|JPY|YEN/i.test(text)) return 'JPY';
  if (/₹|INR/i.test(text)) return 'INR';
  return 'USD';
}

// Extract monetary amount from text
export function extractAmount(text: string): number | null {
  const patterns = [
    /[$€£¥₹]\s*([\d,]+\.?\d*)/,
    /([\d,]+\.?\d*)\s*(?:dollars?|euros?|pounds?|bucks)/i,
    /\b([\d,]+\.\d{2})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseFloat(match[1].replace(/,/g, ''));
  }
  return null;
}

// Map note category to expense category
export function mapCategoryToExpenseCategory(noteCategory: string): string {
  const mapping: Record<string, string> = {
    groceries: 'Groceries', food: 'Groceries', grocery: 'Groceries',
    entertainment: 'Entertainment', date_ideas: 'Entertainment',
    travel: 'Travel', transportation: 'Transportation',
    health: 'Health', medical: 'Health', wellness: 'Health',
    shopping: 'Shopping', personal: 'Personal',
    home_improvement: 'Home', utilities: 'Utilities',
    finance: 'Finance', education: 'Education',
  };
  return mapping[noteCategory.toLowerCase()] || 'Other';
}

// Expense category icons
const EXPENSE_CATEGORY_ICONS: Record<string, string> = {
  Groceries: '🛒', Entertainment: '🎬', Travel: '✈️',
  Transportation: '🚗', Health: '🏥', Shopping: '🛍️',
  Personal: '👤', Home: '🏠', Utilities: '💡',
  Finance: '💰', Education: '📚', Other: '📄',
};

/**
 * Detect and create an expense from note text.
 * Returns silently on failure (non-blocking).
 */
export async function detectAndCreateExpense(
  supabase: SupabaseClient,
  result: any,
  originalText: string,
  userId: string,
  coupleId?: string,
  receiptUrl?: string | null,
  source?: string
): Promise<void> {
  const amount = extractAmount(originalText);
  // Validate amount bounds: ignore negative, zero, or absurdly large values
  if (!amount || amount <= 0 || amount > 999999) return;

  console.log('[Expense Detection] Amount detected:', amount, 'in text:', originalText.substring(0, 80));

  const currency = detectCurrency(originalText);
  const noteCategory = result.category || (result.notes?.[0]?.category) || 'Other';
  const expenseCategory = mapCategoryToExpenseCategory(noteCategory);
  const expenseName = result.summary || (result.notes?.[0]?.summary) || originalText.substring(0, 100);

  // Check user's expense preferences
  const { data: profile } = await supabase
    .from('clerk_profiles')
    .select('expense_tracking_mode, expense_default_split, expense_default_currency')
    .eq('id', userId)
    .single();

  const trackingMode = profile?.expense_tracking_mode || 'individual';
  const defaultSplit = profile?.expense_default_split || 'you_paid_split';
  const isShared = trackingMode === 'shared' && !!coupleId;

  const noteId = result.id || result.notes?.[0]?.id || null;

  const expenseData = {
    user_id: userId,
    couple_id: isShared ? coupleId : null,
    note_id: noteId,
    name: expenseName,
    amount,
    currency,
    category: expenseCategory,
    category_icon: EXPENSE_CATEGORY_ICONS[expenseCategory] || '📄',
    split_type: isShared ? defaultSplit : 'individual',
    paid_by: userId,
    is_shared: isShared,
    receipt_url: receiptUrl || null,
    expense_date: new Date().toISOString(),
    original_text: originalText.substring(0, 500),
  };

  const { error } = await supabase.from('expenses').insert(expenseData);
  if (error) {
    console.error('[Expense Detection] Failed to create expense:', error);
  } else {
    console.log('[Expense Detection] ✅ Expense created:', expenseName, amount, currency);
  }
}
