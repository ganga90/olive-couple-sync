import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useBackgroundAgents, AgentWithStatus, AgentRun } from '@/hooks/useBackgroundAgents';
import { agentIcons, agentColors } from '@/constants/agentConfig';
import { useLanguage } from '@/providers/LanguageProvider';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Link2,
  ChevronDown,
  ChevronUp,
  History,
  MessageCircle,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

function AgentStatusBadge({ agent }: { agent: AgentWithStatus }) {
  if (!agent.isEnabled) return null;

  if (agent.lastRun?.status === 'running') {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-200 bg-amber-50">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </Badge>
    );
  }

  if (agent.lastRun?.status === 'failed') {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-red-600 border-red-200 bg-red-50">
        <XCircle className="h-3 w-3" />
        Error
      </Badge>
    );
  }

  if (agent.lastRun?.status === 'completed') {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-200 bg-emerald-50">
        <CheckCircle2 className="h-3 w-3" />
        Active
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs gap-1 text-stone-500 border-stone-200">
      <Clock className="h-3 w-3" />
      Waiting
    </Badge>
  );
}

function RunHistoryModal({
  agentName,
  runs,
  isLoading,
  onClose,
}: {
  agentName: string;
  runs: AgentRun[];
  isLoading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('profile');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] overflow-hidden shadow-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-sm">{t('agents.runHistory', 'Run History')} — {agentName}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent/50 min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3 max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t('agents.noHistory', 'No runs yet')}
            </p>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="border rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      run.status === 'completed' && 'text-emerald-600 border-emerald-200 bg-emerald-50',
                      run.status === 'failed' && 'text-red-600 border-red-200 bg-red-50',
                      run.status === 'running' && 'text-amber-600 border-amber-200 bg-amber-50'
                    )}
                  >
                    {run.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {run.completed_at
                      ? formatDistanceToNow(new Date(run.completed_at), { addSuffix: true })
                      : formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                  </span>
                </div>
                {run.result?.message && (
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                    {run.result.message.length > 500
                      ? run.result.message.substring(0, 500) + '...'
                      : run.result.message}
                  </p>
                )}
                {run.error_message && (
                  <p className="text-xs text-red-600">{run.error_message.substring(0, 200)}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onToggle,
  onRunNow,
  onWhatsAppToggle,
  onViewHistory,
  onNavigateDetail,
  isToggling,
}: {
  agent: AgentWithStatus;
  onToggle: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  onWhatsAppToggle: (id: string, enabled: boolean) => void;
  onViewHistory: (id: string) => void;
  onNavigateDetail: (id: string) => void;
  isToggling: boolean;
}) {
  const { t } = useTranslation('profile');
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<AgentRun | null>(null);
  const [showResult, setShowResult] = useState(false);
  const needsConnection = agent.requires_connection && agent.connectionStatus === 'disconnected';
  const iconColorClass = agentColors[agent.skill_id] || 'text-stone-600 bg-stone-100';
  const whatsAppEnabled = (agent.userConfig?.whatsapp_notify as boolean) !== false;

  const handleRunNow = async () => {
    setIsRunning(true);
    setRunResult(null);
    try {
      const result = await (onRunNow as (id: string) => Promise<AgentRun | null>)(agent.skill_id);
      if (result) {
        setRunResult(result);
        setShowResult(true);
        toast.success(t('agents.runCompleted', 'Agent completed'));
      } else {
        toast.success(t('agents.runStarted', 'Agent started'));
      }
    } catch {
      toast.error(t('agents.runFailed', 'Failed to start agent'));
    } finally {
      setIsRunning(false);
    }
  };

  // Latest result to show (inline Run Now result OR last run)
  const latestResultMessage = runResult?.result?.message || agent.lastRun?.result?.message;
  const hasResult = !!latestResultMessage;

  return (
    <Card className={cn('overflow-hidden transition-all duration-200', !agent.isEnabled && 'opacity-70')}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', iconColorClass)}>
            {agentIcons[agent.skill_id] || <Zap className="h-5 w-5" />}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <button onClick={() => onNavigateDetail(agent.skill_id)} className="font-medium text-sm truncate text-left hover:text-primary transition-colors">
                {agent.name}
              </button>
              <AgentStatusBadge agent={agent} />
            </div>

            {agent.description && (
              <p className="text-xs text-muted-foreground mb-2">{agent.description}</p>
            )}

            {/* Schedule + last run info */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {agent.schedule && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t(`agents.schedules.${agent.schedule}`, agent.schedule.replace(/_/g, ' '))}
                </span>
              )}

              {agent.isEnabled && agent.lastRun?.completed_at && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('agents.lastRun', 'Last run')}: {formatDistanceToNow(new Date(agent.lastRun.completed_at), { addSuffix: true })}
                </span>
              )}
            </div>

            {/* Latest result preview (collapsible) */}
            {agent.isEnabled && hasResult && (
              <div className="mt-2">
                <button
                  onClick={() => setShowResult(!showResult)}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                >
                  {showResult ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {t('agents.latestResult', 'Latest result')}
                </button>
                {showResult && (
                  <div className="mt-1.5 p-2.5 rounded-lg bg-accent/30 text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                    {latestResultMessage!.length > 600
                      ? latestResultMessage!.substring(0, 600) + '...'
                      : latestResultMessage}
                  </div>
                )}
              </div>
            )}

            {/* Connection requirement — clickable link to integrations */}
            {needsConnection && (
              <button
                onClick={() => {
                  const emailCard = document.querySelector('[data-integration="email"]');
                  const ouraCard = document.querySelector('[data-integration="oura"]');
                  const target = agent.requires_connection === 'gmail' ? emailCard : ouraCard;
                  if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
                className="flex items-center gap-1.5 mt-2 text-xs text-amber-600 hover:text-amber-700 hover:underline cursor-pointer"
              >
                <Link2 className="h-3 w-3" />
                {t('agents.requiresConnection', 'Requires {{connection}} connection', {
                  connection: agent.requires_connection,
                })}
                <span className="text-[10px]">&rarr;</span>
              </button>
            )}

            {/* Error message */}
            {agent.lastRun?.status === 'failed' && agent.lastRun.error_message && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-red-600">
                <AlertCircle className="h-3 w-3" />
                {agent.lastRun.error_message.substring(0, 100)}
              </div>
            )}

            {/* Action buttons row */}
            {agent.isEnabled && !needsConnection && (
              <div className="flex items-center gap-2 mt-2">
                {/* Run Now button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={handleRunNow}
                  disabled={isRunning}
                >
                  {isRunning ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3 mr-1" />
                  )}
                  {t('agents.runNow', 'Run Now')}
                </Button>

                {/* View history button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => onViewHistory(agent.skill_id)}
                >
                  <History className="h-3 w-3 mr-1" />
                  {t('agents.viewHistory', 'History')}
                </Button>

                {/* WhatsApp notification toggle */}
                <div className="flex items-center gap-1.5 ml-auto">
                  <MessageCircle className={cn('h-3 w-3', whatsAppEnabled ? 'text-green-600' : 'text-muted-foreground')} />
                  <span className="text-[10px] text-muted-foreground">{t('agents.whatsappNotify', 'WhatsApp')}</span>
                  <Switch
                    checked={whatsAppEnabled}
                    onCheckedChange={(checked) => onWhatsAppToggle(agent.skill_id, checked)}
                    className="scale-75"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Toggle */}
          <div className="flex-shrink-0 pt-1">
            {isToggling ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Switch
                checked={agent.isEnabled}
                onCheckedChange={(checked) => onToggle(agent.skill_id, checked)}
                disabled={needsConnection}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function BackgroundAgentsManager() {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();
  const {
    agents,
    isLoading,
    togglingAgent,
    activeCount,
    totalCount,
    toggleAgent,
    updateAgentWhatsAppNotify,
    fetchAgentHistory,
    runAgentNow,
  } = useBackgroundAgents();

  const [historyModal, setHistoryModal] = useState<{ agentId: string; name: string } | null>(null);
  const [historyRuns, setHistoryRuns] = useState<AgentRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const handleToggle = async (skillId: string, enabled: boolean) => {
    try {
      await toggleAgent(skillId, enabled);
      toast.success(enabled ? t('agents.activated', 'Agent activated') : t('agents.deactivated', 'Agent deactivated'));
    } catch {
      toast.error(t('agents.toggleError', 'Failed to update agent'));
    }
  };

  const handleWhatsAppToggle = async (skillId: string, enabled: boolean) => {
    try {
      await updateAgentWhatsAppNotify(skillId, enabled);
      toast.success(enabled
        ? t('agents.whatsappEnabled', 'WhatsApp notifications enabled')
        : t('agents.whatsappDisabled', 'WhatsApp notifications disabled')
      );
    } catch {
      toast.error(t('agents.toggleError', 'Failed to update agent'));
    }
  };

  const handleViewHistory = async (agentId: string) => {
    const agent = agents.find((a) => a.skill_id === agentId);
    setHistoryModal({ agentId, name: agent?.name || agentId });
    setHistoryLoading(true);
    try {
      const runs = await fetchAgentHistory(agentId, 10);
      setHistoryRuns(runs);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        {t('agents.signInRequired', 'Sign in to manage background agents')}
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('agents.subtitle', 'Agents that work for you automatically in the background.')}
      </p>

      <div className="grid gap-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.skill_id}
            agent={agent}
            onToggle={handleToggle}
            onRunNow={runAgentNow as any}
            onWhatsAppToggle={handleWhatsAppToggle}
            onViewHistory={handleViewHistory}
            onNavigateDetail={(id) => navigate(getLocalizedPath(`/agents/${id}`))}
            isToggling={togglingAgent === agent.skill_id}
          />
        ))}
      </div>

      <div className="pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          {t('agents.activeCount', '{{count}} of {{total}} agents active', {
            count: activeCount,
            total: totalCount,
          })}
        </p>
      </div>

      {/* Run History Modal */}
      {historyModal && (
        <RunHistoryModal
          agentName={historyModal.name}
          runs={historyRuns}
          isLoading={historyLoading}
          onClose={() => setHistoryModal(null)}
        />
      )}
    </div>
  );
}

export default BackgroundAgentsManager;
