import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Check, Loader2, RefreshCw, Unlink, Activity, Heart } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

interface OuraConnection {
  connected: boolean;
  email?: string;
  last_sync?: string;
  share_wellness_with_partner?: boolean;
}

export function OuraConnect() {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();

  const [connection, setConnection] = useState<OuraConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [shareWellness, setShareWellness] = useState(false);

  useEffect(() => {
    const ouraParam = searchParams.get('oura');
    if (ouraParam === 'connected') {
      toast.success(t('oura.connectedSuccess', 'Oura Ring connected successfully!'));
      searchParams.delete('oura');
      setSearchParams(searchParams, { replace: true });
    } else if (ouraParam === 'error') {
      const message = searchParams.get('message') || t('oura.error', 'Failed to connect Oura');
      toast.error(message);
      searchParams.delete('oura');
      searchParams.delete('message');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, t]);

  useEffect(() => {
    if (userId) checkConnection();
  }, [userId]);

  async function checkConnection() {
    if (!userId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('oura-data', {
        body: { user_id: userId, action: 'status' }
      });
      if (error) throw error;
      if (data?.success && data?.connected) {
        setConnection({ connected: true, email: data.email, last_sync: data.last_sync });
        // Fetch partner wellness sharing preference directly from DB
        const { data: connData } = await supabase
          .from('oura_connections')
          .select('share_wellness_with_partner')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();
        if (connData) {
          setShareWellness(connData.share_wellness_with_partner ?? false);
        }
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
      const origin = window.location.origin;
      const { data, error } = await supabase.functions.invoke('oura-auth-url', {
        body: { user_id: userId, redirect_origin: origin }
      });
      if (error) throw error;
      if (data?.success && data?.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error('Failed to get auth URL');
      }
    } catch (error) {
      console.error('Failed to start Oura connection:', error);
      toast.error(t('oura.error', 'Failed to connect Oura'));
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!userId) return;
    if (!confirm(t('oura.disconnectConfirm', 'Are you sure you want to disconnect Oura?'))) return;
    try {
      setDisconnecting(true);
      const { data, error } = await supabase.functions.invoke('oura-data', {
        body: { user_id: userId, action: 'disconnect' }
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(t('oura.disconnected', 'Oura disconnected'));
        setConnection({ connected: false });
      }
    } catch (error: any) {
      console.error('Failed to disconnect Oura:', error);
      toast.error(error.message || t('oura.error', 'Failed to disconnect'));
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleShareWellnessToggle(enabled: boolean) {
    if (!userId) return;
    setShareWellness(enabled);
    try {
      const { error } = await supabase
        .from('oura_connections')
        .update({ share_wellness_with_partner: enabled })
        .eq('user_id', userId)
        .eq('is_active', true);
      if (error) throw error;
    } catch (error) {
      console.error('Failed to update wellness sharing:', error);
      setShareWellness(!enabled); // Revert on failure
      toast.error(t('oura.error', 'Failed to update setting'));
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
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-foreground truncate">Oura Ring</span>
              <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                <Check className="h-3 w-3 mr-1" />
                {t('oura.connected', 'Connected')}
              </Badge>
            </div>
            {connection.email && (
              <p className="text-xs text-muted-foreground truncate">{connection.email}</p>
            )}
            {connection.last_sync && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('oura.lastSynced', 'Last synced:')} {new Date(connection.last_sync).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {/* Partner wellness sharing toggle */}
        <div className="flex items-center justify-between py-3 px-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            <Heart className="h-4 w-4 text-rose-400" />
            <div>
              <Label className="text-sm font-medium">{t('oura.shareWellness', 'Share wellness with partner')}</Label>
              <p className="text-xs text-muted-foreground">{t('oura.shareWellnessDesc', 'Let your partner know when you need a lighter day')}</p>
            </div>
          </div>
          <Switch
            checked={shareWellness}
            onCheckedChange={handleShareWellnessToggle}
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="text-destructive hover:text-destructive">
            {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('oura.description', 'Connect your Oura Ring to see sleep scores, readiness, and health data in your daily summary.')}
      </p>
      <Button onClick={handleConnect} disabled={connecting} className="w-full">
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('oura.connecting', 'Connecting...')}
          </>
        ) : (
          <>
            <Activity className="h-4 w-4 mr-2" />
            {t('oura.connectButton', 'Connect Oura Ring')}
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        {t('oura.permissionNote', "We'll request access to your sleep, readiness, activity, and workout data.")}
      </p>
    </div>
  );
}
