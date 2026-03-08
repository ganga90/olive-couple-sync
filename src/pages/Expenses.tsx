import React, { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { useExpenses, Expense, ExpenseSplitType, getCategoryIcon, getCurrencySymbol, EXPENSE_CATEGORY_ICONS, BudgetLimit } from '@/hooks/useExpenses';
import { format, subDays, startOfMonth, startOfWeek, isWithinInterval, parseISO } from 'date-fns';
import {
  DollarSign, Receipt, TrendingUp, Archive, ChevronRight, Check,
  Plus, ArrowLeftRight, BarChart3, Filter, Image, FileText,
  Wallet, Eye, Calendar, Target, Trash2, Upload, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useLocalizedHref } from '@/hooks/useLocalizedNavigate';
import { useDateLocale } from '@/hooks/useDateLocale';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// ADD EXPENSE DIALOG
// ============================================================================

interface AddExpenseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (data: any) => void;
  coupleId?: string | null;
  userId?: string;
  youName: string;
  partnerName: string;
  hasPartner: boolean;
  defaultCurrency: string;
  defaultSplit: ExpenseSplitType;
}

const AddExpenseDialog: React.FC<AddExpenseDialogProps> = ({
  open, onOpenChange, onAdd, coupleId, userId, youName, partnerName, hasPartner, defaultCurrency, defaultSplit
}) => {
  const { t } = useTranslation('expenses');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Other');
  const [splitType, setSplitType] = useState<ExpenseSplitType>(hasPartner ? defaultSplit : 'individual');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setCurrency(defaultCurrency);
      setSplitType(hasPartner ? defaultSplit : 'individual');
      setReceiptFile(null);
      setReceiptPreview(null);
    }
  }, [open, defaultCurrency, defaultSplit, hasPartner]);

  const handleReceiptUpload = async (file: File) => {
    setReceiptFile(file);
    const preview = URL.createObjectURL(file);
    setReceiptPreview(preview);

    // OCR via process-receipt
    setOcrLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const { data, error } = await supabase.functions.invoke('process-receipt', {
          body: { image_base64: base64, user_id: userId }
        });
        if (!error && data?.transaction) {
          if (data.transaction.merchant) setName(data.transaction.merchant);
          if (data.transaction.amount) setAmount(String(data.transaction.amount));
          if (data.transaction.category) {
            const cat = data.transaction.category;
            if (EXPENSE_CATEGORY_ICONS[cat]) setCategory(cat);
          }
          toast.success(t('receipt.scanned', 'Receipt scanned successfully!'));
        }
        setOcrLoading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setOcrLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !amount) {
      toast.error(t('addDialog.fillFields', 'Please fill in all fields'));
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error(t('addDialog.invalidAmount', 'Please enter a valid amount'));
      return;
    }

    setSaving(true);

    // Upload receipt if present
    let receiptUrl: string | null = null;
    if (receiptFile && userId) {
      try {
        const ext = receiptFile.name.split('.').pop() || 'jpg';
        const path = `receipts/${userId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('note-media').upload(path, receiptFile);
        if (!uploadErr) {
          const { data: urlData } = await supabase.functions.invoke('get-signed-url', {
            body: { bucket: 'note-media', path }
          });
          receiptUrl = urlData?.signedUrl || null;
        }
      } catch (err) {
        console.warn('Receipt upload failed:', err);
      }
    }

    await onAdd({
      name: name.trim(),
      amount: amountNum,
      currency,
      category,
      category_icon: getCategoryIcon(category),
      split_type: splitType,
      paid_by: (splitType === 'partner_paid_split' || splitType === 'partner_owed_full') ? 'partner' : userId,
      is_shared: splitType !== 'individual',
      couple_id: splitType !== 'individual' ? coupleId : null,
      expense_date: new Date().toISOString(),
      receipt_url: receiptUrl,
    });
    setSaving(false);
    setName('');
    setAmount('');
    setCategory('Other');
    setReceiptFile(null);
    setReceiptPreview(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addDialog.title', 'Add Expense')}</DialogTitle>
          <DialogDescription>{t('addDialog.description', 'Track a new expense')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Receipt Upload */}
          <div>
            <Label>{t('receipt.label', 'Receipt (optional)')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleReceiptUpload(file);
              }}
            />
            {receiptPreview ? (
              <div className="relative mt-1">
                <img src={receiptPreview} alt="Receipt" className="h-24 rounded-lg object-cover w-full bg-muted" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1 right-1 h-6 w-6 p-0 bg-background/80 rounded-full"
                  onClick={() => { setReceiptFile(null); setReceiptPreview(null); }}
                >
                  <X className="w-3 h-3" />
                </Button>
                {ocrLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-lg">
                    <span className="text-xs text-muted-foreground animate-pulse">{t('receipt.scanning', 'Scanning...')}</span>
                  </div>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" />
                {t('receipt.upload', 'Scan Receipt')}
              </Button>
            )}
          </div>

          <div>
            <Label>{t('addDialog.name', 'Expense name')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('addDialog.namePlaceholder', 'e.g. Whole Foods groceries')} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('addDialog.amount', 'Amount')}</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="mt-1" />
            </div>
            <div>
              <Label>{t('addDialog.currency', 'Currency')}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">$ USD</SelectItem>
                  <SelectItem value="EUR">€ EUR</SelectItem>
                  <SelectItem value="GBP">£ GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>{t('addDialog.category', 'Category')}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(EXPENSE_CATEGORY_ICONS).map(([cat, icon]) => (
                  <SelectItem key={cat} value={cat}>
                    <span className="flex items-center gap-2"><span>{icon}</span> {cat}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasPartner && (
            <div>
              <Label>{t('addDialog.splitType', 'Split type')}</Label>
              <Select value={splitType} onValueChange={v => setSplitType(v as ExpenseSplitType)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="you_paid_split">{t('split.youPaidSplit', '{{you}} paid, split equally', { you: youName })}</SelectItem>
                  <SelectItem value="you_owed_full">{t('split.youOwedFull', '{{partner}} owes full amount', { partner: partnerName })}</SelectItem>
                  <SelectItem value="partner_paid_split">{t('split.partnerPaidSplit', '{{partner}} paid, split equally', { partner: partnerName })}</SelectItem>
                  <SelectItem value="partner_owed_full">{t('split.partnerOwedFull', '{{you}} owes full amount', { you: youName })}</SelectItem>
                  <SelectItem value="individual">{t('split.individual', 'Individual (no split)')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('addDialog.cancel', 'Cancel')}</Button>
          <Button onClick={handleSave} disabled={saving || ocrLoading}>{saving ? '...' : t('addDialog.save', 'Add Expense')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============================================================================
// EXPENSE ROW
// ============================================================================

interface ExpenseRowProps {
  expense: Expense;
  youName: string;
  partnerName: string;
  userId?: string;
  onUpdateSplit: (id: string, split: ExpenseSplitType) => void;
  onViewDetails: (expense: Expense) => void;
}

const ExpenseRow: React.FC<ExpenseRowProps> = ({ expense, youName, partnerName, userId, onUpdateSplit, onViewDetails }) => {
  const { t } = useTranslation('expenses');
  const dateLocale = useDateLocale();
  const currencySymbol = getCurrencySymbol(expense.currency);

  let splitLabel = '';
  let splitColor = 'text-muted-foreground';
  const half = expense.amount / 2;

  switch (expense.split_type) {
    case 'you_paid_split':
      splitLabel = t('row.youLent', '{{you}} lent {{symbol}}{{amount}}', { you: youName, symbol: currencySymbol, amount: half.toFixed(2) });
      splitColor = 'text-[hsl(var(--success))]';
      break;
    case 'you_owed_full':
      splitLabel = t('row.partnerOwes', '{{partner}} owes {{symbol}}{{amount}}', { partner: partnerName, symbol: currencySymbol, amount: expense.amount.toFixed(2) });
      splitColor = 'text-[hsl(var(--success))]';
      break;
    case 'partner_paid_split':
      splitLabel = t('row.youOwe', '{{you}} owes {{symbol}}{{amount}}', { you: youName, symbol: currencySymbol, amount: half.toFixed(2) });
      splitColor = 'text-[hsl(var(--warning))]';
      break;
    case 'partner_owed_full':
      splitLabel = t('row.youOweFull', '{{you}} owes {{symbol}}{{amount}}', { you: youName, symbol: currencySymbol, amount: expense.amount.toFixed(2) });
      splitColor = 'text-[hsl(var(--warning))]';
      break;
    case 'individual':
      splitLabel = t('row.individual', 'Individual');
      break;
  }

  return (
    <button
      onClick={() => onViewDetails(expense)}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted/70 transition-colors text-left"
    >
      <span className="text-2xl flex-shrink-0">{expense.category_icon || getCategoryIcon(expense.category)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{expense.name}</p>
          {expense.receipt_url && <Image className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{expense.category}</Badge>
          <span className="text-[11px] text-muted-foreground">
            {format(new Date(expense.expense_date), 'MMM d', { locale: dateLocale })}
          </span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="font-semibold text-sm">{currencySymbol}{expense.amount.toFixed(2)}</p>
        {expense.split_type !== 'individual' && (
          <p className={cn("text-[11px]", splitColor)}>{splitLabel}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
};

// ============================================================================
// EXPENSE DETAILS DIALOG
// ============================================================================

interface ExpenseDetailsProps {
  expense: Expense | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  youName: string;
  partnerName: string;
  userId?: string;
  hasPartner: boolean;
  onUpdateSplit: (id: string, split: ExpenseSplitType) => void;
  onDelete: (id: string) => void;
}

const ExpenseDetailsDialog: React.FC<ExpenseDetailsProps> = ({
  expense, open, onOpenChange, youName, partnerName, userId, hasPartner, onUpdateSplit, onDelete
}) => {
  const { t } = useTranslation('expenses');
  const navigate = useNavigate();
  const getLocalizedPath = useLocalizedHref();
  const dateLocale = useDateLocale();

  if (!expense) return null;
  const currencySymbol = getCurrencySymbol(expense.currency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{expense.category_icon || getCategoryIcon(expense.category)}</span>
            {expense.name}
          </DialogTitle>
          <DialogDescription>{t('details.description', 'Expense details and options')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-sm">{t('details.amount', 'Amount')}</span>
            <span className="text-2xl font-bold">{currencySymbol}{expense.amount.toFixed(2)}</span>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">{t('details.category', 'Category')}</span>
              <p className="font-medium">{expense.category}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t('details.date', 'Date')}</span>
              <p className="font-medium">{format(new Date(expense.expense_date), 'PPP', { locale: dateLocale })}</p>
            </div>
          </div>

          {hasPartner && expense.split_type !== 'individual' && (
            <>
              <Separator />
              <div>
                <Label className="text-sm">{t('details.changeSplit', 'Change split')}</Label>
                <Select value={expense.split_type} onValueChange={v => onUpdateSplit(expense.id, v as ExpenseSplitType)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="you_paid_split">{t('split.youPaidSplit', '{{you}} paid, split equally', { you: youName })}</SelectItem>
                    <SelectItem value="you_owed_full">{t('split.youOwedFull', '{{partner}} owes full amount', { partner: partnerName })}</SelectItem>
                    <SelectItem value="partner_paid_split">{t('split.partnerPaidSplit', '{{partner}} paid, split equally', { partner: partnerName })}</SelectItem>
                    <SelectItem value="partner_owed_full">{t('split.partnerOwedFull', '{{you}} owes full amount', { you: youName })}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {expense.original_text && (
            <>
              <Separator />
              <div>
                <span className="text-muted-foreground text-sm">{t('details.originalNote', 'Original note')}</span>
                <p className="mt-1 text-sm bg-muted/50 p-3 rounded-xl">{expense.original_text}</p>
              </div>
            </>
          )}

          {expense.note_id && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                navigate(getLocalizedPath(`/notes/${expense.note_id}`));
              }}
            >
              <FileText className="w-4 h-4 mr-2" />
              {t('details.viewNote', 'View linked note')}
            </Button>
          )}

          {expense.receipt_url && (
            <div>
              <span className="text-muted-foreground text-sm">{t('details.receipt', 'Receipt')}</span>
              <img src={expense.receipt_url} alt="Receipt" className="mt-2 rounded-xl max-h-48 object-contain w-full bg-muted/30" />
            </div>
          )}
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="destructive" size="sm" onClick={() => { onDelete(expense.id); onOpenChange(false); }}>
            {t('details.delete', 'Delete')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('details.close', 'Close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============================================================================
// BUDGET LIMIT DIALOG
// ============================================================================

interface BudgetLimitDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (category: string, limit: number) => void;
  onRemove: (id: string) => void;
  budgetStatus: Array<BudgetLimit & { spent: number; percentage: number; status: 'ok' | 'warning' | 'over' }>;
  currencySymbol: string;
}

const BudgetLimitDialog: React.FC<BudgetLimitDialogProps> = ({
  open, onOpenChange, onSave, onRemove, budgetStatus, currencySymbol
}) => {
  const { t } = useTranslation('expenses');
  const [category, setCategory] = useState('Groceries');
  const [limit, setLimit] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            {t('budget.title', 'Budget Limits')}
          </DialogTitle>
          <DialogDescription>{t('budget.description', 'Set monthly spending limits per category')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Existing limits */}
          {budgetStatus.length > 0 && (
            <div className="space-y-2">
              {budgetStatus.map(bl => (
                <div key={bl.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                  <span className="text-lg">{getCategoryIcon(bl.category)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{bl.category}</span>
                      <span className={cn(
                        "text-xs",
                        bl.status === 'over' ? 'text-destructive' : bl.status === 'warning' ? 'text-[hsl(var(--warning,40_100%_50%))]' : 'text-muted-foreground'
                      )}>
                        {currencySymbol}{bl.spent.toFixed(0)} / {currencySymbol}{bl.monthly_limit.toFixed(0)}
                      </span>
                    </div>
                    <Progress
                      value={Math.min(bl.percentage, 100)}
                      className={cn("h-1.5 mt-1", bl.status === 'over' ? '[&>div]:bg-destructive' : bl.status === 'warning' ? '[&>div]:bg-[hsl(var(--warning,40_100%_50%))]' : '')}
                    />
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onRemove(bl.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Add new limit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('budget.category', 'Category')}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPENSE_CATEGORY_ICONS).map(([cat, icon]) => (
                    <SelectItem key={cat} value={cat}>
                      <span className="flex items-center gap-2"><span>{icon}</span> {cat}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('budget.monthlyLimit', 'Monthly limit')}</Label>
              <Input type="number" step="1" min="0" value={limit} onChange={e => setLimit(e.target.value)} placeholder="500" className="mt-1" />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={!limit || parseFloat(limit) <= 0}
            onClick={() => {
              onSave(category, parseFloat(limit));
              setLimit('');
            }}
          >
            <Plus className="w-4 h-4 mr-1" />
            {t('budget.addLimit', 'Set Limit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ============================================================================
// MAIN EXPENSES PAGE
// ============================================================================

const ExpensesPage: React.FC = () => {
  const { t } = useTranslation('expenses');
  const { user } = useAuth();
  const { currentCouple, you, partner } = useSupabaseCouple();
  const {
    activeExpenses, archivedExpenses, loading, analytics, netBalance, preferences,
    addExpense, updateExpense, deleteExpense, settleExpenses,
    budgetStatus, monthlyTrends, setBudgetLimit, removeBudgetLimit
  } = useExpenses();

  const [addOpen, setAddOpen] = useState(false);
  const [detailsExpense, setDetailsExpense] = useState<Expense | null>(null);
  const [activeTab, setActiveTab] = useState('active');
  const [analyticsRange, setAnalyticsRange] = useState<'week' | 'month' | '30days'>('month');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);

  // Date range filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const hasPartner = Boolean(currentCouple && partner);
  const youName = you || t('you', 'You');
  const partnerName = partner || t('partner', 'Partner');
  const currencySymbol = getCurrencySymbol(preferences.defaultCurrency);

  const handleUpdateSplit = async (id: string, split: ExpenseSplitType) => {
    await updateExpense(id, { split_type: split });
    toast.success(t('toast.splitUpdated', 'Split updated'));
  };

  // Filtered expenses for analytics range
  const rangeFilteredExpenses = useMemo(() => {
    const now = new Date();
    let start: Date;
    switch (analyticsRange) {
      case 'week':
        start = startOfWeek(now);
        break;
      case '30days':
        start = subDays(now, 30);
        break;
      case 'month':
      default:
        start = startOfMonth(now);
        break;
    }
    return activeExpenses.filter(e => new Date(e.expense_date) >= start);
  }, [activeExpenses, analyticsRange]);

  // Category + date range filtered active expenses
  const displayExpenses = useMemo(() => {
    let filtered = activeExpenses;
    if (categoryFilter) {
      filtered = filtered.filter(e => e.category === categoryFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      filtered = filtered.filter(e => new Date(e.expense_date) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59);
      filtered = filtered.filter(e => new Date(e.expense_date) <= to);
    }
    return filtered;
  }, [activeExpenses, categoryFilter, dateFrom, dateTo]);

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="space-y-5 pb-32 md:pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight font-serif">
            {t('title', 'Expenses')}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t('subtitle', 'Track, split, and settle expenses')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setBudgetDialogOpen(true)}>
            <Target className="w-4 h-4" />
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)} className="rounded-full">
            <Plus className="w-4 h-4 mr-1" />
            {t('addButton', 'Add')}
          </Button>
        </div>
      </div>

      {/* Budget alerts */}
      {budgetStatus.filter(b => b.status !== 'ok').length > 0 && (
        <div className="space-y-2">
          {budgetStatus.filter(b => b.status !== 'ok').map(bl => (
            <div
              key={bl.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-xl text-sm",
                bl.status === 'over' ? "bg-destructive/10 text-destructive" : "bg-[hsl(var(--warning,40_100%_50%))]/10 text-[hsl(var(--warning,40_100%_50%))]"
              )}
            >
              <Target className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">
                {bl.status === 'over'
                  ? t('budget.overLimit', '{{category}} over budget: {{spent}}/{{limit}}', { category: bl.category, spent: `${currencySymbol}${bl.spent.toFixed(0)}`, limit: `${currencySymbol}${bl.monthly_limit.toFixed(0)}` })
                  : t('budget.nearLimit', '{{category}} at {{pct}}% of budget', { category: bl.category, pct: bl.percentage })
                }
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Balance Summary Cards */}
      <div className={cn("grid gap-3", hasPartner ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2")}>
        <Card className="bg-card/80 backdrop-blur">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="w-3.5 h-3.5" />
              {t('summary.total', 'Total Active')}
            </div>
            <p className="text-xl font-bold">{currencySymbol}{analytics.totalExpenses.toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/80 backdrop-blur">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Receipt className="w-3.5 h-3.5" />
              {t('summary.count', 'Count')}
            </div>
            <p className="text-xl font-bold">{activeExpenses.length}</p>
            {activeExpenses.length > 0 && !hasPartner && (
              <Button size="sm" variant="ghost" onClick={settleExpenses} className="rounded-full text-xs mt-1 h-7 px-2">
                <Archive className="w-3 h-3 mr-1" />
                {t('archiveAll', 'Archive All')}
              </Button>
            )}
          </CardContent>
        </Card>

        {hasPartner && (
          <>
            <Card className={cn("bg-card/80 backdrop-blur", netBalance > 0 ? "border-[hsl(var(--success))]/30" : netBalance < 0 ? "border-[hsl(var(--warning))]/30" : "")}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  {t('summary.balance', 'Net Balance')}
                </div>
                <p className={cn("text-xl font-bold", netBalance > 0 ? "text-[hsl(var(--success))]" : netBalance < 0 ? "text-[hsl(var(--warning))]" : "")}>
                  {netBalance > 0
                    ? `${partnerName} ${t('summary.owesYou', 'owes')} ${currencySymbol}${netBalance.toFixed(2)}`
                    : netBalance < 0
                      ? `${t('summary.youOwe', 'You owe')} ${currencySymbol}${Math.abs(netBalance).toFixed(2)}`
                      : t('summary.settled', 'All settled!')
                  }
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card/80 backdrop-blur col-span-2 md:col-span-1">
              <CardContent className="pt-4 pb-3 px-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t('summary.unsettled', 'Unsettled')}</p>
                  <p className="text-lg font-semibold">{activeExpenses.length} {t('summary.expenses', 'expenses')}</p>
                </div>
                {activeExpenses.length > 0 && (
                  <Button size="sm" variant="outline" onClick={settleExpenses} className="rounded-full">
                    <Check className="w-4 h-4 mr-1" />
                    {t('settle', 'Settle Up')}
                  </Button>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Top Categories */}
      {analytics.topCategories.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t('topCategories', 'Top Categories')}</h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {analytics.topCategories.slice(0, 5).map(cat => (
              <button
                key={cat.category}
                onClick={() => setCategoryFilter(categoryFilter === cat.category ? null : cat.category)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-full border text-sm whitespace-nowrap transition-colors",
                  categoryFilter === cat.category
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card/80 hover:bg-muted/50 border-border"
                )}
              >
                <span>{cat.icon}</span>
                <span className="font-medium">{cat.category}</span>
                <span className="text-xs opacity-70">{currencySymbol}{cat.total.toFixed(0)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 rounded-full">
          <TabsTrigger value="active" className="rounded-full text-xs">
            <Wallet className="w-3.5 h-3.5 mr-1" />
            {t('tabs.active', 'Active')}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="rounded-full text-xs">
            <BarChart3 className="w-3.5 h-3.5 mr-1" />
            {t('tabs.analytics', 'Analytics')}
          </TabsTrigger>
          <TabsTrigger value="archive" className="rounded-full text-xs">
            <Archive className="w-3.5 h-3.5 mr-1" />
            {t('tabs.archive', 'Archive')}
          </TabsTrigger>
        </TabsList>

        {/* Active Expenses */}
        <TabsContent value="active" className="mt-3 space-y-3">
          {/* Date range filter */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-8 text-xs"
                placeholder={t('filter.from', 'From')}
              />
              <span className="text-muted-foreground text-xs">–</span>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-8 text-xs"
                placeholder={t('filter.to', 'To')}
              />
            </div>
            {hasDateFilter && (
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          {(categoryFilter || hasDateFilter) && (
            <div className="flex items-center gap-2 flex-wrap">
              {categoryFilter && (
                <Badge variant="secondary" className="gap-1">
                  <Filter className="w-3 h-3" />
                  {categoryFilter}
                </Badge>
              )}
              {hasDateFilter && (
                <Badge variant="secondary" className="gap-1">
                  <Calendar className="w-3 h-3" />
                  {dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo}
                </Badge>
              )}
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setCategoryFilter(null); setDateFrom(''); setDateTo(''); }}>
                {t('clearFilter', 'Clear')}
              </Button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">{t('loading', 'Loading expenses...')}</div>
          ) : displayExpenses.length === 0 ? (
            <Card className="bg-card/80">
              <CardContent className="py-12 text-center">
                <Receipt className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                <p className="font-medium text-muted-foreground">{t('empty.title', 'No expenses yet')}</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {t('empty.description', 'Add an expense or send a note with a $ amount')}
                </p>
                <Button size="sm" className="mt-4 rounded-full" onClick={() => setAddOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  {t('addButton', 'Add')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/80 overflow-hidden">
              <div className="divide-y divide-border">
                {displayExpenses.map(expense => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    youName={youName}
                    partnerName={partnerName}
                    userId={user?.id}
                    onUpdateSplit={handleUpdateSplit}
                    onViewDetails={setDetailsExpense}
                  />
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="mt-3 space-y-4">
          {/* Monthly Spending Trend */}
          <Card className="bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                {t('analytics.monthlyTrend', 'Monthly Spending')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyTrends.some(m => m.total > 0) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={monthlyTrends}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" width={50} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', fontSize: '13px' }}
                      formatter={(value: number) => [`${currencySymbol}${value.toFixed(2)}`, t('analytics.total', 'Total')]}
                    />
                    <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">{t('analytics.noData', 'No expenses in this period')}</p>
              )}
            </CardContent>
          </Card>

          {/* Budget Progress */}
          {budgetStatus.length > 0 && (
            <Card className="bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  {t('budget.progress', 'Budget Progress')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {budgetStatus.map(bl => (
                  <div key={bl.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-1.5">
                        <span>{getCategoryIcon(bl.category)}</span>
                        <span className="font-medium">{bl.category}</span>
                      </span>
                      <span className={cn(
                        "text-xs",
                        bl.status === 'over' ? 'text-destructive font-semibold' : bl.status === 'warning' ? 'text-[hsl(var(--warning,40_100%_50%))]' : 'text-muted-foreground'
                      )}>
                        {currencySymbol}{bl.spent.toFixed(0)} / {currencySymbol}{bl.monthly_limit.toFixed(0)} ({bl.percentage}%)
                      </span>
                    </div>
                    <Progress
                      value={Math.min(bl.percentage, 100)}
                      className={cn("h-2", bl.status === 'over' ? '[&>div]:bg-destructive' : bl.status === 'warning' ? '[&>div]:bg-[hsl(var(--warning,40_100%_50%))]' : '')}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Category Breakdown */}
          <div className="flex gap-2">
            {(['week', 'month', '30days'] as const).map(range => (
              <Button
                key={range}
                size="sm"
                variant={analyticsRange === range ? 'default' : 'outline'}
                className="rounded-full text-xs"
                onClick={() => setAnalyticsRange(range)}
              >
                {range === 'week' ? t('range.week', 'This Week') : range === 'month' ? t('range.month', 'This Month') : t('range.30days', 'Last 30 Days')}
              </Button>
            ))}
          </div>
          <Card className="bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('analytics.spending', 'Spending by Category')}</CardTitle>
            </CardHeader>
            <CardContent>
              {rangeFilteredExpenses.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t('analytics.noData', 'No expenses in this period')}</p>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const catMap: Record<string, { total: number; count: number; icon: string }> = {};
                    rangeFilteredExpenses.forEach(e => {
                      if (!catMap[e.category]) catMap[e.category] = { total: 0, count: 0, icon: e.category_icon || getCategoryIcon(e.category) };
                      catMap[e.category].total += e.amount;
                      catMap[e.category].count++;
                    });
                    const sorted = Object.entries(catMap).sort(([, a], [, b]) => b.total - a.total);
                    const maxTotal = sorted[0]?.[1]?.total || 1;
                    return sorted.map(([cat, data]) => (
                      <div key={cat} className="flex items-center gap-3">
                        <span className="text-xl">{data.icon}</span>
                        <div className="flex-1">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="font-medium">{cat}</span>
                            <span className="font-semibold">{currencySymbol}{data.total.toFixed(2)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${(data.total / maxTotal) * 100}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">{data.count} {t('analytics.transactions', 'transactions')}</span>
                        </div>
                      </div>
                    ));
                  })()}
                  <Separator />
                  <div className="flex justify-between font-semibold text-sm">
                    <span>{t('analytics.total', 'Total')}</span>
                    <span>{currencySymbol}{rangeFilteredExpenses.reduce((s, e) => s + e.amount, 0).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Archive */}
        <TabsContent value="archive" className="mt-3">
          {archivedExpenses.length === 0 ? (
            <Card className="bg-card/80">
              <CardContent className="py-12 text-center">
                <Archive className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                <p className="font-medium text-muted-foreground">{t('archive.empty', 'No settled expenses')}</p>
                <p className="text-sm text-muted-foreground/70 mt-1">{t('archive.description', 'Settled expenses will appear here')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/80 overflow-hidden">
              <div className="divide-y divide-border">
                {archivedExpenses.map(expense => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    youName={youName}
                    partnerName={partnerName}
                    userId={user?.id}
                    onUpdateSplit={handleUpdateSplit}
                    onViewDetails={setDetailsExpense}
                  />
                ))}
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AddExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={addExpense}
        coupleId={currentCouple?.id}
        userId={user?.id}
        youName={youName}
        partnerName={partnerName}
        hasPartner={hasPartner}
        defaultCurrency={preferences.defaultCurrency}
        defaultSplit={preferences.defaultSplit}
      />
      <ExpenseDetailsDialog
        expense={detailsExpense}
        open={!!detailsExpense}
        onOpenChange={v => { if (!v) setDetailsExpense(null); }}
        youName={youName}
        partnerName={partnerName}
        userId={user?.id}
        hasPartner={hasPartner}
        onUpdateSplit={handleUpdateSplit}
        onDelete={deleteExpense}
      />
      <BudgetLimitDialog
        open={budgetDialogOpen}
        onOpenChange={setBudgetDialogOpen}
        onSave={setBudgetLimit}
        onRemove={removeBudgetLimit}
        budgetStatus={budgetStatus}
        currencySymbol={currencySymbol}
      />
    </div>
  );
};

export default ExpensesPage;
