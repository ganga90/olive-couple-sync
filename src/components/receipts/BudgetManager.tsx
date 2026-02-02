/**
 * BudgetManager Component
 * ============================================================================
 * Feature 1: Context-Aware Receipt Hunter
 *
 * Allows users to view, create, and manage spending budgets by category.
 * Displays current spending progress and provides budget insights.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/integrations/supabase/client';
import {
  Plus,
  Edit2,
  Trash2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  PieChart,
  Calendar,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Budget {
  id: string;
  category: string;
  limit_amount: number;
  period: 'weekly' | 'monthly' | 'yearly';
  is_active: boolean;
  created_at: string;
  current_spending?: number;
  percentage?: number;
}

interface CategorySpending {
  category: string;
  total: number;
  count: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BUDGET_CATEGORIES = [
  'Groceries',
  'Dining',
  'Travel',
  'Utilities',
  'Entertainment',
  'Shopping',
  'Health',
  'Transportation',
  'Subscriptions',
  'Other'
];

const PERIOD_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' }
];

const categoryIcons: Record<string, string> = {
  Groceries: '🛒',
  Dining: '🍽️',
  Travel: '✈️',
  Utilities: '💡',
  Entertainment: '🎬',
  Shopping: '🛍️',
  Health: '💊',
  Transportation: '🚗',
  Subscriptions: '📱',
  Other: '📄',
};

// ============================================================================
// BUDGET CARD COMPONENT
// ============================================================================

interface BudgetCardProps {
  budget: Budget;
  onEdit: (budget: Budget) => void;
  onDelete: (id: string) => void;
}

const BudgetCard: React.FC<BudgetCardProps> = ({ budget, onEdit, onDelete }) => {
  const percentage = budget.percentage || 0;
  const spending = budget.current_spending || 0;
  const remaining = budget.limit_amount - spending;

  const status = percentage >= 100 ? 'over' : percentage >= 80 ? 'warning' : 'ok';

  return (
    <Card className={cn(
      "transition-all duration-200",
      status === 'over' && "border-red-300",
      status === 'warning' && "border-amber-300"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{categoryIcons[budget.category] || '📄'}</span>
            <div>
              <CardTitle className="text-base">{budget.category}</CardTitle>
              <CardDescription className="text-xs capitalize">
                {budget.period} budget
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(budget)}
            >
              <Edit2 className="w-4 h-4" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Budget</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete the {budget.category} budget?
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(budget.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Amount Display */}
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <span className="text-2xl font-bold">
              ${spending.toFixed(0)}
            </span>
            <span className="text-muted-foreground text-sm ml-1">
              / ${budget.limit_amount.toFixed(0)}
            </span>
          </div>

          <Badge
            variant="secondary"
            className={cn(
              status === 'over' && "bg-red-100 text-red-700",
              status === 'warning' && "bg-amber-100 text-amber-700",
              status === 'ok' && "bg-green-100 text-green-700"
            )}
          >
            {status === 'over' && <AlertCircle className="w-3 h-3 mr-1" />}
            {status === 'warning' && <TrendingUp className="w-3 h-3 mr-1" />}
            {status === 'ok' && <CheckCircle className="w-3 h-3 mr-1" />}
            {percentage.toFixed(0)}%
          </Badge>
        </div>

        {/* Progress Bar */}
        <Progress
          value={Math.min(percentage, 100)}
          className={cn(
            "h-2",
            status === 'over' && "[&>div]:bg-red-500",
            status === 'warning' && "[&>div]:bg-amber-500",
            status === 'ok' && "[&>div]:bg-green-500"
          )}
        />

        {/* Remaining/Over */}
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {status === 'over' ? 'Over by' : 'Remaining'}
          </span>
          <span className={cn(
            "font-medium",
            status === 'over' && "text-red-600",
            status !== 'over' && "text-green-600"
          )}>
            ${Math.abs(remaining).toFixed(2)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// CREATE/EDIT BUDGET DIALOG
// ============================================================================

interface BudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget: Budget | null;
  existingCategories: string[];
  onSave: (data: { category: string; limit_amount: number; period: string }) => Promise<void>;
}

