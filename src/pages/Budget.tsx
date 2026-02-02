/**
 * Budget Management Page
 * ============================================================================
 * Feature 1: Context-Aware Receipt Hunter
 *
 * This page allows users to:
 * - View and manage their spending budgets by category
 * - See recent transactions from receipt processing
 * - Track budget progress and spending trends
 * 
 * NOTE: This page currently uses local state only as the 
 * 'transactions' table is not yet created in the database.
 * TODO: Create transactions table and connect to Supabase
 */

import React, { useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import {
  Receipt,
  DollarSign,
  Calendar,
  RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BudgetManager } from '@/components/receipts';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Transaction {
  id: string;
  merchant: string;
  amount: number;
  category: string;
  transaction_date: string;
  budget_status: 'ok' | 'warning' | 'over_limit';
  confidence: number;
  created_at: string;
}

// ============================================================================
// SPENDING SUMMARY CARD
// ============================================================================

interface SpendingSummaryProps {
  transactions: Transaction[];
  loading: boolean;
}

const SpendingSummary: React.FC<SpendingSummaryProps> = ({ transactions, loading }) => {
  const currentMonth = new Date();
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  // Calculate monthly stats
  const monthlyTransactions = transactions.filter(t => {
    const date = new Date(t.transaction_date);
    return date >= monthStart && date <= monthEnd;
  });

  const totalSpent = monthlyTransactions.reduce((sum, t) => sum + t.amount, 0);
  const transactionCount = monthlyTransactions.length;
  const avgTransaction = transactionCount > 0 ? totalSpent / transactionCount : 0;

  // Get top category
  const categorySpending = monthlyTransactions.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {} as Record<string, number>);

  const topCategory = Object.entries(categorySpending)
    .sort(([,a], [,b]) => b - a)[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          {format(currentMonth, 'MMMM yyyy')}
        </CardTitle>
        <CardDescription>Spending summary</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Total Spent</p>
              <p className="text-2xl font-bold">${totalSpent.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Transactions</p>
              <p className="text-2xl font-bold">{transactionCount}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Average</p>
              <p className="text-lg font-semibold">${avgTransaction.toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Top Category</p>
              <p className="text-lg font-semibold">
                {topCategory ? topCategory[0] : 'None'}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ============================================================================
// RECENT TRANSACTIONS LIST
// ============================================================================

interface RecentTransactionsProps {
  transactions: Transaction[];
  loading: boolean;
}

const RecentTransactions: React.FC<RecentTransactionsProps> = ({ transactions, loading }) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Recent Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Recent Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No receipts yet</p>
            <p className="text-sm mt-1">
              Send a receipt photo to Olive to start tracking
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Receipt className="w-5 h-5" />
          Recent Receipts
        </CardTitle>
        <CardDescription>
          Last {transactions.length} transactions
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="divide-y">
            {transactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between p-4 hover:bg-muted/50"
              >
                <div className="space-y-1">
                  <p className="font-medium">{transaction.merchant}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">
                      {transaction.category}
                    </Badge>
                    <span>
                      {format(new Date(transaction.transaction_date), 'MMM d, yyyy')}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn(
                    "font-semibold",
                    transaction.budget_status === 'over_limit' && "text-red-600",
                    transaction.budget_status === 'warning' && "text-amber-600"
                  )}>
                    ${transaction.amount.toFixed(2)}
                  </p>
                  {transaction.budget_status !== 'ok' && (
                    <Badge
                      variant={transaction.budget_status === 'over_limit' ? 'destructive' : 'outline'}
                      className="text-[10px]"
                    >
                      {transaction.budget_status === 'over_limit' ? 'Over' : 'Warning'}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

const BudgetPage: React.FC = () => {
  const { user } = useAuth();
  const { currentCouple } = useSupabaseCouple();
  // Using local state only - transactions table not yet in database
  const [transactions] = useState<Transaction[]>([]);
  const [loading] = useState(false);
  const [activeTab, setActiveTab] = useState('budgets');

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Budget & Spending</h1>
        <p className="text-muted-foreground mt-1">
          Track your spending and manage category budgets
        </p>
      </div>

      {/* Spending Summary */}
      <SpendingSummary transactions={transactions} loading={loading} />

      {/* Tabs for Budgets vs Transactions */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="budgets">
            <DollarSign className="w-4 h-4 mr-2" />
            Budgets
          </TabsTrigger>
          <TabsTrigger value="transactions">
            <Receipt className="w-4 h-4 mr-2" />
            Transactions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="budgets" className="mt-4">
          <BudgetManager />
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <RecentTransactions transactions={transactions} loading={loading} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BudgetPage;
