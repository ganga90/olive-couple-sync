import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Check, Loader2, RefreshCw, Unlink, ExternalLink } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

interface CalendarConnection {
  connected: boolean;
  email?: string;
  calendar_name?: string;
  sync_enabled?: boolean;
  last_sync?: string;
}

export function GoogleCalendarConnect() {
  const { user } = useAuth();
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    // Handle callback params
    const calendarParam = searchParams.get('calendar');
    if (calendarParam === 'connected') {
      toast.success('Google Calendar connected successfully!');
      searchParams.delete('calendar');
      setSearchParams(searchParams, { replace: true });
    } else if (calendarParam === 'error') {
      const message = searchParams.get('message') || 'Failed to connect calendar';
      toast.error(message);
      searchParams.delete('calendar');
      searchParams.delete('message');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (userId) {
      checkConnection();
    }
  }, [userId]);

  async function checkConnection() {
    if (!userId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('calendar-sync', {
        body: { user_id: userId, action: 'status' }
      });

      if (error) throw error;
      
      if (data?.success && data?.connected) {
        setConnection({
          connected: true,
          email: data.email,
          calendar_name: data.calendar_name,
          sync_enabled: data.sync_enabled,
          last_sync: data.last_sync,
        });
      } else {
        setConnection({ connected: false });
      }
    } catch (error) {
      console.error('Failed to check calendar connection:', error);
      setConnection({ connected: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!userId) return;
    
    try {
      setConnecting(true);
      
      // Get current origin for redirect
      const origin = window.location.origin;
      
      const { data, error } = await supabase.functions.invoke('calendar-auth-url', {
        body: { user_id: userId, redirect_origin: origin }
      });

      if (error) throw error;
      
      if (data?.success && data?.auth_url) {
        // Redirect to Google OAuth
        window.location.href = data.auth_url;
      } else {
        throw new Error('Failed to get auth URL');
      }
    } catch (error) {
      console.error('Failed to start calendar connection:', error);
      toast.error('Failed to connect calendar');
      setConnecting(false);
    }
  }

  async function handleSync() {
    if (!userId) return;
    
    try {
      setSyncing(true);
      const { data, error } = await supabase.functions.invoke('calendar-sync', {
        body: { user_id: userId, action: 'fetch_events' }
      });

      if (error) throw error;
      
      if (data?.success) {
        toast.success(`Synced ${data.synced_count} events`);
        await checkConnection();
      } else {
        throw new Error(data?.error || 'Sync failed');
      }
    } catch (error: any) {
      console.error('Failed to sync calendar:', error);
      toast.error(error.message || 'Failed to sync calendar');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!userId) return;
    
    if (!confirm('Are you sure you want to disconnect your Google Calendar?')) {
      return;
    }
    
    try {
      setDisconnecting(true);
      const { data, error } = await supabase.functions.invoke('calendar-sync', {
        body: { user_id: userId, action: 'disconnect' }
      });

      if (error) throw error;
      
      if (data?.success) {
        toast.success('Calendar disconnected');
        setConnection({ connected: false });
      } else {
        throw new Error(data?.error || 'Disconnect failed');
      }
    } catch (error: any) {
      console.error('Failed to disconnect calendar:', error);
      toast.error(error.message || 'Failed to disconnect calendar');
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (connection?.connected) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/10">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Calendar className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-foreground truncate">
                {connection.calendar_name || 'Google Calendar'}
              </span>
              <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                <Check className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {connection.email}
            </p>
            {connection.last_sync && (
              <p className="text-xs text-muted-foreground mt-1">
                Last synced: {new Date(connection.last_sync).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="flex-1"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-destructive hover:text-destructive"
          >
            {disconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect your Google Calendar to automatically create events from your notes and sync your schedule with Olive.
      </p>
      
      <Button
        onClick={handleConnect}
        disabled={connecting}
        className="w-full"
      >
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Calendar className="h-4 w-4 mr-2" />
            Connect Google Calendar
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        We'll request access to read and create events in your calendar.
      </p>
    </div>
  );
}
