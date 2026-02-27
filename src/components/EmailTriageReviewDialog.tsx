/**
 * Email Triage Review Dialog
 *
 * When user clicks "Review my Email":
 * - If periodic triage is NOT activated → shows a CTA to activate in Settings
 * - If activated → shows last triage results + "Scan Now" button
 * - "Scan Now" fires the scan in the background, closes dialog, and shows toast on completion
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Mail, Calendar, CheckCircle2, Settings, Sparkles, Clock, ListTodo, Play,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

/* ─── Types ─────────────────────────────────────────────────────── */

interface LastRunResult {
  status: string;
  result: { message?: string; data?: { tasks_created?: number; emails_processed?: number } } | null;
  completed_at: string | null;
}

interface RecentTask {
  id: string;
  summary: string;
  category: string;
  priority: string | null;
  due_date: string | null;
  created_at: string;
}

interface EmailTriageReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ─── Component ─────────────────────────────────────────────────── */

export function EmailTriageReviewDialog({ open, onOpenChange }: EmailTriageReviewDialogProps) {
  const { t } = useTranslation(['home', 'common', 'profile']);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getLocalizedPath } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [frequency, setFrequency] = useState<string>('manual');
  const [lastRun, setLastRun] = useState<LastRunResult | null>(null);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const [scanning, setScanning] = useState(false);

  // Ref to track background scan so it persists across dialog open/close
  const scanAbortRef = useRef<AbortController | null>(null);

  // ─── Load status from DB (fast, no edge function for prefs) ────
  useEffect(() => {
    if (!open || !user?.id) return;
    setLoading(true);

    const load = async () => {
      try {
        const [connRes, runRes, tasksRes] = await Promise.all([
          supabase
            .from('olive_email_connections')
            .select('triage_frequency')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .maybeSingle(),
          supabase
            .from('olive_agent_runs')
            .select('status, result, completed_at')
            .eq('agent_id', 'email-triage-agent')
            .eq('user_id', user.id)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('clerk_notes')
            .select('id, summary, category, priority, due_date, created_at')
            .eq('author_id', user.id)
            .eq('source', 'email')
            .eq('completed', false)
            .order('created_at', { ascending: false })
            .limit(10),
        ]);

        setFrequency(connRes.data?.triage_frequency || 'manual');
        if (runRes.data) setLastRun(runRes.data as LastRunResult);
        setRecentTasks(tasksRes.data || []);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [open, user?.id]);

  const isActivated = frequency !== 'manual';

  const goToSettings = () => {
    onOpenChange(false);
    navigate(getLocalizedPath('/profile'), { state: { scrollTo: 'intelligence' } });
  };

  // ─── Background Scan ──────────────────────────────────────────
  const handleScanNow = async () => {
    if (!user?.id || scanning) return;

    setScanning(true);
    onOpenChange(false); // Close dialog immediately

    toast.info(t('home:emailTriage.scanStarted', 'Olive is scanning your inbox in the background…'), {
      duration: 4000,
      icon: <Mail className="h-4 w-4" />,
    });

    try {
      const { data, error } = await supabase.functions.invoke('olive-email-mcp', {
        body: { action: 'triage', user_id: user.id },
      });

      if (error) throw error;

      const tasksCreated = data?.tasks_created ?? data?.data?.tasks_created ?? 0;
      const emailsProcessed = data?.emails_processed ?? data?.data?.emails_processed ?? 0;

      if (tasksCreated > 0) {
        toast.success(
          t('home:emailTriage.scanComplete', 'Email scan complete: {{tasks}} tasks from {{emails}} emails', {
            tasks: tasksCreated,
            emails: emailsProcessed,
          }),
          { duration: 6000, icon: <CheckCircle2 className="h-4 w-4" /> }
        );
      } else {
        toast.success(
          t('home:emailTriage.scanNoTasks', 'Inbox scanned — no new actionable items found.'),
          { duration: 5000, icon: <CheckCircle2 className="h-4 w-4" /> }
        );
      }
    } catch (err) {
      console.error('Email triage scan error:', err);
      toast.error(t('home:emailTriage.scanError', 'Email scan failed. Please try again later.'));
    } finally {
      setScanning(false);
    }
  };

  const frequencyLabels: Record<string, string> = {
    '6h': t('profile:email.frequency6h', 'Every 6 hours'),
    '12h': t('profile:email.frequency12h', 'Every 12 hours'),
    '24h': t('profile:email.frequency24h', 'Every 24 hours'),
  };

  // ─── Content ──────────────────────────────────────────────────
  const content = (
    <div className="space-y-4">
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && !isActivated && (
        <ActivateCTA
          t={t}
          goToSettings={goToSettings}
        />
      )}

      {!loading && isActivated && (
        <ActiveStatus
          t={t}
          frequency={frequency}
          frequencyLabels={frequencyLabels}
          lastRun={lastRun}
          recentTasks={recentTasks}
          scanning={scanning}
          onScanNow={handleScanNow}
          onGoToSettings={goToSettings}
        />
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-red-600" />
              {t('home:emailTriage.title', 'Email Review')}
            </DrawerTitle>
            <DrawerDescription>
              {isActivated
                ? t('home:emailTriage.activeDescription', 'Your email monitoring status and recent tasks')
                : t('home:emailTriage.description', 'Review actionable emails and create tasks')}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">{content}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-red-600" />
            {t('home:emailTriage.title', 'Email Review')}
          </DialogTitle>
          <DialogDescription>
            {isActivated
              ? t('home:emailTriage.activeDescription', 'Your email monitoring status and recent tasks')
              : t('home:emailTriage.description', 'Review actionable emails and create tasks')}
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Sub-components ──────────────────────────────────────────── */

function ActivateCTA({ t, goToSettings }: { t: any; goToSettings: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-4 text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Mail className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2 max-w-[300px]">
        <h3 className="text-base font-semibold text-foreground">
          {t('home:emailTriage.activateTitle', 'Let Olive check your email')}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t('home:emailTriage.activateDescription', 'Activate automatic email scanning in settings. Olive will periodically check your inbox, identify actionable emails, and create tasks for you.')}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-[260px] mt-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span>{t('home:emailTriage.featureFrequency', 'Choose frequency: every 6, 12, or 24 hours')}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span>{t('home:emailTriage.featureLookback', 'Scan past 1, 3, or 5 days of email')}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ListTodo className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span>{t('home:emailTriage.featureTasks', 'Auto-creates tasks and notifies you')}</span>
        </div>
      </div>

      <Button onClick={goToSettings} className="mt-4 gap-2">
        <Settings className="h-4 w-4" />
        {t('home:emailTriage.goToSettings', 'Activate in Settings')}
      </Button>
    </div>
  );
}

function ActiveStatus({
  t, frequency, frequencyLabels, lastRun, recentTasks, scanning, onScanNow, onGoToSettings,
}: {
  t: any;
  frequency: string;
  frequencyLabels: Record<string, string>;
  lastRun: LastRunResult | null;
  recentTasks: RecentTask[];
  scanning: boolean;
  onScanNow: () => void;
  onGoToSettings: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t('home:emailTriage.activeTitle', 'Email monitoring active')}
          </p>
          <p className="text-xs text-muted-foreground">
            {frequencyLabels[frequency] || frequency}
            {lastRun?.completed_at && (
              <> · {t('home:emailTriage.lastChecked', 'Last checked')} {formatDistanceToNow(new Date(lastRun.completed_at), { addSuffix: true })}</>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onGoToSettings} className="h-8 px-2">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Scan Now button */}
      <Button
        onClick={onScanNow}
        disabled={scanning}
        className="w-full gap-2"
        variant="outline"
      >
        {scanning ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {scanning
          ? t('home:emailTriage.scanningNow', 'Scanning…')
          : t('home:emailTriage.scanNow', 'Scan Now')}
      </Button>

      {/* Last run result */}
      {lastRun?.result?.data && (
        <div className="flex items-center gap-4 text-center">
          <div className="flex-1 p-3 rounded-xl bg-muted/50">
            <p className="text-lg font-bold text-foreground">{lastRun.result.data.emails_processed || 0}</p>
            <p className="text-xs text-muted-foreground">{t('home:emailTriage.emailsScanned', 'Emails scanned')}</p>
          </div>
          <div className="flex-1 p-3 rounded-xl bg-muted/50">
            <p className="text-lg font-bold text-primary">{lastRun.result.data.tasks_created || 0}</p>
            <p className="text-xs text-muted-foreground">{t('home:emailTriage.tasksCreated', 'Tasks created')}</p>
          </div>
        </div>
      )}

      {/* Recent email tasks */}
      {recentTasks.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
            {t('home:emailTriage.recentEmailTasks', 'Recent email tasks')}
          </p>
          <ScrollArea className="max-h-[40vh]">
            <div className="space-y-1">
              {recentTasks.map(task => (
                <div key={task.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-accent/50 transition-colors">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm text-foreground truncate">{task.summary}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">{task.category}</Badge>
                      {task.priority && (
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                          task.priority === 'high' ? 'bg-destructive/10 text-destructive' :
                          task.priority === 'medium' ? 'bg-amber-500/10 text-amber-600' :
                          'bg-muted text-muted-foreground'
                        )}>
                          {task.priority}
                        </span>
                      )}
                      {task.due_date && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Calendar className="h-2.5 w-2.5" /> {new Date(task.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
          <CheckCircle2 className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {t('home:emailTriage.noEmailTasks', 'No email tasks yet. Olive will check your inbox soon.')}
          </p>
        </div>
      )}
    </div>
  );
}

export default EmailTriageReviewDialog;
