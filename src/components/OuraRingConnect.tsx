import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, Check, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

interface OuraConnection {
  connected: boolean;
  sync_enabled?: boolean;
  last_sync?: string;
}

export function OuraRingConnect() {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();

  const [connection, setConnection] = useState<OuraConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    const ouraParam = searchParams.get('oura');
    if (ouraParam === 'connected') {
      toast.success(t('oura.connectedSuccess'));
      searchParams.delete('oura');
      setSearchParams(searchParams, { replace: true });
    } else if (ouraParam === 'error') {
      const message = searchParams.get('message') || t('oura.error');
      toast.error(message);
      searchParams.delete('oura');
      searchParams.delete('message');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, t]);

  useEffect(() => {
    if (userId) {
      checkConnection();
    }
  }, [userId]);

  async function checkConnection() {
    if (!userId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('oura-sync', {
        body: { user_id: userId, action: 'status' },
      });

      if (error) throw error;

      if (data?.success && data?.connected) {
        setConnection({
          connected: true,
          sync_enabled: data.sync_enabled,
          last_sync: data.last_sync,
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
  }

  async function handleConnect() {
    if (!userId) return;

    try {
      setConnecting(true);

      // On native iOS/Android, use the deployed web URL for OAuth redirects
      const isNative = Capacitor.isNativePlatform();
      const origin = isNative ? 'https://witholive.app' : window.location.origin;

      const { data, error } = await supabase.functions.invoke('oura-auth-url', {
        body: { user_id: userId, redirect_origin: origin },
      });

      if (error) throw error;

      if (data?.success && data?.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error('Failed to get auth URL');
      }
    } catch (error) {
      console.error('Failed to start Oura connection:', error);
      toast.error(t('oura.error'));
      setConnecting(false);
    }
  }

  async function handleSync() {
    if (!userId) return;

    try {
      setSyncing(true);
      const { data, error } = await supabase.functions.invoke('oura-sync', {
        body: { user_id: userId, action: 'fetch_data' },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(t('oura.syncSuccess', { count: data.synced_count }));
        await checkConnection();
      } else {
        throw new Error(data?.error || 'Sync failed');
      }
    } catch (error: any) {
      console.error('Failed to sync Oura data:', error);
      toast.error(error.message || t('oura.error'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!userId) return;

    if (!confirm(t('oura.disconnectConfirm'))) {
      return;
    }

    try {
      setDisconnecting(true);
      const { data, error } = await supabase.functions.invoke('oura-sync', {
        body: { user_id: userId, action: 'disconnect' },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(t('oura.disconnected'));
        setConnection({ connected: false });
      } else {
        throw new Error(data?.error || 'Disconnect failed');
      }
    } catch (error: any) {
      console.error('Failed to disconnect Oura:', error);
      toast.error(error.message || t('oura.error'));
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
        <div className="flex items-start gap-3 p-3 bg-rose-500/5 rounded-lg border border-rose-500/10">
          <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center flex-shrink-0">
            <Heart className="h-5 w-5 text-rose-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-foreground">
                Oura Ring
              </span>
              <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                <Check className="h-3 w-3 mr-1" />
                {t('oura.connected')}
              </Badge>
            </div>
            {connection.last_sync && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('oura.lastSynced')} {new Date(connection.last_sync).toLocaleString()}
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
            {t('oura.syncNow')}
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
        {t('oura.description')}
      </p>

      <Button
        onClick={handleConnect}
        disabled={connecting}
        className="w-full"
      >
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('oura.connecting')}
          </>
        ) : (
          <>
            <Heart className="h-4 w-4 mr-2" />
            {t('oura.connectButton')}
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {t('oura.permissionNote')}
      </p>
    </div>
  );
}
