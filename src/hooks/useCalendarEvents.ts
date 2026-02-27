import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

export interface CalendarEvent {
  id: string;
  google_event_id: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  event_type: 'from_calendar' | 'from_note';
  note_id?: string;
  timezone?: string;
}

export interface CalendarConnection {
  id: string;
  connected: boolean;
  email?: string;
  calendar_name?: string;
  sync_enabled: boolean;
  show_google_events: boolean;
  auto_add_to_calendar: boolean;
  last_sync?: string;
  tasks_enabled?: boolean;
}

export function useCalendarEvents() {
  const { user } = useAuth();
  const userId = user?.id;
  
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Fetch calendar connection status
  const fetchConnection = useCallback(async () => {
    if (!userId) return null;
    
    try {
      // Only select non-sensitive columns - exclude access_token, refresh_token, token_expiry
      const { data, error } = await supabase
        .from('calendar_connections')
        .select('id, user_id, google_user_id, google_email, calendar_name, calendar_type, sync_direction, error_message, auto_add_to_calendar, show_google_events, updated_at, created_at, is_active, last_sync_time, auto_create_events, sync_enabled, couple_id, primary_calendar_id, tasks_enabled')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      
      if (error) throw error;
      
      if (data) {
        const conn: CalendarConnection = {
          id: data.id,
          connected: true,
          email: data.google_email,
          calendar_name: data.calendar_name,
          sync_enabled: data.sync_enabled ?? true,
          show_google_events: data.show_google_events ?? true,
          auto_add_to_calendar: data.auto_add_to_calendar ?? true,
          last_sync: data.last_sync_time,
          tasks_enabled: data.tasks_enabled ?? false,
        };
        setConnection(conn);
        return conn;
      } else {
        setConnection({ id: '', connected: false, sync_enabled: false, show_google_events: true, auto_add_to_calendar: true });
        return null;
      }
    } catch (error) {
      console.error('Failed to fetch calendar connection:', error);
      return null;
    }
  }, [userId]);

  // Fetch calendar events from local DB
  const fetchEvents = useCallback(async () => {
    if (!userId) return;
    
    try {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .order('start_time', { ascending: true });
      
      if (error) throw error;
      
      setEvents(data || []);
    } catch (error) {
      console.error('Failed to fetch calendar events:', error);
    }
  }, [userId]);

  // Sync events from Google Calendar
  const syncEvents = useCallback(async () => {
    if (!userId) return false;
    
    try {
      setSyncing(true);
      const { data, error } = await supabase.functions.invoke('calendar-sync', {
        body: { user_id: userId, action: 'fetch_events' }
      });

      if (error) throw error;
      
      if (data?.success) {
        await fetchEvents();
        await fetchConnection();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to sync calendar:', error);
      return false;
    } finally {
      setSyncing(false);
    }
  }, [userId, fetchEvents, fetchConnection]);

  // Update calendar settings
  const updateSettings = useCallback(async (settings: { show_google_events?: boolean; auto_add_to_calendar?: boolean }) => {
    if (!userId || !connection?.id) return false;
    
    try {
      const { error } = await supabase
        .from('calendar_connections')
        .update(settings)
        .eq('id', connection.id);
      
      if (error) throw error;
      
      setConnection(prev => prev ? { ...prev, ...settings } : prev);
      return true;
    } catch (error) {
      console.error('Failed to update calendar settings:', error);
      return false;
    }
  }, [userId, connection?.id]);

  // Add note to Google Calendar
  const addToCalendar = useCallback(async (note: {
    id: string;
    title: string;
    description?: string;
    start_time: string;
    end_time?: string;
    all_day?: boolean;
    location?: string;
  }) => {
    if (!userId) return null;
    
    try {
      const { data, error } = await supabase.functions.invoke('calendar-create-event', {
        body: {
          user_id: userId,
          note_id: note.id,
          title: note.title,
          description: note.description,
          start_time: note.start_time,
          end_time: note.end_time,
          all_day: note.all_day ?? false,
          location: note.location,
        }
      });

      if (error) throw error;
      
      if (data?.success) {
        await fetchEvents();
        return data.event;
      }
      return null;
    } catch (error) {
      console.error('Failed to add to calendar:', error);
      return null;
    }
  }, [userId, fetchEvents]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const conn = await fetchConnection();
      if (conn?.connected) {
        await fetchEvents();
      }
      setLoading(false);
    };
    
    if (userId) {
      load();
    }
  }, [userId, fetchConnection, fetchEvents]);

  return {
    events,
    connection,
    loading,
    syncing,
    syncEvents,
    fetchEvents,
    fetchConnection,
    updateSettings,
    addToCalendar,
  };
}
