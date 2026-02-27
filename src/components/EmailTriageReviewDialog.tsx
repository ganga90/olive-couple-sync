/**
 * Email Triage Review Dialog
 *
 * Shows parsed email results for the user to review before saving as tasks.
 * Users can select/deselect individual items, edit priorities, and confirm.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Mail, Calendar, AlertTriangle, CheckCircle2, ArrowRight, Inbox } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/providers/AuthProvider';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { useSupabaseNotesContext } from '@/providers/SupabaseNotesProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TriageItem {
  email_id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  classification: string;
  task_summary: string | null;
  due_date: string | null;
  priority: string | null;
  category: string | null;
  selected: boolean;
}

interface EmailTriageReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmailTriageReviewDialog({ open, onOpenChange }: EmailTriageReviewDialogProps) {
  const { t } = useTranslation(['home', 'common']);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { currentCouple } = useSupabaseCouple();
  const { refetch } = useSupabaseNotesContext();

  const [phase, setPhase] = useState<'idle' | 'scanning' | 'review' | 'saving'>('idle');
  const [items, setItems] = useState<TriageItem[]>([]);
  const [emailsScanned, setEmailsScanned] = useState(0);

  const handleScan = useCallback(async () => {
    if (!user?.id) return;
    setPhase('scanning');
    try {
      const { data, error } = await supabase.functions.invoke('olive-email-mcp', {
        body: { action: 'preview', user_id: user.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Scan failed');

      setItems(data.items || []);
      setEmailsScanned(data.emails_scanned || 0);
      setPhase('review');
    } catch (err: any) {
      console.error('Email scan failed:', err);
      toast.error(err.message || t('home:emailTriage.scanFailed', 'Failed to scan emails'));
      setPhase('idle');
    }
  }, [user?.id, t]);

  const handleConfirm = useCallback(async () => {
    if (!user?.id) return;
    const selectedItems = items.filter(i => i.selected && i.task_summary);
    if (selectedItems.length === 0) {
      toast.info(t('home:emailTriage.noItemsSelected', 'No items selected'));
      return;
    }

    setPhase('saving');
    try {
      const { data, error } = await supabase.functions.invoke('olive-email-mcp', {
        body: {
          action: 'confirm',
          user_id: user.id,
          couple_id: currentCouple?.id,
          items: selectedItems.map(i => ({
            email_id: i.email_id,
            subject: i.subject,
            from: i.from,
            task_summary: i.task_summary,
            due_date: i.due_date,
            priority: i.priority,
            category: i.category,
          })),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Save failed');

      toast.success(
        t('home:emailTriage.tasksCreated', {
          count: data.tasks_created,
          defaultValue: `Created ${data.tasks_created} task(s) from email`,
        })
      );
      refetch();
      onOpenChange(false);
      setPhase('idle');
      setItems([]);
    } catch (err: any) {
      console.error('Confirm failed:', err);
      toast.error(err.message || t('home:emailTriage.saveFailed', 'Failed to save tasks'));
      setPhase('review');
    }
  }, [user?.id, currentCouple?.id, items, refetch, onOpenChange, t]);

  const toggleItem = (emailId: string) => {
    setItems(prev => prev.map(i => i.email_id === emailId ? { ...i, selected: !i.selected } : i));
  };

  const actionItems = items.filter(i => i.classification === 'ACTION_REQUIRED');
  const otherItems = items.filter(i => i.classification !== 'ACTION_REQUIRED');
  const selectedCount = items.filter(i => i.selected).length;

  // Start scanning when dialog opens
  const handleOpenChange = (open: boolean) => {
    if (open && phase === 'idle') {
      handleScan();
    }
    if (!open) {
      setPhase('idle');
      setItems([]);
    }
    onOpenChange(open);
  };

  const content = (
    <div className="space-y-4">
      {phase === 'scanning' && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('home:emailTriage.scanning', 'Scanning your inbox...')}</p>
          <p className="text-xs text-muted-foreground">{t('home:emailTriage.scanningHint', 'Only primary, unread emails are checked')}</p>
        </div>
      )}

      {phase === 'review' && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <CheckCircle2 className="h-8 w-8 text-[hsl(var(--success))]" />
          <p className="text-sm font-medium">{t('home:emailTriage.allClear', 'No new emails to review!')}</p>
          <p className="text-xs text-muted-foreground">{t('home:emailTriage.allClearHint', 'Your inbox is all caught up.')}</p>
        </div>
      )}

      {phase === 'review' && items.length > 0 && (
        <>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground">
              {t('home:emailTriage.scanned', { count: emailsScanned, defaultValue: `Scanned ${emailsScanned} emails` })}
            </p>
            <Badge variant="outline" className="text-xs">
              {selectedCount} {t('home:emailTriage.selected', 'selected')}
            </Badge>
          </div>

          <ScrollArea className="max-h-[50vh]">
            {/* Action Required items */}
            {actionItems.length > 0 && (
              <div className="space-y-1 mb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary px-1 mb-2">
                  {t('home:emailTriage.actionRequired', 'Action Required')}
                </p>
                {actionItems.map(item => (
                  <TriageItemRow key={item.email_id} item={item} onToggle={toggleItem} />
                ))}
              </div>
            )}

            {/* Informational / Skip items */}
            {otherItems.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
                  {t('home:emailTriage.informational', 'No Action Needed')}
                </p>
                {otherItems.map(item => (
                  <TriageItemRow key={item.email_id} item={item} onToggle={toggleItem} />
                ))}
              </div>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );

  const footer = phase === 'review' && items.length > 0 ? (
    <div className="flex gap-2 w-full">
      <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1">
        {t('common:buttons.cancel', 'Cancel')}
      </Button>
      <Button
        onClick={handleConfirm}
        disabled={selectedCount === 0}
        className="flex-1 gap-2"
      >
        {phase !== 'review' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        {t('home:emailTriage.createTasks', {
          count: selectedCount,
          defaultValue: `Create ${selectedCount} task(s)`,
        })}
      </Button>
    </div>
  ) : null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-red-600" />
              {t('home:emailTriage.title', 'Email Review')}
            </DrawerTitle>
            <DrawerDescription>
              {t('home:emailTriage.description', 'Review actionable emails and create tasks')}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2">{content}</div>
          {footer && <DrawerFooter>{footer}</DrawerFooter>}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-red-600" />
            {t('home:emailTriage.title', 'Email Review')}
          </DialogTitle>
          <DialogDescription>
            {t('home:emailTriage.description', 'Review actionable emails and create tasks')}
          </DialogDescription>
        </DialogHeader>
        {content}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

function TriageItemRow({ item, onToggle }: { item: TriageItem; onToggle: (id: string) => void }) {
  const isAction = item.classification === 'ACTION_REQUIRED';
  const priorityColors: Record<string, string> = {
    high: 'bg-[hsl(var(--priority-high))]/10 text-[hsl(var(--priority-high))]',
    medium: 'bg-[hsl(var(--priority-medium))]/10 text-[hsl(var(--priority-medium))]',
    low: 'bg-muted text-muted-foreground',
  };

  return (
    <button
      onClick={() => onToggle(item.email_id)}
      className={cn(
        "flex items-start gap-3 w-full p-3 rounded-xl text-left transition-colors",
        item.selected ? "bg-primary/5 border border-primary/20" : "hover:bg-accent/50"
      )}
    >
      <Checkbox
        checked={item.selected}
        className="mt-0.5"
        onCheckedChange={() => onToggle(item.email_id)}
      />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium text-foreground truncate">{item.subject}</p>
        <p className="text-xs text-muted-foreground truncate">{item.from}</p>
        {isAction && item.task_summary && (
          <p className="text-xs text-primary font-medium">→ {item.task_summary}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {item.priority && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", priorityColors[item.priority] || '')}>
              {item.priority}
            </span>
          )}
          {item.due_date && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Calendar className="h-2.5 w-2.5" /> {item.due_date}
            </span>
          )}
          {item.category && (
            <span className="text-[10px] text-muted-foreground">{item.category}</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default EmailTriageReviewDialog;
