import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

interface OuraConnection {
  connected: boolean;
  sync_enabled?: boolean;
  last_sync?: string;
}

export interface OuraDailyData {
  day: string;
  sleep_score: number | null;
  sleep_duration_seconds: number | null;
  sleep_efficiency: number | null;
  deep_sleep_seconds: number | null;
  rem_sleep_seconds: number | null;
  light_sleep_seconds: number | null;
  awake_seconds: number | null;
  readiness_score: number | null;
  readiness_temperature_deviation: number | null;
  readiness_hrv_balance: number | null;
  readiness_resting_heart_rate: number | null;
  activity_score: number | null;
  steps: number | null;
  active_calories: number | null;
  total_calories: number | null;
  active_minutes: number | null;
  sedentary_minutes: number | null;
}

export function useOuraData() {
  const { user } = useAuth();
  const userId = user?.id;

  const [connection, setConnection] = useState<OuraConnection | null>(null);
  const [data, setData] = useState<OuraDailyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const checkConnection = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const { data: statusData, error } = await supabase.functions.invoke('oura-sync', {
        body: { user_id: userId, action: 'status' },
      });

      if (error) throw error;

      if (statusData?.success && statusData?.connected) {
        setConnection({
          connected: true,
          sync_enabled: statusData.sync_enabled,
          last_sync: statusData.last_sync,
        });
      } else {
        setConnection({ connected: false });
      }
    } catch (error) {
      console.error('Failed to check Oura connection:', error);
      setConnection({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchData = useCallback(async () => {
    if (!userId) return;

    try {
      // Query oura_daily_data for last 7 days
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data: rows, error } = await supabase
        .from('oura_daily_data')
        .select('day, sleep_score, sleep_duration_seconds, sleep_efficiency, deep_sleep_seconds, rem_sleep_seconds, light_sleep_seconds, awake_seconds, readiness_score, readiness_temperature_deviation, readiness_hrv_balance, readiness_resting_heart_rate, activity_score, steps, active_calories, total_calories, active_minutes, sedentary_minutes')
        .eq('user_id', userId)
        .gte('day', startDate)
        .order('day', { ascending: false });

      if (error) throw error;
      setData(rows || []);
    } catch (error) {
      console.error('Failed to fetch Oura data:', error);
    }
  }, [userId]);

  const syncData = useCallback(async () => {
    if (!userId) return;

    try {
      setSyncing(true);
      const { data: syncResult, error } = await supabase.functions.invoke('oura-sync', {
        body: { user_id: userId, action: 'fetch_data' },
      });

      if (error) throw error;

      if (syncResult?.success) {
        await checkConnection();
        await fetchData();
        return syncResult;
      } else {
        throw new Error(syncResult?.error || 'Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  }, [userId, checkConnection, fetchData]);

  useEffect(() => {
    if (userId) {
      checkConnection();
      fetchData();
    }
  }, [userId, checkConnection, fetchData]);

  // Get today's data
  const today = new Date().toISOString().split('T')[0];
  const todayData = data.find((d) => d.day === today) || null;

  return {
    connection,
    data,
    todayData,
    loading,
    syncing,
    syncData,
    checkConnection,
    fetchData,
  };
}
