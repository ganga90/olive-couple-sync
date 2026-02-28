/**
 * AgentInsightsSection — shows recent agent results on MyDay dashboard.
 *
 * Displays the latest meaningful insights from background agents
 * (last 24h, deduplicated per agent, trivial results filtered out).
 * Enhanced with structured data badges per agent type.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentInsights, AgentRun } from '@/hooks/useBackgroundAgents';
import { agentIconsSmall, agentColors, getAgentDisplayName } from '@/constants/agentConfig';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Zap, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/providers/LanguageProvider';

/** Renders structured data badges based on agent type */
function AgentDataBadges({ agentId, data }: { agentId: string; data?: Record<string, unknown> }) {
  if (!data) return null;

  const badges: { label: string; color: string }[] = [];

  switch (agentId) {
    case 'email-triage-agent': {
      const processed = data.emails_processed as number | undefined;
      const created = data.tasks_created as number | undefined;
      if (typeof processed === 'number') badges.push({ label: `${processed} scanned`, color: 'bg-blue-100 text-blue-700' });
      if (typeof created === 'number') badges.push({ label: `${created} action items`, color: created > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700' });
      break;
    }
    case 'smart-bill-reminder': {
      const overdue = data.overdue as number | undefined;
      const dueToday = data.dueToday as number | undefined;
      const dueSoon = data.dueSoon as number | undefined;
      if (typeof overdue === 'number' && overdue > 0) badges.push({ label: `${overdue} overdue`, color: 'bg-red-100 text-red-700' });
      if (typeof dueToday === 'number' && dueToday > 0) badges.push({ label: `${dueToday} due today`, color: 'bg-amber-100 text-amber-700' });
      if (typeof dueSoon === 'number' && dueSoon > 0) badges.push({ label: `${dueSoon} upcoming`, color: 'bg-green-100 text-green-700' });
      break;
    }
    case 'stale-task-strategist': {
      const analyzed = data.tasksAnalyzed as number | undefined;
      if (typeof analyzed === 'number') badges.push({ label: `${analyzed} tasks reviewed`, color: 'bg-blue-100 text-blue-700' });
      break;
    }
    case 'energy-task-suggester': {
      const readiness = data.readiness as number | undefined;
      const taskCount = data.taskCount as number | undefined;
      if (typeof readiness === 'number') {
        const color = readiness >= 85 ? 'bg-green-100 text-green-700' : readiness >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
        badges.push({ label: `Readiness ${readiness}`, color });
      }
      if (typeof taskCount === 'number') badges.push({ label: `${taskCount} tasks`, color: 'bg-stone-100 text-stone-700' });
      break;
    }
    case 'weekly-couple-sync': {
      const completed = data.completedTotal as number | undefined;
      const pending = data.pendingTotal as number | undefined;
      if (typeof completed === 'number') badges.push({ label: `${completed} completed`, color: 'bg-green-100 text-green-700' });
      if (typeof pending === 'number') badges.push({ label: `${pending} pending`, color: 'bg-amber-100 text-amber-700' });
      break;
    }
    case 'birthday-gift-agent': {
      const events = data.events as Array<{ daysUntil: number }> | undefined;
      if (events && events.length > 0) {
        const soonest = Math.min(...events.map(e => e.daysUntil));
        badges.push({ label: `${soonest}d away`, color: soonest <= 7 ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700' });
      }
      break;
    }
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {badges.map((badge, i) => (
        <span key={i} className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', badge.color)}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function InsightCard({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();
  const message = run.result?.message || '';
  const isLong = message.length > 150;
  const iconColorClass = agentColors[run.agent_id] || 'text-stone-600 bg-stone-100';

  return (
    <div
      className="p-3 rounded-xl bg-accent/30 space-y-1.5 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => navigate(getLocalizedPath(`/agents/${run.agent_id}`))}
    >
      <div className="flex items-center gap-2">
        <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0', iconColorClass)}>
          {agentIconsSmall[run.agent_id] || <Zap className="h-3 w-3" />}
        </div>
        <span className="text-xs font-medium text-foreground truncate">
          {getAgentDisplayName(run.agent_id)}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
          {run.completed_at && formatDistanceToNow(new Date(run.completed_at), { addSuffix: true })}
        </span>
      </div>
      <AgentDataBadges agentId={run.agent_id} data={run.result?.data as Record<string, unknown> | undefined} />
      <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {isLong && !expanded ? message.substring(0, 150) + '...' : message}
      </p>
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex items-center gap-0.5 text-[10px] text-primary"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

export function AgentInsightsSection() {
  const { t } = useTranslation(['profile']);
  const { insights, isLoading } = useAgentInsights();
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();

  // Don't render if loading or no insights
  if (isLoading || insights.length === 0) return null;

  return (
    <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '35ms' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-foreground">
            {t('profile:myday.agentInsights', 'Agent Insights')}
          </h3>
        </div>
        <button
          onClick={() => navigate(getLocalizedPath('/profile'), { state: { scrollTo: 'agents' } })}
          className="text-[10px] text-primary"
        >
          {t('profile:myday.manageAgents', 'Manage')}
        </button>
      </div>

      <div className="space-y-2">
        {insights.slice(0, 3).map((run) => (
          <InsightCard key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}

export default AgentInsightsSection;
