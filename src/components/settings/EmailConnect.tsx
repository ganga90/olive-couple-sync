/**
 * EmailConnect — Gmail connection component
 *
 * Same pattern as OuraConnect.tsx:
 * - Check connection status on mount via edge function
 * - Connect button → OAuth flow via email-auth-url
 * - Disconnect button → deactivate via olive-email-mcp
 * - Listen for ?email=connected / ?email=error URL params
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, Unlink, Mail, Shield } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

interface EmailConnection {
  connected: boolean;
  email?: string;
  provider?: string;
  last_sync?: string;
  error?: string;
}

export function EmailConnect() {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const userId = user?.id;
  const [searchParams, setSearchParams] = useSearchParams();

  const [connection, setConnection] = useState<EmailConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Handle callback URL params
  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam === 'connected') {
      toast.success(t('email.connectedSuccess', 'Gmail connected successfully!'));
      searchParams.delete('email');
      setSearchParams(searchParams, { replace: true });
      // Re-check connection to get email address
      if (userId) checkConnection();
    } else if (emailParam === 'error') {
      const message = searchParams.get('message') || t('email.error', 'Failed to connect Gmail');
      toast.error(message);
      searchParams.delete('email');
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
      const { data, error } = await supabase.functions.invoke('olive-email-mcp', {
        body: { user_id: userId, action: 'status' }
      });
      if (error) throw error;
      if (data?.success && data?.connected) {
        setConnection({
          connected: true,
          email: data.email,
          provider: data.provider,
          last_sync: data.last_sync,
          error: data.error,
        });
      } else {
        setConnection({ connected: false });
      }
    } catch (error) {
      console.error('Failed to check email connection:', error);
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

      const { data, error } = await supabase.functions.invoke('email-auth-url', {
        body: { user_id: userId, redirect_origin: origin }
      });
      if (error) throw error;
      if (data?.success && data?.auth_url) {
        window.location.href = data.auth_url;
      } else {
        throw new Error('Failed to get auth URL');
      }
    } catch (error) {
      console.error('Failed to start email connection:', error);
      toast.error(t('email.error', 'Failed to connect Gmail'));
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!userId) return;
    if (!confirm(t('email.disconnectConfirm', 'Are you sure you want to disconnect Gmail? The Email Triage agent will be deactivated.'))) return;
    try {
      setDisconnecting(true);
      const { data, error } = await supabase.functions.invoke('olive-email-mcp', {
        body: { user_id: userId, action: 'disconnect' }
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(t('email.disconnected', 'Gmail disconnected'));
        setConnection({ connected: false });
      }
    } catch (error: any) {
      console.error('Failed to disconnect email:', error);
      toast.error(error.message || t('email.error', 'Failed to disconnect'));
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
        <div className="flex items-start gap-3 p-3 bg-red-500/5 rounded-lg border border-red-500/10">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <Mail className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-foreground truncate">Gmail</span>
              <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                <Check className="h-3 w-3 mr-1" />
                {t('email.connected', 'Connected')}
              </Badge>
            </div>
            {connection.email && (
              <p className="text-xs text-muted-foreground truncate">{connection.email}</p>
            )}
            {connection.last_sync && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('email.lastSynced', 'Last synced:')} {new Date(connection.last_sync).toLocaleString()}
              </p>
            )}
            {connection.error && (
              <p className="text-xs text-red-600 mt-1">{connection.error}</p>
            )}
          </div>
        </div>

        {/* Privacy note */}
        <div className="flex items-center gap-2 px-1">
          <Shield className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            {t('email.privacyNote', 'Read-only access. No emails stored — only extracted task summaries.')}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-destructive hover:text-destructive"
          >
            {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('email.description', 'Connect your Gmail to let Olive automatically extract actionable tasks from your inbox.')}
      </p>
      <Button onClick={handleConnect} disabled={connecting} className="w-full">
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('email.connecting', 'Connecting...')}
          </>
        ) : (
          <>
            <Mail className="h-4 w-4 mr-2" />
            {t('email.connectButton', 'Connect Gmail')}
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        {t('email.permissionNote', "We'll only request read-only access to your inbox. No emails are stored.")}
      </p>
    </div>
  );
}

export default EmailConnect;
