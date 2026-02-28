/**
 * Agent Detail Page
 * 
 * Full-screen view for a single background agent showing:
 * - Agent header with toggle and status
 * - Latest run result (full, untruncated)
 * - Structured action items from result data
 * - Run history timeline
 * - Settings (WhatsApp toggle, schedule)
 * - Run Now trigger
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useBackgroundAgents, AgentRun, AgentWithStatus } from '@/hooks/useBackgroundAgents';
import { agentIcons, agentColors } from '@/constants/agentConfig';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Play,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageCircle,
  Zap,
  History,
  Settings2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';

// ── Status badge ────────────────────────────────────────────────
function StatusBadge({ status }: { status?: string }) {
  switch (status) {
    case 'running':
      return (
        <Badge variant="outline" className="gap-1 text-amber-600 border-amber-200 bg-amber-50">
          <Loader2 className="h-3 w-3 animate-spin" /> Running
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="gap-1 text-red-600 border-red-200 bg-red-50">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    case 'completed':
      return (
        <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="h-3 w-3" /> Completed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" /> Waiting
        </Badge>
      );
  }
}

// ── Structured action items from result data ────────────────────
function ActionItems({ agentId, data }: { agentId: string; data?: Record<string, unknown> }) {
  if (!data) return null;

  // Stale task strategist: show individual task recommendations
  if (agentId === 'stale-task-strategist' && Array.isArray(data.tasks)) {
    const tasks = data.tasks as Array<{ id: string; summary: string; ageDays: number; priority: string }>;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-blue-500" />
            Tasks Analyzed ({data.tasksAnalyzed as number})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between p-2.5 rounded-lg bg-accent/30 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{task.summary}</p>
                <p className="text-xs text-muted-foreground">{task.ageDays} days old · {task.priority}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // Smart bill reminder: show bills grouped by urgency
  if (agentId === 'smart-bill-reminder' && Array.isArray(data.bills)) {
    const bills = data.bills as Array<{ summary: string; due_date: string; daysUntil: number; urgency: string }>;
    const urgencyColors: Record<string, string> = {
      overdue: 'bg-red-100 text-red-700 border-red-200',
      today: 'bg-amber-100 text-amber-700 border-amber-200',
      upcoming: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    };
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-emerald-500" />
            Bills ({bills.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {bills.map((bill, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-accent/30 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{bill.summary}</p>
                <p className="text-xs text-muted-foreground">
                  Due {format(new Date(bill.due_date), 'MMM d, yyyy')}
                </p>
              </div>
              <Badge variant="outline" className={cn('text-[10px] capitalize', urgencyColors[bill.urgency] || '')}>
                {bill.urgency}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // Birthday gift agent: show upcoming events
  if (agentId === 'birthday-gift-agent' && Array.isArray(data.events)) {
    const events = data.events as Array<{ name: string; date: string; daysUntil: number }>;
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-pink-500" />
            Upcoming Events
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.map((event, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-accent/30 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{event.name}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(event.date), 'MMM d, yyyy')}
                </p>
              </div>
              <Badge variant="outline" className={cn('text-[10px]', event.daysUntil <= 7 ? 'text-red-600 border-red-200 bg-red-50' : 'text-purple-600 border-purple-200 bg-purple-50')}>
                {event.daysUntil}d away
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return null;
}

// ── Run History Item ────────────────────────────────────────────
function RunHistoryItem({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const message = run.result?.message || '';
  const hasMessage = message.length > 0;

  return (
    <div className="border rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <StatusBadge status={run.status} />
        <span className="text-[11px] text-muted-foreground">
          {run.completed_at
            ? format(new Date(run.completed_at), 'MMM d, h:mm a')
            : format(new Date(run.started_at), 'MMM d, h:mm a')}
        </span>
      </div>
      {hasMessage && (
        <>
          <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
            {expanded ? message : message.substring(0, 200)}
            {!expanded && message.length > 200 && '...'}
          </p>
          {message.length > 200 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-0.5 text-[10px] text-primary"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Less' : 'Show full result'}
            </button>
          )}
        </>
      )}
      {run.error_message && (
        <p className="text-xs text-red-600">{run.error_message}</p>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────
export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const { getLocalizedPath } = useLanguage();

  const {
    agents,
    isLoading: agentsLoading,
    togglingAgent,
    toggleAgent,
    updateAgentWhatsAppNotify,
    fetchAgentHistory,
    runAgentNow,
    refreshAgents,
  } = useBackgroundAgents();

  const [history, setHistory] = useState<AgentRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [latestRunResult, setLatestRunResult] = useState<AgentRun | null>(null);

  const agent = agents.find((a) => a.skill_id === agentId);

  // Load run history
  const loadHistory = useCallback(async () => {
    if (!agentId || !user?.id) return;
    setHistoryLoading(true);
    try {
      const runs = await fetchAgentHistory(agentId, 20);
      setHistory(runs);
    } finally {
      setHistoryLoading(false);
    }
  }, [agentId, user?.id, fetchAgentHistory]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Derive latest run (from manual trigger or history)
  const latestRun = latestRunResult || agent?.lastRun || history[0] || null;

  const handleToggle = async (enabled: boolean) => {
    if (!agentId) return;
    try {
      await toggleAgent(agentId, enabled);
      toast.success(enabled ? t('agents.activated') : t('agents.deactivated'));
    } catch {
      toast.error(t('agents.toggleError'));
    }
  };

  const handleWhatsAppToggle = async (enabled: boolean) => {
    if (!agentId) return;
    try {
      await updateAgentWhatsAppNotify(agentId, enabled);
      toast.success(enabled ? t('agents.whatsappEnabled') : t('agents.whatsappDisabled'));
    } catch {
      toast.error(t('agents.toggleError'));
    }
  };

  const handleRunNow = async () => {
    if (!agentId) return;
    setIsRunning(true);
    try {
      const result = await runAgentNow(agentId);
      if (result) {
        setLatestRunResult(result);
        toast.success(t('agents.runCompleted'));
        // Refresh history
        loadHistory();
      } else {
        toast.success(t('agents.runStarted'));
      }
    } catch {
      toast.error(t('agents.runFailed'));
    } finally {
      setIsRunning(false);
    }
  };

  // Loading state
  if (agentsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Agent not found
  if (!agent) {
    return (
      <div className="p-6 text-center space-y-4">
        <p className="text-muted-foreground">{t('agentDetail.notFound', 'Agent not found')}</p>
        <Button variant="outline" onClick={() => navigate(getLocalizedPath('/profile'))}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('agentDetail.backToSettings', 'Back to Settings')}
        </Button>
      </div>
    );
  }

  const iconColorClass = agentColors[agent.skill_id] || 'text-stone-600 bg-stone-100';
  const whatsAppEnabled = (agent.userConfig?.whatsapp_notify as boolean) !== false;

  return (
    <div className="pb-28 md:pb-8 max-w-2xl mx-auto px-4 pt-4 space-y-5 animate-fade-up">
      {/* Back nav */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('agentDetail.back', 'Back')}
      </button>

      {/* ── Header Card ──────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0', iconColorClass)}>
              {agentIcons[agent.skill_id] || <Zap className="h-6 w-6" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-lg font-semibold truncate">{agent.name}</h1>
                <StatusBadge status={agent.isEnabled ? agent.lastRun?.status : undefined} />
              </div>
              {agent.description && (
                <p className="text-sm text-muted-foreground mb-3">{agent.description}</p>
              )}
              {agent.schedule && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t(`agents.schedules.${agent.schedule}`, agent.schedule.replace(/_/g, ' '))}
                </div>
              )}
            </div>
            <div className="flex-shrink-0 pt-1">
              {togglingAgent === agent.skill_id ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Switch checked={agent.isEnabled} onCheckedChange={handleToggle} />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Actions Bar ──────────────────────────────────────── */}
      {agent.isEnabled && (
        <div className="flex items-center gap-3">
          <Button
            onClick={handleRunNow}
            disabled={isRunning}
            className="flex-1"
            size="sm"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {t('agents.runNow')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refreshAgents(); loadHistory(); }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Latest Result (Full) ─────────────────────────────── */}
      {latestRun && latestRun.result?.message && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                {t('agentDetail.latestResult', 'Latest Result')}
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">
                {latestRun.completed_at && formatDistanceToNow(new Date(latestRun.completed_at), { addSuffix: true })}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="p-3 rounded-xl bg-accent/30 text-sm text-foreground whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
              {latestRun.result.message}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Structured Action Items ──────────────────────────── */}
      {latestRun && (
        <ActionItems
          agentId={agent.skill_id}
          data={latestRun.result?.data as Record<string, unknown> | undefined}
        />
      )}

      {/* ── Settings Card ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            {t('agentDetail.settings', 'Settings')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* WhatsApp notifications */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageCircle className={cn('h-5 w-5', whatsAppEnabled ? 'text-green-600' : 'text-muted-foreground')} />
              <div>
                <p className="text-sm font-medium">{t('agentDetail.whatsappNotifications', 'WhatsApp Notifications')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('agentDetail.whatsappDesc', 'Send results via WhatsApp when this agent runs')}
                </p>
              </div>
            </div>
            <Switch
              checked={whatsAppEnabled}
              onCheckedChange={handleWhatsAppToggle}
            />
          </div>

          <Separator />

          {/* Schedule info */}
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{t('agentDetail.schedule', 'Schedule')}</p>
              <p className="text-xs text-muted-foreground">
                {agent.schedule
                  ? t(`agents.schedules.${agent.schedule}`, agent.schedule.replace(/_/g, ' '))
                  : t('agentDetail.noSchedule', 'No schedule configured')}
              </p>
            </div>
          </div>

          {/* Connection requirement */}
          {agent.requires_connection && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{t('agentDetail.connection', 'Required Connection')}</p>
                    <p className="text-xs text-muted-foreground capitalize">{agent.requires_connection}</p>
                  </div>
                </div>
                <Badge variant="outline" className={cn(
                  'text-xs',
                  agent.connectionStatus === 'connected'
                    ? 'text-emerald-600 border-emerald-200 bg-emerald-50'
                    : 'text-amber-600 border-amber-200 bg-amber-50'
                )}>
                  {agent.connectionStatus === 'connected' ? 'Connected' : 'Not connected'}
                </Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Run History ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('agentDetail.runHistory', 'Run History')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t('agents.noHistory')}
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((run) => (
                <RunHistoryItem key={run.id} run={run} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