const BudgetDialog: React.FC<BudgetDialogProps> = ({
  open,
  onOpenChange,
  budget,
  existingCategories,
  onSave
}) => {
  const [category, setCategory] = useState(budget?.category || '');
  const [limitAmount, setLimitAmount] = useState(budget?.limit_amount.toString() || '');
  const [period, setPeriod] = useState<string>(budget?.period || 'monthly');
  const [saving, setSaving] = useState(false);

  const isEditing = !!budget;

  // Filter out categories that already have budgets (unless editing that category)
  const availableCategories = BUDGET_CATEGORIES.filter(
    cat => !existingCategories.includes(cat) || cat === budget?.category
  );

  useEffect(() => {
    if (open) {
      setCategory(budget?.category || '');
      setLimitAmount(budget?.limit_amount.toString() || '');
      setPeriod(budget?.period || 'monthly');
    }
  }, [open, budget]);

  const handleSave = async () => {
    if (!category || !limitAmount) {
      toast.error('Please fill in all fields');
      return;
    }

    const amount = parseFloat(limitAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    setSaving(true);
    try {
      await onSave({ category, limit_amount: amount, period });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving budget:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Budget' : 'Create Budget'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update your spending limit for this category.'
              : 'Set a spending limit to track your expenses.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category}
              onValueChange={setCategory}
              disabled={isEditing}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    <span className="flex items-center gap-2">
                      <span>{categoryIcons[cat]}</span>
                      <span>{cat}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Budget Limit</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={limitAmount}
                onChange={(e) => setLimitAmount(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="period">Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger id="period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const BudgetManager: React.FC = () => {
  const { user } = useAuth();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [totalSpending, setTotalSpending] = useState(0);

  // Fetch budgets with current spending
  useEffect(() => {
    if (!user?.id) return;

    const fetchBudgets = async () => {
      setLoading(true);
      try {
        // Get budgets
        const { data: budgetData, error: budgetError } = await supabase
          .from('budgets')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('category');

        if (budgetError) throw budgetError;

        // Get current month's transactions for spending calculation
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { data: transactionData, error: transactionError } = await supabase
          .from('transactions')
          .select('category, amount')
          .eq('user_id', user.id)
          .gte('transaction_date', startOfMonth.toISOString());

        if (transactionError) throw transactionError;

        // Calculate spending by category
        const spendingByCategory: Record<string, number> = {};
        let total = 0;

        (transactionData || []).forEach((t: { category: string; amount: number }) => {
          spendingByCategory[t.category] = (spendingByCategory[t.category] || 0) + t.amount;
          total += t.amount;
        });

        setTotalSpending(total);

        // Merge spending with budgets
        const budgetsWithSpending = (budgetData || []).map((budget: Budget) => {
          const spending = spendingByCategory[budget.category] || 0;
          return {
            ...budget,
            current_spending: spending,
            percentage: budget.limit_amount > 0 ? (spending / budget.limit_amount) * 100 : 0
          };
        });

        setBudgets(budgetsWithSpending);

      } catch (error) {
        console.error('Error fetching budgets:', error);
        toast.error('Failed to load budgets');
      } finally {
        setLoading(false);
      }
    };

    fetchBudgets();
  }, [user?.id]);

  const handleCreateBudget = () => {
    setEditingBudget(null);
    setDialogOpen(true);
  };

  const handleEditBudget = (budget: Budget) => {
    setEditingBudget(budget);
    setDialogOpen(true);
  };

  const handleDeleteBudget = async (id: string) => {
    try {
      const { error } = await supabase
        .from('budgets')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;

      setBudgets(budgets.filter(b => b.id !== id));
      toast.success('Budget deleted');
    } catch (error) {
      console.error('Error deleting budget:', error);
      toast.error('Failed to delete budget');
    }
  };

  const handleSaveBudget = async (data: { category: string; limit_amount: number; period: string }) => {
    if (!user?.id) return;

    try {
      if (editingBudget) {
        // Update existing budget
        const { error } = await supabase
          .from('budgets')
          .update({
            limit_amount: data.limit_amount,
            period: data.period
          })
          .eq('id', editingBudget.id);

        if (error) throw error;

        setBudgets(budgets.map(b =>
          b.id === editingBudget.id
            ? { ...b, limit_amount: data.limit_amount, period: data.period as Budget['period'] }
            : b
        ));

        toast.success('Budget updated');
      } else {
        // Create new budget
        const { data: newBudget, error } = await supabase
          .from('budgets')
          .insert({
            user_id: user.id,
            category: data.category,
            limit_amount: data.limit_amount,
            period: data.period
          })
          .select()
          .single();

        if (error) throw error;

        setBudgets([...budgets, { ...newBudget, current_spending: 0, percentage: 0 }]);
        toast.success('Budget created');
      }
    } catch (error) {
      console.error('Error saving budget:', error);
      toast.error('Failed to save budget');
      throw error;
    }
  };

  const existingCategories = budgets.map(b => b.category);
  const totalBudgeted = budgets.reduce((sum, b) => sum + b.limit_amount, 0);
  const overBudgetCount = budgets.filter(b => (b.percentage || 0) >= 100).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-muted/50 rounded-lg animate-pulse" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-muted/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Budgeted</p>
                <p className="text-xl font-bold">${totalBudgeted.toFixed(0)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <PieChart className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">This Month</p>
                <p className="text-xl font-bold">${totalSpending.toFixed(0)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-lg",
                overBudgetCount > 0 ? "bg-red-100" : "bg-green-100"
              )}>
                {overBudgetCount > 0 ? (
                  <TrendingDown className="w-5 h-5 text-red-600" />
                ) : (
                  <TrendingUp className="w-5 h-5 text-green-600" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Over Budget</p>
                <p className={cn(
                  "text-xl font-bold",
                  overBudgetCount > 0 ? "text-red-600" : "text-green-600"
                )}>
                  {overBudgetCount} {overBudgetCount === 1 ? 'category' : 'categories'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Header with Add Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Your Budgets</h2>
          <p className="text-sm text-muted-foreground">
            {budgets.length} {budgets.length === 1 ? 'budget' : 'budgets'} set
          </p>
        </div>

        <Button onClick={handleCreateBudget}>
          <Plus className="w-4 h-4 mr-2" />
          Add Budget
        </Button>
      </div>

      {/* Budget Cards Grid */}
      {budgets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Wallet className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="font-medium mb-1">No budgets yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first budget to start tracking spending
            </p>
            <Button onClick={handleCreateBudget} variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              Create Budget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map(budget => (
            <BudgetCard
              key={budget.id}
              budget={budget}
              onEdit={handleEditBudget}
              onDelete={handleDeleteBudget}
            />
          ))}
        </div>
      )}

      {/* Budget Dialog */}
      <BudgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        budget={editingBudget}
        existingCategories={existingCategories}
        onSave={handleSaveBudget}
      />
    </div>
  );
};

export default BudgetManager;
