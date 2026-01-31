/**
 * Olive Heartbeat Hook
 *
 * React hook for interacting with the proactive intelligence system.
 * Manages scheduled notifications, briefings, and user preferences.
 */

import { useCallback, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

export type JobType =
  | 'morning_briefing'
  | 'evening_review'
  | 'weekly_summary'
  | 'task_reminder'
  | 'overdue_nudge'
  | 'pattern_suggestion';

export interface HeartbeatJob {
  id: string;
  user_id: string;
  job_type: JobType;
  scheduled_for: string;
  payload: Record<string, any>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface HeartbeatLogEntry {
  id: string;
  user_id: string;
  job_type: JobType;
  status: 'sent' | 'failed' | 'skipped';
  message_preview?: string;
  error?: string;
  channel: string;
  created_at: string;
}

export interface ProactivePreferences {
  proactive_enabled: boolean;
  max_daily_messages: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  morning_briefing_enabled: boolean;
  morning_briefing_time: string;
  evening_review_enabled: boolean;
  evening_review_time: string;
  weekly_summary_enabled: boolean;
  weekly_summary_day: number;
  weekly_summary_time: string;
  overdue_nudge_enabled: boolean;
  pattern_suggestions_enabled: boolean;
}

interface UseOliveHeartbeatReturn {
  isLoading: boolean;
  error: Error | null;

  // Preferences
  preferences: ProactivePreferences | null;
  updatePreferences: (prefs: Partial<ProactivePreferences>) => Promise<void>;
  refreshPreferences: () => Promise<void>;

  // Manual triggers
  requestBriefing: () => Promise<string>;
  requestEveningReview: () => Promise<string>;
  requestWeeklySummary: () => Promise<string>;

  // Job management
  scheduleJob: (jobType: JobType, scheduledFor?: Date, payload?: Record<string, any>) => Promise<string>;
  getPendingJobs: () => Promise<HeartbeatJob[]>;
  cancelJob: (jobId: string) => Promise<void>;

  // History
  getRecentHistory: (limit?: number) => Promise<HeartbeatLogEntry[]>;

  // Stats
  getStats: () => Promise<{
    today_sent: number;
    today_remaining: number;
    last_briefing?: string;
    last_review?: string;
  }>;
}

/**
 * Call the olive-heartbeat edge function
 */
async function callHeartbeatService(action: string, params: Record<string, any> = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await supabase.functions.invoke('olive-heartbeat', {
    body: { action, ...params },
    headers: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : undefined,
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data;
}

/**
 * Hook for Olive Heartbeat (Proactive Intelligence) system
 */
export function useOliveHeartbeat(): UseOliveHeartbeatReturn {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [preferences, setPreferences] = useState<ProactivePreferences | null>(null);

  /**
   * Load preferences on mount
   */
  useEffect(() => {
    if (user?.id) {
      refreshPreferences().catch(console.error);
    }
  }, [user?.id]);

  /**
   * Refresh preferences from database
   */
  const refreshPreferences = useCallback(async (): Promise<void> => {
    if (!user?.id) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('olive_user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      if (data) {
        setPreferences({
          proactive_enabled: data.proactive_enabled,
          max_daily_messages: data.max_daily_messages,
          quiet_hours_start: data.quiet_hours_start,
          quiet_hours_end: data.quiet_hours_end,
          morning_briefing_enabled: data.morning_briefing_enabled,
          morning_briefing_time: data.morning_briefing_time,
          evening_review_enabled: data.evening_review_enabled,
          evening_review_time: data.evening_review_time,
          weekly_summary_enabled: data.weekly_summary_enabled,
          weekly_summary_day: data.weekly_summary_day,
          weekly_summary_time: data.weekly_summary_time,
          overdue_nudge_enabled: data.overdue_nudge_enabled,
          pattern_suggestions_enabled: data.pattern_suggestions_enabled,
        });
      } else {
        // Create default preferences
        setPreferences({
          proactive_enabled: true,
          max_daily_messages: 5,
          quiet_hours_start: '22:00',
          quiet_hours_end: '07:00',
          morning_briefing_enabled: false,
          morning_briefing_time: '08:00',
          evening_review_enabled: false,
          evening_review_time: '20:00',
          weekly_summary_enabled: false,
          weekly_summary_day: 0, // Sunday
          weekly_summary_time: '10:00',
          overdue_nudge_enabled: true,
          pattern_suggestions_enabled: true,
        });
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  /**
   * Update proactive preferences
   */
  const updatePreferences = useCallback(
    async (prefs: Partial<ProactivePreferences>): Promise<void> => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      setIsLoading(true);
      setError(null);

      try {
        const { error: upsertError } = await supabase
          .from('olive_user_preferences')
          .upsert({
            user_id: user.id,
            ...prefs,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id',
          });

        if (upsertError) {
          throw upsertError;
        }

        // Update local state
        setPreferences((prev) => (prev ? { ...prev, ...prefs } : null));
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [user?.id]
  );

  /**
   * Request a morning briefing immediately
   */
  const requestBriefing = useCallback(async (): Promise<string> => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    const result = await callHeartbeatService('generate_briefing', {
      user_id: user.id,
    });

    return result.briefing || '';
  }, [user?.id]);

  /**
   * Request an evening review immediately
   */
  const requestEveningReview = useCallback(async (): Promise<string> => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    // Schedule immediate evening review job
    await callHeartbeatService('schedule_job', {
      user_id: user.id,
      job_type: 'evening_review',
      payload: { immediate: true },
    });

    // For immediate preview, generate it
    const result = await callHeartbeatService('generate_briefing', {
      user_id: user.id,
    });

    return result.briefing || '';
  }, [user?.id]);

  /**
   * Request a weekly summary immediately
   */
  const requestWeeklySummary = useCallback(async (): Promise<string> => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    await callHeartbeatService('schedule_job', {
      user_id: user.id,
      job_type: 'weekly_summary',
      payload: { immediate: true },
    });

    return 'Weekly summary scheduled for delivery';
  }, [user?.id]);

  /**
   * Schedule a heartbeat job
   */
  const scheduleJob = useCallback(
    async (
      jobType: JobType,
      scheduledFor?: Date,
      payload?: Record<string, any>
    ): Promise<string> => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const result = await callHeartbeatService('schedule_job', {
        user_id: user.id,
        job_type: jobType,
        payload: {
          scheduled_for: scheduledFor?.toISOString(),
          ...payload,
        },
      });

      return result.job_id;
    },
    [user?.id]
  );

  /**
   * Get pending jobs for the user
   */
  const getPendingJobs = useCallback(async (): Promise<HeartbeatJob[]> => {
    if (!user?.id) {
      return [];
    }

    const { data, error: fetchError } = await supabase
      .from('olive_heartbeat_jobs')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true });

    if (fetchError) {
      console.error('Failed to fetch pending jobs:', fetchError);
      return [];
    }

    return data || [];
  }, [user?.id]);

  /**
   * Cancel a scheduled job
   */
  const cancelJob = useCallback(
    async (jobId: string): Promise<void> => {
      const { error: deleteError } = await supabase
        .from('olive_heartbeat_jobs')
        .delete()
        .eq('id', jobId)
        .eq('status', 'pending');

      if (deleteError) {
        throw deleteError;
      }
    },
    []
  );

  /**
   * Get recent heartbeat history
   */
  const getRecentHistory = useCallback(
    async (limit: number = 20): Promise<HeartbeatLogEntry[]> => {
      if (!user?.id) {
        return [];
      }

      const { data, error: fetchError } = await supabase
        .from('olive_heartbeat_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fetchError) {
        console.error('Failed to fetch history:', fetchError);
        return [];
      }

      return data || [];
    },
    [user?.id]
  );

  /**
   * Get heartbeat stats
   */
  const getStats = useCallback(async () => {
    if (!user?.id) {
      return {
        today_sent: 0,
        today_remaining: preferences?.max_daily_messages || 5,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count messages sent today
    const { count } = await supabase
      .from('olive_heartbeat_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'sent')
      .gte('created_at', today.toISOString());

    const todaySent = count || 0;
    const maxDaily = preferences?.max_daily_messages || 5;

    // Get last briefing and review times
    const { data: lastBriefing } = await supabase
      .from('olive_heartbeat_log')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('job_type', 'morning_briefing')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: lastReview } = await supabase
      .from('olive_heartbeat_log')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('job_type', 'evening_review')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return {
      today_sent: todaySent,
      today_remaining: Math.max(0, maxDaily - todaySent),
      last_briefing: lastBriefing?.created_at,
      last_review: lastReview?.created_at,
    };
  }, [user?.id, preferences?.max_daily_messages]);

  return {
    isLoading,
    error,
    preferences,
    updatePreferences,
    refreshPreferences,
    requestBriefing,
    requestEveningReview,
    requestWeeklySummary,
    scheduleJob,
    getPendingJobs,
    cancelJob,
    getRecentHistory,
    getStats,
  };
}

export default useOliveHeartbeat;
