/**
 * AgentInsightsSection — shows recent agent results on MyDay dashboard.
 *
 * Displays the latest meaningful insights from background agents
 * (last 24h, deduplicated per agent, trivial results filtered out).
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

function InsightCard({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const message = run.result?.message || '';
  const isLong = message.length > 150;
  const iconColorClass = agentColors[run.agent_id] || 'text-stone-600 bg-stone-100';

  return (
    <div className="p-3 rounded-xl bg-accent/30 space-y-1.5">
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
      <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {isLong && !expanded ? message.substring(0, 150) + '...' : message}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
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
