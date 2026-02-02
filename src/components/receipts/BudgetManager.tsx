/**
 * BudgetManager Component
 * ============================================================================
 * Feature 1: Context-Aware Receipt Hunter
 *
 * Allows users to view, create, and manage spending budgets by category.
 * Displays current spending progress and provides budget insights.
 * 
 * NOTE: This component currently uses local state only as the 
 * 'budgets' and 'transactions' tables are not yet created in the database.
 * TODO: Create budgets and transactions tables and connect to Supabase
 */

import React, { useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import {
  Plus,
  Edit2,
  Trash2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  PieChart,
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
  onSave: (data: { category: string; limit_amount: number; period: string }) => void;
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

  React.useEffect(() => {
    if (open) {
      setCategory(budget?.category || '');
      setLimitAmount(budget?.limit_amount.toString() || '');
      setPeriod(budget?.period || 'monthly');
    }
  }, [open, budget]);

  const handleSave = () => {
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
    onSave({ category, limit_amount: amount, period });
    setSaving(false);
    onOpenChange(false);
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
  // Using local state only - budgets/transactions tables not yet in database
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  const totalSpending = budgets.reduce((sum, b) => sum + (b.current_spending || 0), 0);
  const totalBudget = budgets.reduce((sum, b) => sum + b.limit_amount, 0);
  const overallPercentage = totalBudget > 0 ? (totalSpending / totalBudget) * 100 : 0;

  const handleCreateBudget = () => {
    setEditingBudget(null);
    setDialogOpen(true);
  };

  const handleEditBudget = (budget: Budget) => {
    setEditingBudget(budget);
    setDialogOpen(true);
  };

  const handleDeleteBudget = (id: string) => {
    setBudgets(budgets.filter(b => b.id !== id));
    toast.success('Budget deleted');
  };

  const handleSaveBudget = (data: { category: string; limit_amount: number; period: string }) => {
    if (!user?.id) return;

    if (editingBudget) {
      // Update existing budget
      setBudgets(budgets.map(b =>
        b.id === editingBudget.id
          ? { ...b, limit_amount: data.limit_amount, period: data.period as Budget['period'] }
          : b
      ));
      toast.success('Budget updated');
    } else {
      // Create new budget
      const newBudget: Budget = {
        id: crypto.randomUUID(),
        category: data.category,
        limit_amount: data.limit_amount,
        period: data.period as Budget['period'],
        is_active: true,
        created_at: new Date().toISOString(),
        current_spending: 0,
        percentage: 0
      };
      setBudgets([...budgets, newBudget]);
      toast.success('Budget created');
    }
  };

  const existingCategories = budgets.map(b => b.category);

  const overBudgetCount = budgets.filter(b => (b.percentage || 0) >= 100).length;
  const warningCount = budgets.filter(b => {
    const p = b.percentage || 0;
    return p >= 80 && p < 100;
  }).length;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              <CardTitle>Budget Overview</CardTitle>
            </div>
            <Button onClick={handleCreateBudget} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Budget
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">${totalSpending.toFixed(0)}</p>
              <p className="text-xs text-muted-foreground">Total Spent</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">${totalBudget.toFixed(0)}</p>
              <p className="text-xs text-muted-foreground">Total Budget</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{warningCount}</p>
              <p className="text-xs text-muted-foreground">Near Limit</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{overBudgetCount}</p>
              <p className="text-xs text-muted-foreground">Over Budget</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1">
              <span>Overall Progress</span>
              <span>{overallPercentage.toFixed(0)}%</span>
            </div>
            <Progress 
              value={Math.min(overallPercentage, 100)} 
              className={cn(
                "h-2",
                overallPercentage >= 100 && "[&>div]:bg-red-500",
                overallPercentage >= 80 && overallPercentage < 100 && "[&>div]:bg-amber-500"
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* Budget Grid */}
      {budgets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <PieChart className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium text-lg">No budgets yet</h3>
            <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
              Create your first budget to start tracking spending by category
            </p>
            <Button onClick={handleCreateBudget} className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              Create Budget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {budgets.map((budget) => (
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
