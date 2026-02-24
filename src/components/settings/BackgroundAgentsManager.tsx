import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useBackgroundAgents, AgentWithStatus } from '@/hooks/useBackgroundAgents';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  ClipboardList,
  DollarSign,
  Zap,
  Moon,
  Gift,
  Users,
  Mail,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const agentIcons: Record<string, React.ReactNode> = {
  'stale-task-strategist': <ClipboardList className="h-5 w-5" />,
  'smart-bill-reminder': <DollarSign className="h-5 w-5" />,
  'energy-task-suggester': <Zap className="h-5 w-5" />,
  'sleep-optimization-coach': <Moon className="h-5 w-5" />,
  'birthday-gift-agent': <Gift className="h-5 w-5" />,
  'weekly-couple-sync': <Users className="h-5 w-5" />,
  'email-triage-agent': <Mail className="h-5 w-5" />,
};

const agentColors: Record<string, string> = {
  'stale-task-strategist': 'text-blue-600 bg-blue-500/10',
  'smart-bill-reminder': 'text-emerald-600 bg-emerald-500/10',
  'energy-task-suggester': 'text-amber-600 bg-amber-500/10',
  'sleep-optimization-coach': 'text-indigo-600 bg-indigo-500/10',
  'birthday-gift-agent': 'text-pink-600 bg-pink-500/10',
  'weekly-couple-sync': 'text-purple-600 bg-purple-500/10',
  'email-triage-agent': 'text-red-600 bg-red-500/10',
};

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

function AgentCard({
  agent,
  onToggle,
  onRunNow,
  isToggling,
}: {
  agent: AgentWithStatus;
  onToggle: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  isToggling: boolean;
}) {
  const { t } = useTranslation('profile');
  const [isRunning, setIsRunning] = useState(false);
  const needsConnection = agent.requires_connection && agent.connectionStatus === 'disconnected';
  const iconColorClass = agentColors[agent.skill_id] || 'text-stone-600 bg-stone-100';

  const handleRunNow = async () => {
    setIsRunning(true);
    try {
      await onRunNow(agent.skill_id);
      toast.success(t('agents.runStarted', 'Agent started'));
    } catch {
      toast.error(t('agents.runFailed', 'Failed to start agent'));
    } finally {
      setIsRunning(false);
    }
  };

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
              <h4 className="font-medium text-sm truncate">{agent.name}</h4>
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

            {/* Connection requirement — clickable link to integrations */}
            {needsConnection && (
              <button
                onClick={() => {
                  // Scroll to the integrations section where connection cards live
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
                <span className="text-[10px]">→</span>
              </button>
            )}

            {/* Error message */}
            {agent.lastRun?.status === 'failed' && agent.lastRun.error_message && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-red-600">
                <AlertCircle className="h-3 w-3" />
                {agent.lastRun.error_message.substring(0, 100)}
              </div>
            )}

            {/* Run Now button (only when enabled) */}
            {agent.isEnabled && !needsConnection && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 text-xs px-2"
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
  const {
    agents,
    isLoading,
    togglingAgent,
    activeCount,
    totalCount,
    toggleAgent,
    runAgentNow,
  } = useBackgroundAgents();

  const handleToggle = async (skillId: string, enabled: boolean) => {
    try {
      await toggleAgent(skillId, enabled);
      toast.success(enabled ? t('agents.activated', 'Agent activated') : t('agents.deactivated', 'Agent deactivated'));
    } catch {
      toast.error(t('agents.toggleError', 'Failed to update agent'));
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
            onRunNow={runAgentNow}
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
    </div>
  );
}

export default BackgroundAgentsManager;
