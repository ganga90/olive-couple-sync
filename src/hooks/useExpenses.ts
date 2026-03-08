import { useCallback, useEffect, useState, useMemo } from "react";
import { useUser } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
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
  // Recurring fields
  is_recurring: boolean;
  recurrence_frequency: 'weekly' | 'monthly' | 'yearly' | null;
  recurrence_interval: number | null;
  next_recurrence_date: string | null;
  parent_recurring_id: string | null;
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
  totalsByCurrency: Record<string, number>;
  youOweByCurrency: Record<string, number>;
  partnerOwesByCurrency: Record<string, number>;
  totalExpenses: number; // kept for backwards compat (default currency)
  youOwe: number;
  partnerOwes: number;
  topCategories: Array<{ category: string; icon: string; total: number; count: number; currency: string }>;
}

export interface ExpensePreferences {
  trackingMode: string;
  defaultSplit: ExpenseSplitType;
  defaultCurrency: string;
}

export interface BudgetLimit {
  id: string;
  user_id: string;
  couple_id: string | null;
  category: string;
  monthly_limit: number;
  currency: string;
  created_at: string;
  updated_at: string;
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

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || '$';
}

// ============================================================================
// HOOK
// ============================================================================

export function useExpenses() {
  const { user } = useUser();
  const { currentCouple } = useSupabaseCouple();
  const { t } = useTranslation('expenses');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<ExpenseSettlement[]>([]);
  const [budgetLimits, setBudgetLimits] = useState<BudgetLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<ExpensePreferences>({
    trackingMode: 'individual',
    defaultSplit: 'you_paid_split',
    defaultCurrency: 'USD',
  });

  const userId = user?.id;
  const coupleId = currentCouple?.id;

  // Fetch user expense preferences
  const fetchPreferences = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('clerk_profiles')
        .select('expense_tracking_mode, expense_default_split, expense_default_currency')
        .eq('id', userId)
        .single();
      if (error) throw error;
      if (data) {
        setPreferences({
          trackingMode: data.expense_tracking_mode || 'individual',
          defaultSplit: (data.expense_default_split as ExpenseSplitType) || 'you_paid_split',
          defaultCurrency: data.expense_default_currency || 'USD',
        });
      }
    } catch (err) {
      console.error('[useExpenses] preferences fetch error:', err);
    }
  }, [userId]);

  // Update preferences
  const updatePreferences = useCallback(async (updates: Partial<ExpensePreferences>) => {
    if (!userId) return;
    const dbUpdates: Record<string, string> = {};
    if (updates.trackingMode) dbUpdates.expense_tracking_mode = updates.trackingMode;
    if (updates.defaultSplit) dbUpdates.expense_default_split = updates.defaultSplit;
    if (updates.defaultCurrency) dbUpdates.expense_default_currency = updates.defaultCurrency;

    try {
      const { error } = await supabase
        .from('clerk_profiles')
        .update(dbUpdates)
        .eq('id', userId);
      if (error) throw error;
      setPreferences(prev => ({ ...prev, ...updates }));
      toast.success(t('toast.preferencesUpdated', 'Preferences updated'));
    } catch (err) {
      console.error('[useExpenses] preferences update error:', err);
      toast.error(t('toast.preferencesError', 'Failed to update preferences'));
    }
  }, [userId]);

  // Fetch expenses
  const fetchExpenses = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('expenses')
        .select('*')
        .order('expense_date', { ascending: false });

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

  // Fetch budget limits
  const fetchBudgetLimits = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('expense_budget_limits')
        .select('*')
        .eq('user_id', userId);
      if (error) throw error;
      setBudgetLimits((data || []) as BudgetLimit[]);
    } catch (err) {
      console.error('[useExpenses] budget limits fetch error:', err);
    }
  }, [userId]);

  useEffect(() => {
    fetchExpenses();
    fetchSettlements();
    fetchPreferences();
    fetchBudgetLimits();
  }, [fetchExpenses, fetchSettlements, fetchPreferences, fetchBudgetLimits]);

  // ========================================================================
  // REAL-TIME SUBSCRIPTION: live sync between partners
  // ========================================================================
  useEffect(() => {
    if (!userId) return;

    const channelFilter = coupleId
      ? `couple_id=eq.${coupleId}`
      : `user_id=eq.${userId}`;

    const channel = supabase
      .channel('expenses-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: channelFilter },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload;
          if (eventType === 'INSERT') {
            setExpenses(prev => {
              if (prev.some(e => e.id === (newRow as Expense).id)) return prev;
              return [newRow as Expense, ...prev];
            });
          } else if (eventType === 'UPDATE') {
            setExpenses(prev => prev.map(e => e.id === (newRow as Expense).id ? (newRow as Expense) : e));
          } else if (eventType === 'DELETE') {
            setExpenses(prev => prev.filter(e => e.id !== (oldRow as any).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, coupleId]);

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

      // Check budget limit for this category
      const limit = budgetLimits.find(bl => bl.category === (data as Expense).category);
      if (limit) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const monthlySpent = expenses
          .filter(e => e.category === limit.category && !e.is_settled && e.expense_date >= monthStart)
          .reduce((sum, e) => sum + e.amount, 0) + (data as Expense).amount;

        if (monthlySpent > limit.monthly_limit) {
          toast.warning(`⚠️ Budget exceeded for ${limit.category}: ${getCurrencySymbol(limit.currency)}${monthlySpent.toFixed(2)} / ${getCurrencySymbol(limit.currency)}${limit.monthly_limit.toFixed(2)}`);
        } else if (monthlySpent > limit.monthly_limit * 0.8) {
          toast.info(`📊 ${limit.category} budget at ${Math.round((monthlySpent / limit.monthly_limit) * 100)}%`);
        }
      }

      return data as Expense;
    } catch (err) {
      console.error('[useExpenses] add error:', err);
      toast.error(t('toast.addError', 'Failed to add expense'));
      return null;
    }
  }, [userId, budgetLimits, expenses]);

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
      toast.error(t('toast.updateError', 'Failed to update expense'));
      return null;
    }
  }, []);

  // Delete expense
  const deleteExpense = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
      setExpenses(prev => prev.filter(e => e.id !== id));
      toast.success(t('toast.deleted', 'Expense deleted'));
    } catch (err) {
      console.error('[useExpenses] delete error:', err);
      toast.error(t('toast.deleteError', 'Failed to delete expense'));
    }
  }, []);

  // Settle all unsettled expenses
  const settleExpenses = useCallback(async () => {
    if (!userId) return;
    const unsettled = expenses.filter(e => !e.is_settled);
    if (unsettled.length === 0) {
      toast.info(t('toast.nothingToSettle', 'No expenses to settle'));
      return;
    }

    try {
      const totalAmount = unsettled.reduce((sum, e) => sum + e.amount, 0);
      const { data: settlement, error: settleErr } = await supabase
        .from('expense_settlements')
        .insert({
          couple_id: coupleId || null,
          user_id: userId,
          settled_by: userId,
          total_amount: totalAmount,
          currency: unsettled[0]?.currency || preferences.defaultCurrency,
          expense_count: unsettled.length,
        })
        .select()
        .single();
      if (settleErr) throw settleErr;

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

      setExpenses(prev =>
        prev.map(e =>
          ids.includes(e.id)
            ? { ...e, is_settled: true, settled_at: new Date().toISOString(), settlement_id: settlement.id }
            : e
        )
      );
      setSettlements(prev => [settlement as ExpenseSettlement, ...prev]);
      toast.success(t('toast.settled', 'Settled {{count}} expenses!', { count: unsettled.length }));
    } catch (err) {
      console.error('[useExpenses] settle error:', err);
      toast.error(t('toast.settleError', 'Failed to settle expenses'));
    }
  }, [userId, coupleId, expenses, preferences.defaultCurrency]);

  // Budget limit CRUD
  const setBudgetLimit = useCallback(async (category: string, monthlyLimit: number) => {
    if (!userId) return;
    try {
      const existing = budgetLimits.find(bl => bl.category === category);
      if (existing) {
        const { data, error } = await supabase
          .from('expense_budget_limits')
          .update({ monthly_limit: monthlyLimit, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        setBudgetLimits(prev => prev.map(bl => bl.id === existing.id ? (data as BudgetLimit) : bl));
      } else {
        const { data, error } = await supabase
          .from('expense_budget_limits')
          .insert({
            user_id: userId,
            couple_id: coupleId || null,
            category,
            monthly_limit: monthlyLimit,
            currency: preferences.defaultCurrency,
          })
          .select()
          .single();
        if (error) throw error;
        setBudgetLimits(prev => [...prev, data as BudgetLimit]);
      }
      toast.success(t('toast.budgetSet', 'Budget limit set for {{category}}', { category }));
    } catch (err) {
      console.error('[useExpenses] set budget limit error:', err);
      toast.error(t('toast.budgetSetError', 'Failed to set budget limit'));
    }
  }, [userId, coupleId, budgetLimits, preferences.defaultCurrency]);

  const removeBudgetLimit = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('expense_budget_limits').delete().eq('id', id);
      if (error) throw error;
      setBudgetLimits(prev => prev.filter(bl => bl.id !== id));
      toast.success(t('toast.budgetRemoved', 'Budget limit removed'));
    } catch (err) {
      console.error('[useExpenses] remove budget limit error:', err);
    }
  }, []);

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

  const netBalance = useMemo(() => analytics.partnerOwes - analytics.youOwe, [analytics]);

  // Monthly trend data for charts
  const monthlyTrends = useMemo(() => {
    const months: Record<string, number> = {};
    // Get last 6 months
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = 0;
    }
    expenses.forEach(e => {
      const d = new Date(e.expense_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in months) {
        months[key] += e.amount;
      }
    });
    return Object.entries(months).map(([month, total]) => ({
      month,
      label: new Date(month + '-01').toLocaleDateString(undefined, { month: 'short' }),
      total: Math.round(total * 100) / 100,
    }));
  }, [expenses]);

  // Budget status per category (current month)
  const budgetStatus = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return budgetLimits.map(limit => {
      const spent = expenses
        .filter(e => e.category === limit.category && !e.is_settled && e.expense_date >= monthStart)
        .reduce((sum, e) => sum + e.amount, 0);
      const percentage = limit.monthly_limit > 0 ? (spent / limit.monthly_limit) * 100 : 0;
      return {
        ...limit,
        spent,
        percentage: Math.round(percentage),
        status: percentage >= 100 ? 'over' as const : percentage >= 80 ? 'warning' as const : 'ok' as const,
      };
    });
  }, [budgetLimits, expenses]);

  return {
    expenses,
    activeExpenses,
    archivedExpenses,
    settlements,
    loading,
    analytics,
    netBalance,
    preferences,
    budgetLimits,
    budgetStatus,
    monthlyTrends,
    addExpense,
    updateExpense,
    deleteExpense,
    settleExpenses,
    updatePreferences,
    setBudgetLimit,
    removeBudgetLimit,
    refetch: fetchExpenses,
  };
}
