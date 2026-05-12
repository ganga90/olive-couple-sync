/**
 * AgentInsightsSection — shows recent agent results on MyDay dashboard.
 *
 * Displays the latest meaningful insights from background agents
 * (last 24h, deduplicated per agent, trivial results filtered out).
 *
 * Visual rules:
 *   - Surface stays in the Olive "paper + leaf" register — calm white
 *     card with a soft hairline border, never a tinted body.
 *   - Each insight is anchored by a larger, agent-tinted squircle icon
 *     so users can scan by agent at a glance.
 *   - Bullet-listed messages render as a real visual list with a leaf
 *     bullet, instead of whitespace-pre-wrap raw text.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentInsights, AgentRun } from '@/hooks/useBackgroundAgents';
import { agentIcons, agentColors, getAgentDisplayName } from '@/constants/agentConfig';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Zap, ChevronDown, Bot, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/providers/LanguageProvider';

/** Renders structured data badges based on agent type. Low-saturation
 *  tints on stone-tinted chips so the surface stays calm; semantic
 *  colors (red / amber / emerald) are reserved for real status signals. */
function AgentDataBadges({ agentId, data }: { agentId: string; data?: Record<string, unknown> }) {
  if (!data) return null;

  const badges: { label: string; color: string }[] = [];

  switch (agentId) {
    case 'email-triage-agent': {
      const processed = data.emails_processed as number | undefined;
      const created = data.tasks_created as number | undefined;
      if (typeof processed === 'number') badges.push({ label: `${processed} scanned`, color: 'bg-stone-100 text-stone-700' });
      if (typeof created === 'number') badges.push({ label: `${created} action items`, color: created > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700' });
      break;
    }
    case 'smart-bill-reminder': {
      const overdue = data.overdue as number | undefined;
      const dueToday = data.dueToday as number | undefined;
      const dueSoon = data.dueSoon as number | undefined;
      if (typeof overdue === 'number' && overdue > 0) badges.push({ label: `${overdue} overdue`, color: 'bg-red-50 text-red-700' });
      if (typeof dueToday === 'number' && dueToday > 0) badges.push({ label: `${dueToday} due today`, color: 'bg-amber-50 text-amber-700' });
      if (typeof dueSoon === 'number' && dueSoon > 0) badges.push({ label: `${dueSoon} upcoming`, color: 'bg-emerald-50 text-emerald-700' });
      break;
    }
    case 'stale-task-strategist': {
      const analyzed = data.tasksAnalyzed as number | undefined;
      if (typeof analyzed === 'number') badges.push({ label: `${analyzed} tasks reviewed`, color: 'bg-stone-100 text-stone-700' });
      break;
    }
    case 'energy-task-suggester': {
      const readiness = data.readiness as number | undefined;
      const taskCount = data.taskCount as number | undefined;
      if (typeof readiness === 'number') {
        const color = readiness >= 85 ? 'bg-emerald-50 text-emerald-700' : readiness >= 70 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700';
        badges.push({ label: `Readiness ${readiness}`, color });
      }
      if (typeof taskCount === 'number') badges.push({ label: `${taskCount} tasks`, color: 'bg-stone-100 text-stone-700' });
      break;
    }
    case 'weekly-couple-sync': {
      const completed = data.completedTotal as number | undefined;
      const pending = data.pendingTotal as number | undefined;
      if (typeof completed === 'number') badges.push({ label: `${completed} completed`, color: 'bg-emerald-50 text-emerald-700' });
      if (typeof pending === 'number') badges.push({ label: `${pending} pending`, color: 'bg-amber-50 text-amber-700' });
      break;
    }
    case 'birthday-gift-agent': {
      const events = data.events as Array<{ daysUntil: number }> | undefined;
      if (events && events.length > 0) {
        const soonest = Math.min(...events.map(e => e.daysUntil));
        badges.push({ label: `${soonest}d away`, color: soonest <= 7 ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-stone-700' });
      }
      break;
    }
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge, i) => (
        <span key={i} className={cn('text-[10px] leading-none px-2 py-1 rounded-full font-medium tracking-wide', badge.color)}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Renders an agent message with light list awareness.
 * Many agents emit content like:
 *   📋 Task Strategist Report
 *
 *   • "Define will" → BREAK_DOWN: Too complex, needs smaller steps.
 *   • "Create password folder" → RESCHEDULE: Low priority.
 *
 * Raw whitespace-pre-wrap rendering treats this as a wall of text.
 * Splitting on bullet markers gives us a clean visual list with a
 * subtle leaf-tinted bullet and proper hanging indent.
 */
function AgentMessage({ message, expanded }: { message: string; expanded: boolean }) {
  const trimmed = message.trim();
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bulletRe = /^[•\-*]\s+(.+)$/;
  const bulletLines = lines.filter(l => bulletRe.test(l));
  const hasBullets = bulletLines.length >= 2;

  if (!hasBullets) {
    const display = expanded ? trimmed : trimmed.length > 180 ? trimmed.slice(0, 180) + '…' : trimmed;
    return (
      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
        {display}
      </p>
    );
  }

  // Pull out a heading line (first line that isn't a bullet)
  const headingLine = lines.find(l => !bulletRe.test(l));
  const bulletItems = bulletLines.map(l => l.replace(bulletRe, '$1'));
  const visibleBullets = expanded ? bulletItems : bulletItems.slice(0, 2);

  return (
    <div className="space-y-2">
      {headingLine && (
        <p className="text-sm font-medium text-foreground/90 leading-snug">
          {headingLine}
        </p>
      )}
      <ul className="space-y-1.5">
        {visibleBullets.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground/80 leading-relaxed">
            <span className="text-primary/60 mt-1 flex-shrink-0 leading-none">•</span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InsightCard({ run }: { run: AgentRun }) {
  const { t } = useTranslation(['profile']);
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();
  const message = run.result?.message || '';
  const data = run.result?.data as Record<string, unknown> | undefined;
  const iconColorClass = agentColors[run.agent_id] || 'text-stone-600 bg-stone-100';

  // Decide collapsibility based on bullet count or raw length
  const lines = message.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bulletCount = lines.filter(l => /^[•\-*]\s+/.test(l)).length;
  const isCollapsible = bulletCount > 2 || message.length > 180;

  return (
    <div
      className={cn(
        "group relative w-full rounded-2xl",
        "bg-white border border-stone-100",
        "hover:border-primary/20 hover:shadow-sm",
        "transition-all duration-200 cursor-pointer overflow-hidden"
      )}
      onClick={() => navigate(getLocalizedPath(`/agents/${run.agent_id}`))}
    >
      <div className="p-4 space-y-3">
        {/* Header — agent icon, name, timestamp */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0',
              iconColorClass
            )}
            style={{ borderRadius: '28%' }}
          >
            {agentIcons[run.agent_id] || <Zap className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-foreground leading-tight truncate">
              {getAgentDisplayName(run.agent_id)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {run.completed_at && formatDistanceToNow(new Date(run.completed_at), { addSuffix: true })}
            </p>
          </div>
          <ArrowRight
            className="w-4 h-4 text-muted-foreground/30 flex-shrink-0 mt-2
                       group-hover:text-primary group-hover:translate-x-0.5 transition-all"
          />
        </div>

        {/* Optional data badges row */}
        <AgentDataBadges agentId={run.agent_id} data={data} />

        {/* Message body — list-aware rendering */}
        {message && <AgentMessage message={message} expanded={expanded} />}

        {/* Expand / collapse */}
        {isCollapsible && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="inline-flex items-center gap-1 text-[11px] font-medium
                       text-primary/80 hover:text-primary transition-colors"
            aria-expanded={expanded}
          >
            <span>
              {expanded
                ? t('profile:myday.agentInsight.showLess', { defaultValue: 'Show less' })
                : t('profile:myday.agentInsight.showMore', { defaultValue: 'Show more' })}
            </span>
            <ChevronDown
              className={cn(
                "w-3 h-3 transition-transform duration-200",
                expanded && "rotate-180"
              )}
            />
          </button>
        )}
      </div>
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
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-primary" />
          </div>
          <h3 className="font-serif font-semibold text-[15px] text-foreground tracking-tight">
            {t('profile:myday.agentInsights', 'Agent insights')}
          </h3>
        </div>
        <button
          onClick={() => navigate(getLocalizedPath('/profile'), { state: { scrollTo: 'agents' } })}
          className="text-[11px] font-medium text-primary/80 hover:text-primary
                     px-2.5 py-1 rounded-full hover:bg-primary/5 transition-colors"
        >
          {t('profile:myday.manageAgents', 'Manage')}
        </button>
      </div>

      <div className="space-y-2.5">
        {insights.slice(0, 3).map((run) => (
          <InsightCard key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}

export default AgentInsightsSection;
