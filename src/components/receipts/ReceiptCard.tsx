/**
 * ReceiptCard Component
 * ============================================================================
 * Feature 1: Context-Aware Receipt Hunter
 *
 * Displays a parsed receipt with transaction details and budget warnings.
 * Supports expandable line items and visual budget status indicators.
 */

import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Receipt,
  CreditCard,
  Calendar,
  Tag,
  ExternalLink,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface LineItem {
  name: string;
  quantity?: number;
  price: number;
}

export interface BudgetSummary {
  spent: number;
  limit: number;
  percentage: number;
  remaining?: number;
  overage?: number;
}

export interface BudgetWarning {
  alert: boolean;
  status: 'ok' | 'warning' | 'over_limit';
  message: string | null;
  summary: BudgetSummary | null;
}

export interface Transaction {
  id: string;
  merchant: string;
  amount: number;
  category: string;
  transaction_date: string;
  line_items?: LineItem[];
  payment_method?: string;
  confidence?: number;
  image_url?: string;
  budget_status?: 'ok' | 'warning' | 'over_limit';
}

export interface ReceiptCardProps {
  transaction: Transaction;
  budgetWarning?: BudgetWarning;
  onViewReceipt?: (imageUrl: string) => void;
  onEditTransaction?: (id: string) => void;
  compact?: boolean;
}

// ============================================================================
// CATEGORY STYLING
// ============================================================================

const categoryColors: Record<string, { bg: string; text: string; icon: string }> = {
  Groceries: { bg: 'bg-green-100', text: 'text-green-700', icon: '🛒' },
  Dining: { bg: 'bg-orange-100', text: 'text-orange-700', icon: '🍽️' },
  Travel: { bg: 'bg-blue-100', text: 'text-blue-700', icon: '✈️' },
  Utilities: { bg: 'bg-gray-100', text: 'text-gray-700', icon: '💡' },
  Entertainment: { bg: 'bg-purple-100', text: 'text-purple-700', icon: '🎬' },
  Shopping: { bg: 'bg-pink-100', text: 'text-pink-700', icon: '🛍️' },
  Health: { bg: 'bg-red-100', text: 'text-red-700', icon: '💊' },
  Transportation: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '🚗' },
  Subscriptions: { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: '📱' },
  Other: { bg: 'bg-slate-100', text: 'text-slate-700', icon: '📄' },
};

const getCategoryStyle = (category: string) => {
  return categoryColors[category] || categoryColors.Other;
};

// ============================================================================
// BUDGET STATUS INDICATOR
// ============================================================================

