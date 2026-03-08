import { useCallback, useEffect, useState, useMemo } from "react";
import { useUser } from "@clerk/clerk-react";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

export type ExpenseSplitType =
  | 'you_paid_split'
  | 'you_owed_full'
  | 'partner_paid_split'
  | 'partner_owed_full'
  | 'individual';

export interface Expense {
  id: string;
  user_id: string;
  couple_id: string | null;
  note_id: string | null;
  name: string;
  amount: number;
  currency: string;
  category: string;
  category_icon: string;
  split_type: ExpenseSplitType;
  paid_by: string;
  is_shared: boolean;
  is_settled: boolean;
  settled_at: string | null;
  settlement_id: string | null;
  receipt_url: string | null;
  expense_date: string;
  original_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseSettlement {
  id: string;
  couple_id: string | null;
  user_id: string;
  settled_by: string;
  total_amount: number;
  currency: string;
  expense_count: number;
  created_at: string;
}

export interface ExpenseAnalytics {
  totalExpenses: number;
  youOwe: number;
  partnerOwes: number;
  topCategories: Array<{ category: string; icon: string; total: number; count: number }>;
}

// Category icon mapping
export const EXPENSE_CATEGORY_ICONS: Record<string, string> = {
  'Groceries': '🛒',
  'Dining': '🍽️',
  'Restaurant': '🍽️',
  'Travel': '✈️',
  'Utilities': '💡',
  'Entertainment': '🎬',
  'Shopping': '🛍️',
  'Health': '💊',
  'Transportation': '🚗',
  'Gas': '⛽',
  'Subscriptions': '📱',
  'Cable & Internet': '📡',
  'Rent': '🏠',
  'Insurance': '🛡️',
  'Education': '📚',
  'Personal Care': '💇',
  'Clothing': '👕',
  'Gifts': '🎁',
  'Pets': '🐾',
  'Coffee': '☕',
  'Drinks': '🍺',
  'Fitness': '💪',
  'Pharmacy': '💊',
  'Home': '🏡',
  'Electronics': '📱',
  'Other': '📄',
};

export function getCategoryIcon(category: string): string {
  return EXPENSE_CATEGORY_ICONS[category] || '📄';
}

// ============================================================================
// HOOK
// ============================================================================

export function useExpenses() {
  const { user } = useUser();
  const { currentCouple } = useSupabaseCouple();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<ExpenseSettlement[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = user?.id;
  const coupleId = currentCouple?.id;

  // Fetch expenses
  const fetchExpenses = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('expenses')
        .select('*')
        .order('expense_date', { ascending: false });

      // If couple exists, fetch both individual and shared
      if (coupleId) {
        query = query.or(`couple_id.eq.${coupleId},and(user_id.eq.${userId},couple_id.is.null)`);
      } else {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setExpenses((data || []) as Expense[]);
    } catch (err) {
      console.error('[useExpenses] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, coupleId]);

  // Fetch settlements
  const fetchSettlements = useCallback(async () => {
    if (!userId) return;
    try {
      let query = supabase
        .from('expense_settlements')
        .select('*')
        .order('created_at', { ascending: false });

      if (coupleId) {
        query = query.eq('couple_id', coupleId);
      } else {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setSettlements((data || []) as ExpenseSettlement[]);
    } catch (err) {
      console.error('[useExpenses] settlements fetch error:', err);
    }
  }, [userId, coupleId]);

  useEffect(() => {
    fetchExpenses();
    fetchSettlements();
  }, [fetchExpenses, fetchSettlements]);

  // Add expense
  const addExpense = useCallback(async (expense: Omit<Expense, 'id' | 'created_at' | 'updated_at'>) => {
    if (!userId) return null;
    try {
      const { data, error } = await supabase
        .from('expenses')
        .insert({ ...expense, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      setExpenses(prev => [data as Expense, ...prev]);
      return data as Expense;
    } catch (err) {
      console.error('[useExpenses] add error:', err);
      toast.error('Failed to add expense');
      return null;
    }
  }, [userId]);

  // Update expense
  const updateExpense = useCallback(async (id: string, updates: Partial<Expense>) => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      setExpenses(prev => prev.map(e => e.id === id ? (data as Expense) : e));
      return data as Expense;
    } catch (err) {
      console.error('[useExpenses] update error:', err);
      toast.error('Failed to update expense');
      return null;
    }
  }, []);

  // Delete expense
  const deleteExpense = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
      setExpenses(prev => prev.filter(e => e.id !== id));
      toast.success('Expense deleted');
    } catch (err) {
      console.error('[useExpenses] delete error:', err);
      toast.error('Failed to delete expense');
    }
  }, []);

  // Settle all unsettled expenses
  const settleExpenses = useCallback(async () => {
    if (!userId) return;
    const unsettled = expenses.filter(e => !e.is_settled);
    if (unsettled.length === 0) {
      toast.info('No expenses to settle');
      return;
    }

    try {
      // Create settlement record
      const totalAmount = unsettled.reduce((sum, e) => sum + e.amount, 0);
      const { data: settlement, error: settleErr } = await supabase
        .from('expense_settlements')
        .insert({
          couple_id: coupleId || null,
          user_id: userId,
          settled_by: userId,
          total_amount: totalAmount,
          currency: unsettled[0]?.currency || 'USD',
          expense_count: unsettled.length,
        })
        .select()
        .single();
      if (settleErr) throw settleErr;

      // Mark all unsettled expenses as settled
      const ids = unsettled.map(e => e.id);
      const { error: updateErr } = await supabase
        .from('expenses')
        .update({
          is_settled: true,
          settled_at: new Date().toISOString(),
          settlement_id: settlement.id,
        })
        .in('id', ids);
      if (updateErr) throw updateErr;

      // Update local state
      setExpenses(prev =>
        prev.map(e =>
          ids.includes(e.id)
            ? { ...e, is_settled: true, settled_at: new Date().toISOString(), settlement_id: settlement.id }
            : e
        )
      );
      setSettlements(prev => [settlement as ExpenseSettlement, ...prev]);
      toast.success(`Settled ${unsettled.length} expenses!`);
    } catch (err) {
      console.error('[useExpenses] settle error:', err);
      toast.error('Failed to settle expenses');
    }
  }, [userId, coupleId, expenses]);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  const activeExpenses = useMemo(() => expenses.filter(e => !e.is_settled), [expenses]);
  const archivedExpenses = useMemo(() => expenses.filter(e => e.is_settled), [expenses]);

  const analytics = useMemo((): ExpenseAnalytics => {
    let youOwe = 0;
    let partnerOwes = 0;

    activeExpenses.forEach(e => {
      if (e.split_type === 'you_paid_split') {
        partnerOwes += e.amount / 2;
      } else if (e.split_type === 'you_owed_full') {
        partnerOwes += e.amount;
      } else if (e.split_type === 'partner_paid_split') {
        youOwe += e.amount / 2;
      } else if (e.split_type === 'partner_owed_full') {
        youOwe += e.amount;
      }
    });

    // Top categories
    const catMap: Record<string, { total: number; count: number; icon: string }> = {};
    activeExpenses.forEach(e => {
      if (!catMap[e.category]) {
        catMap[e.category] = { total: 0, count: 0, icon: e.category_icon || getCategoryIcon(e.category) };
      }
      catMap[e.category].total += e.amount;
      catMap[e.category].count++;
    });

    const topCategories = Object.entries(catMap)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.total - a.total);

    return {
      totalExpenses: activeExpenses.reduce((sum, e) => sum + e.amount, 0),
      youOwe,
      partnerOwes,
      topCategories,
    };
  }, [activeExpenses]);

  // Net balance: positive = partner owes you, negative = you owe partner
  const netBalance = useMemo(() => analytics.partnerOwes - analytics.youOwe, [analytics]);

  return {
    expenses,
    activeExpenses,
    archivedExpenses,
    settlements,
    loading,
    analytics,
    netBalance,
    addExpense,
    updateExpense,
    deleteExpense,
    settleExpenses,
    refetch: fetchExpenses,
  };
}
