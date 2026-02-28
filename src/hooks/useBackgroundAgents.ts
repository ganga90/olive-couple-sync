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

// Helper: wait for ms
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  /**
   * Toggle WhatsApp notifications for a specific agent.
   * Merges { whatsapp_notify: boolean } into the existing olive_user_skills.config JSONB.
   */
  const updateAgentWhatsAppNotify = useCallback(
    async (skillId: string, enabled: boolean) => {
      if (!user?.id) return;

      const agent = agents.find((a) => a.skill_id === skillId);
      const currentConfig = agent?.userConfig || {};
      const newConfig = { ...currentConfig, whatsapp_notify: enabled };

      // Ensure the user_skills row exists
      const { data: existingRow } = await supabase
        .from('olive_user_skills')
        .select('id')
        .eq('user_id', user.id)
        .eq('skill_id', skillId)
        .maybeSingle();

      if (existingRow) {
        await supabase
          .from('olive_user_skills')
          .update({ config: newConfig })
          .eq('user_id', user.id)
          .eq('skill_id', skillId);
      } else {
        await supabase
          .from('olive_user_skills')
          .insert({
            user_id: user.id,
            skill_id: skillId,
            enabled: agent?.isEnabled ?? false,
            config: newConfig,
          });
      }

      // Update local state immediately
      setAgents((prev) =>
        prev.map((a) =>
          a.skill_id === skillId ? { ...a, userConfig: newConfig } : a
        )
      );
    },
    [user?.id, agents]
  );

  /**
   * Fetch run history for a specific agent (last N runs).
   */
  const fetchAgentHistory = useCallback(
    async (agentId: string, limit = 10): Promise<AgentRun[]> => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('olive_agent_runs')
        .select('id, agent_id, status, result, error_message, started_at, completed_at')
        .eq('user_id', user.id)
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Failed to fetch agent history:', error);
        return [];
      }

      return (data || []) as AgentRun[];
    },
    [user?.id]
  );

  /**
   * Run an agent immediately and poll for completion (3 attempts, 3s interval).
   * Returns the completed AgentRun if polling succeeds, or null on timeout.
   */
  const runAgentNow = useCallback(
    async (skillId: string): Promise<AgentRun | null> => {
      if (!user?.id) return null;

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

      // Poll for completion (3 attempts, 3s apart)
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(3000);

        const { data: latestRun } = await supabase
          .from('olive_agent_runs')
          .select('id, agent_id, status, result, error_message, started_at, completed_at')
          .eq('user_id', user.id)
          .eq('agent_id', skillId)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestRun && (latestRun.status === 'completed' || latestRun.status === 'failed')) {
          // Update local state with this run
          setAgents((prev) =>
            prev.map((a) =>
              a.skill_id === skillId ? { ...a, lastRun: latestRun as AgentRun } : a
            )
          );
          return latestRun as AgentRun;
        }
      }

      // Polling timed out — fall back to full refresh
      await loadAgents();
      return null;
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
    updateAgentWhatsAppNotify,
    fetchAgentHistory,
    runAgentNow,
    refreshAgents: loadAgents,
    getScheduleLabel,
    getScheduleLabelI18n,
  };
}

/**
 * Lightweight hook for MyDay — fetches recent meaningful agent insights.
 * Queries olive_agent_runs directly for completed runs in the last 24h.
 */
export function useAgentInsights() {
  const { user } = useAuth();
  const [insights, setInsights] = useState<AgentRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    const fetchInsights = async () => {
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
          .from('olive_agent_runs')
          .select('id, agent_id, status, result, error_message, started_at, completed_at')
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', since)
          .order('completed_at', { ascending: false })
          .limit(20);

        if (error) throw error;

        // Deduplicate: keep only the latest run per agent
        const seen = new Set<string>();
        const deduped: AgentRun[] = [];
        for (const run of data || []) {
          if (!seen.has(run.agent_id)) {
            seen.add(run.agent_id);
            deduped.push(run as AgentRun);
          }
        }

        // Filter to runs with meaningful result.message
        const trivialMessages = [
          'no stale tasks found',
          'no upcoming bills',
          'no bill-related due dates',
          'oura not connected',
          'no oura data available',
          'no tasks scheduled for today',
          'not enough sleep data',
          'too soon since last tip',
          'sleep looks good, no tip needed',
          'no upcoming dates',
          'no dates in reminder window',
          'no messages to send',
          'no couple linked',
          'couple members not found',
          'gmail not connected',
        ];

        const meaningful = deduped.filter((run) => {
          const msg = run.result?.message;
          if (!msg || msg.trim().length === 0) return false;
          return !trivialMessages.some((t) => msg.toLowerCase().includes(t));
        });

        setInsights(meaningful);
      } catch (error) {
        console.error('Failed to fetch agent insights:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInsights();
  }, [user?.id]);

  return { insights, isLoading };
}

export default useBackgroundAgents;
