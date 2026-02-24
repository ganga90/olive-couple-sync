/**
 * Background Agents Hook
 *
 * Manages background agent discovery, activation, configuration, and status.
 * Background agents are skills with agent_type='background_agent' that run on a schedule.
 */

import { useCallback, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

export interface BackgroundAgent {
  skill_id: string;
  name: string;
  description: string | null;
  category: string | null;
  agent_type: string;
  schedule: string | null;
  agent_config: Record<string, unknown>;
  requires_approval: boolean;
  requires_connection: string | null;
}

export interface AgentActivation {
  skill_id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_used_at: string | null;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  status: 'running' | 'completed' | 'failed' | 'awaiting_approval' | 'cancelled';
  result: { message?: string; data?: Record<string, unknown> } | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface AgentWithStatus extends BackgroundAgent {
  isEnabled: boolean;
  userConfig: Record<string, unknown>;
  lastRun: AgentRun | null;
  lastUsedAt: string | null;
  connectionStatus: 'connected' | 'disconnected' | 'not_required';
}

function getScheduleLabel(schedule: string | null): string {
  if (!schedule) return '';
  const labels: Record<string, string> = {
    'daily_9am': 'Daily at 9:00 AM',
    'daily_10am': 'Daily at 10:00 AM',
    'daily_morning_briefing': 'With morning briefing',
    'daily_check': 'Daily check',
    'weekly_monday_9am': 'Mondays at 9:00 AM',
    'weekly_sunday_6pm': 'Sundays at 6:00 PM',
    'every_15min': 'Every 15 minutes',
  };
  return labels[schedule] || schedule;
}

function getScheduleLabelI18n(schedule: string | null, t: (key: string, fallback: string) => string): string {
  if (!schedule) return '';
  return t(`agents.schedules.${schedule}`, getScheduleLabel(schedule));
}

export function useBackgroundAgents() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<AgentWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingAgent, setTogglingAgent] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);

    try {
      // Fetch all background agents
      const { data: allAgents, error: agentsError } = await supabase
        .from('olive_skills')
        .select('skill_id, name, description, category, agent_type, schedule, agent_config, requires_approval, requires_connection')
        .eq('agent_type', 'background_agent')
        .eq('is_active', true)
        .order('name');

      if (agentsError) throw agentsError;

      // Fetch user activations
      const { data: userActivations, error: activationsError } = await supabase
        .from('olive_user_skills')
        .select('skill_id, enabled, config, last_used_at')
        .eq('user_id', user.id);

      if (activationsError) throw activationsError;

      // Fetch recent runs (last run per agent)
      const { data: recentRuns } = await supabase
        .from('olive_agent_runs')
        .select('id, agent_id, status, result, error_message, started_at, completed_at')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(50);

      // Fetch connection statuses
      const { data: ouraConn } = await supabase
        .from('oura_connections')
        .select('is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      const { data: emailConn } = await supabase
        .from('olive_email_connections')
        .select('is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      const connectionMap: Record<string, boolean> = {
        oura: !!ouraConn,
        gmail: !!emailConn,
      };

      // Build the activation map
      const activationMap = new Map<string, AgentActivation>();
      userActivations?.forEach((a) => {
        activationMap.set(a.skill_id!, {
          skill_id: a.skill_id!,
          enabled: a.enabled ?? false,
          config: (a.config as Record<string, unknown>) || {},
          last_used_at: a.last_used_at,
        });
      });

      // Build last run map (first occurrence per agent = most recent)
      const lastRunMap = new Map<string, AgentRun>();
      recentRuns?.forEach((run) => {
        if (!lastRunMap.has(run.agent_id)) {
          lastRunMap.set(run.agent_id, run as AgentRun);
        }
      });

      // Combine into AgentWithStatus
      const combined: AgentWithStatus[] = (allAgents || []).map((agent) => {
        const activation = activationMap.get(agent.skill_id);
        const lastRun = lastRunMap.get(agent.skill_id) || null;
        const reqConn = agent.requires_connection;

        let connectionStatus: 'connected' | 'disconnected' | 'not_required' = 'not_required';
        if (reqConn) {
          connectionStatus = connectionMap[reqConn] ? 'connected' : 'disconnected';
        }

        return {
          ...agent,
          agent_config: (agent.agent_config as Record<string, unknown>) || {},
          isEnabled: activation?.enabled ?? false,
          userConfig: activation?.config || {},
          lastRun,
          lastUsedAt: activation?.last_used_at || null,
          connectionStatus,
        };
      });

      setAgents(combined);
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const toggleAgent = useCallback(
    async (skillId: string, enabled: boolean) => {
      if (!user?.id) return;
      setTogglingAgent(skillId);

      try {
        const existing = agents.find((a) => a.skill_id === skillId);
        const hasActivation = existing?.isEnabled !== undefined && agents.some(
          (a) => a.skill_id === skillId && a.lastUsedAt !== null
        );

        // Check for existing record
        const { data: existingRow } = await supabase
          .from('olive_user_skills')
          .select('id')
          .eq('user_id', user.id)
          .eq('skill_id', skillId)
          .maybeSingle();

        if (existingRow) {
          await supabase
            .from('olive_user_skills')
            .update({ enabled, last_used_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('skill_id', skillId);
        } else {
          await supabase
            .from('olive_user_skills')
            .insert({
              user_id: user.id,
              skill_id: skillId,
              enabled,
              config: {},
            });
        }

        // Update local state immediately
        setAgents((prev) =>
          prev.map((a) =>
            a.skill_id === skillId ? { ...a, isEnabled: enabled } : a
          )
        );
      } catch (error) {
        console.error('Failed to toggle agent:', error);
        throw error;
      } finally {
        setTogglingAgent(null);
      }
    },
    [user?.id, agents]
  );

  const updateAgentConfig = useCallback(
    async (skillId: string, config: Record<string, unknown>) => {
      if (!user?.id) return;

      await supabase
        .from('olive_user_skills')
        .update({ config })
        .eq('user_id', user.id)
        .eq('skill_id', skillId);

      setAgents((prev) =>
        prev.map((a) =>
          a.skill_id === skillId ? { ...a, userConfig: config } : a
        )
      );
    },
    [user?.id]
  );

  const runAgentNow = useCallback(
    async (skillId: string) => {
      if (!user?.id) return;

      const { data: membership } = await supabase
        .from('clerk_couple_members')
        .select('couple_id')
        .eq('user_id', user.id)
        .maybeSingle();

      await supabase.functions.invoke('olive-agent-runner', {
        body: {
          action: 'run',
          agent_id: skillId,
          user_id: user.id,
          couple_id: membership?.couple_id,
        },
      });

      // Refresh to get updated run status
      await loadAgents();
    },
    [user?.id, loadAgents]
  );

  const activeCount = agents.filter((a) => a.isEnabled).length;

  return {
    agents,
    isLoading,
    togglingAgent,
    activeCount,
    totalCount: agents.length,
    toggleAgent,
    updateAgentConfig,
    runAgentNow,
    refreshAgents: loadAgents,
    getScheduleLabel,
    getScheduleLabelI18n,
  };
}

export default useBackgroundAgents;