const BudgetStatusIndicator: React.FC<{
  status: 'ok' | 'warning' | 'over_limit';
  summary: BudgetSummary | null;
}> = ({ status, summary }) => {
  if (!summary) return null;

  const percentage = Math.min(summary.percentage, 100);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Budget used</span>
        <span className={cn(
          "font-medium",
          status === 'over_limit' && "text-red-600",
          status === 'warning' && "text-amber-600",
          status === 'ok' && "text-green-600"
        )}>
          {summary.percentage.toFixed(0)}%
        </span>
      </div>

      <Progress
        value={percentage}
        className={cn(
          "h-2",
          status === 'over_limit' && "[&>div]:bg-red-500",
          status === 'warning' && "[&>div]:bg-amber-500",
          status === 'ok' && "[&>div]:bg-green-500"
        )}
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>${summary.spent.toFixed(2)} spent</span>
        <span>${summary.limit.toFixed(2)} limit</span>
      </div>

      {status === 'over_limit' && summary.overage && (
        <div className="flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="w-3 h-3" />
          <span>${summary.overage.toFixed(2)} over budget</span>
        </div>
      )}

      {status === 'warning' && summary.remaining && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          <span>${summary.remaining.toFixed(2)} remaining</span>
        </div>
      )}

      {status === 'ok' && summary.remaining && (
        <div className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="w-3 h-3" />
          <span>${summary.remaining.toFixed(2)} remaining</span>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ReceiptCard: React.FC<ReceiptCardProps> = ({
  transaction,
  budgetWarning,
  onViewReceipt,
  onEditTransaction,
  compact = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const categoryStyle = getCategoryStyle(transaction.category);
  const hasLineItems = transaction.line_items && transaction.line_items.length > 0;
  const showBudgetAlert = budgetWarning?.alert && budgetWarning.status !== 'ok';

  const formattedDate = format(new Date(transaction.transaction_date), 'PPP');
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(transaction.amount);

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-200",
      showBudgetAlert && budgetWarning.status === 'over_limit' && "border-2 border-red-400 shadow-red-100",
      showBudgetAlert && budgetWarning.status === 'warning' && "border-2 border-amber-400 shadow-amber-100",
      compact && "shadow-sm"
    )}>
      {/* Budget Alert Banner */}
      {showBudgetAlert && budgetWarning.message && (
        <div className={cn(
          "px-4 py-3 border-b flex items-start gap-3",
          budgetWarning.status === 'over_limit' && "bg-red-50 border-red-200",
          budgetWarning.status === 'warning' && "bg-amber-50 border-amber-200"
        )}>
          <AlertTriangle className={cn(
            "w-5 h-5 flex-shrink-0 mt-0.5",
            budgetWarning.status === 'over_limit' && "text-red-500",
            budgetWarning.status === 'warning' && "text-amber-500"
          )} />
          <div className="flex-1">
            <p className={cn(
              "font-medium text-sm",
              budgetWarning.status === 'over_limit' && "text-red-700",
              budgetWarning.status === 'warning' && "text-amber-700"
            )}>
              {budgetWarning.status === 'over_limit' ? 'Budget Exceeded!' : 'Budget Warning'}
            </p>
            <p className={cn(
              "text-sm mt-0.5",
              budgetWarning.status === 'over_limit' && "text-red-600",
              budgetWarning.status === 'warning' && "text-amber-600"
            )}>
              {budgetWarning.message}
            </p>
          </div>
        </div>
      )}

      <CardHeader className={cn("pb-3", compact && "py-3")}>
        <div className="flex items-start justify-between gap-3">
          {/* Merchant & Category */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <h3 className="font-semibold text-base truncate">
                {transaction.merchant}
              </h3>
            </div>

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge
                variant="secondary"
                className={cn(
                  "text-xs font-medium",
                  categoryStyle.bg,
                  categoryStyle.text
                )}
              >
                <span className="mr-1">{categoryStyle.icon}</span>
                {transaction.category}
              </Badge>

              {transaction.payment_method && transaction.payment_method !== 'unknown' && (
                <Badge variant="outline" className="text-xs">
                  <CreditCard className="w-3 h-3 mr-1" />
                  {transaction.payment_method}
                </Badge>
              )}

              {transaction.confidence && transaction.confidence < 0.8 && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                  Low confidence
                </Badge>
              )}
            </div>
          </div>

          {/* Amount */}
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold">{formattedAmount}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <Calendar className="w-3 h-3" />
              <span>{formattedDate}</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className={cn("pt-0", compact && "pb-3")}>
        {/* Budget Progress (if budget exists) */}
        {budgetWarning?.summary && (
          <BudgetStatusIndicator
            status={budgetWarning.status}
            summary={budgetWarning.summary}
          />
        )}

        {/* Line Items (Expandable) */}
        {hasLineItems && !compact && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="mt-4">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between text-muted-foreground hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  {transaction.line_items!.length} item{transaction.line_items!.length !== 1 ? 's' : ''}
                </span>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent className="mt-2">
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                {transaction.line_items!.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}
                      {item.name}
                    </span>
                    <span className="font-medium">
                      ${item.price.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Actions */}
        {(onViewReceipt || onEditTransaction) && !compact && (
          <div className="flex items-center gap-2 mt-4 pt-3 border-t">
            {transaction.image_url && onViewReceipt && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onViewReceipt(transaction.image_url!)}
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                View Receipt
              </Button>
            )}

            {onEditTransaction && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEditTransaction(transaction.id)}
              >
                Edit
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ReceiptCard;
