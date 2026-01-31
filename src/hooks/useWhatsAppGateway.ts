/**
 * WhatsApp Gateway Hook
 *
 * React hook for interacting with the WhatsApp gateway service.
 * Enables outbound messaging, session management, and delivery tracking.
 */

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

// Message types supported by the gateway
export type MessageType =
  | 'reminder'
  | 'proactive_nudge'
  | 'morning_briefing'
  | 'evening_review'
  | 'weekly_summary'
  | 'task_update'
  | 'partner_notification'
  | 'system_alert';

export interface OutboundMessage {
  user_id: string;
  message_type: MessageType;
  content: string;
  media_url?: string;
  scheduled_for?: string;
  metadata?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high';
}

export interface GatewaySession {
  id: string;
  user_id: string;
  channel: string;
  conversation_context: Record<string, any>;
  is_active: boolean;
  last_activity: string;
  created_at: string;
}

export interface SendResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

interface UseWhatsAppGatewayReturn {
  isLoading: boolean;
  error: Error | null;

  // Send messages
  sendMessage: (message: Omit<OutboundMessage, 'user_id'>) => Promise<SendResult>;
  sendToUser: (userId: string, message: Omit<OutboundMessage, 'user_id'>) => Promise<SendResult>;

  // Queue messages for later
  queueMessage: (message: Omit<OutboundMessage, 'user_id'>) => Promise<string>;
  queueForUser: (userId: string, message: Omit<OutboundMessage, 'user_id'>) => Promise<string>;

  // Session management
  getSession: () => Promise<GatewaySession | null>;

  // Delivery tracking
  checkDelivery: (messageId: string) => Promise<{ status: string; error_code?: number }>;

  // Helper methods for common message types
  sendReminder: (taskSummary: string, dueInfo?: string) => Promise<SendResult>;
  sendTaskUpdate: (updateMessage: string) => Promise<SendResult>;
  sendPartnerNotification: (message: string, partnerId: string) => Promise<SendResult>;
}

/**
 * Call the whatsapp-gateway edge function
 */
async function callGatewayService(action: string, params: Record<string, any> = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await supabase.functions.invoke('whatsapp-gateway', {
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
 * Hook for WhatsApp Gateway operations
 */
export function useWhatsAppGateway(): UseWhatsAppGatewayReturn {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Send a message to the current user
   */
  const sendMessage = useCallback(
    async (message: Omit<OutboundMessage, 'user_id'>): Promise<SendResult> => {
      if (!user?.id) {
        return { success: false, error: 'User not authenticated' };
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await callGatewayService('send', {
          message: { ...message, user_id: user.id },
        });

        return result;
      } catch (err) {
        const error = err as Error;
        setError(error);
        return { success: false, error: error.message };
      } finally {
        setIsLoading(false);
      }
    },
    [user?.id]
  );

  /**
   * Send a message to a specific user (for admin/partner notifications)
   */
  const sendToUser = useCallback(
    async (userId: string, message: Omit<OutboundMessage, 'user_id'>): Promise<SendResult> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await callGatewayService('send', {
          message: { ...message, user_id: userId },
        });

        return result;
      } catch (err) {
        const error = err as Error;
        setError(error);
        return { success: false, error: error.message };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /**
   * Queue a message for later delivery
   */
  const queueMessage = useCallback(
    async (message: Omit<OutboundMessage, 'user_id'>): Promise<string> => {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const result = await callGatewayService('queue', {
        message: { ...message, user_id: user.id },
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to queue message');
      }

      return result.queue_id;
    },
    [user?.id]
  );

  /**
   * Queue a message for a specific user
   */
  const queueForUser = useCallback(
    async (userId: string, message: Omit<OutboundMessage, 'user_id'>): Promise<string> => {
      const result = await callGatewayService('queue', {
        message: { ...message, user_id: userId },
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to queue message');
      }

      return result.queue_id;
    },
    []
  );

  /**
   * Get the current user's gateway session
   */
  const getSession = useCallback(async (): Promise<GatewaySession | null> => {
    if (!user?.id) {
      return null;
    }

    try {
      const result = await callGatewayService('get_session', {
        user_id: user.id,
      });

      return result.success ? result.session : null;
    } catch (err) {
      console.error('Failed to get session:', err);
      return null;
    }
  }, [user?.id]);

  /**
   * Check delivery status of a sent message
   */
  const checkDelivery = useCallback(
    async (messageId: string): Promise<{ status: string; error_code?: number }> => {
      const result = await callGatewayService('check_delivery', {
        message_id: messageId,
      });

      return {
        status: result.status || 'unknown',
        error_code: result.error_code,
      };
    },
    []
  );

  /**
   * Send a reminder message
   */
  const sendReminder = useCallback(
    async (taskSummary: string, dueInfo?: string): Promise<SendResult> => {
      const content = dueInfo
        ? `⏰ Reminder: ${taskSummary}\n📅 ${dueInfo}\n\nReply "done" to mark complete or "snooze" for later.`
        : `⏰ Reminder: ${taskSummary}\n\nReply "done" to mark complete or "snooze" for later.`;

      return sendMessage({
        message_type: 'reminder',
        content,
        priority: 'normal',
      });
    },
    [sendMessage]
  );

  /**
   * Send a task update notification
   */
  const sendTaskUpdate = useCallback(
    async (updateMessage: string): Promise<SendResult> => {
      return sendMessage({
        message_type: 'task_update',
        content: `📝 Task Update\n\n${updateMessage}`,
        priority: 'low',
      });
    },
    [sendMessage]
  );

  /**
   * Send a notification to partner
   */
  const sendPartnerNotification = useCallback(
    async (message: string, partnerId: string): Promise<SendResult> => {
      return sendToUser(partnerId, {
        message_type: 'partner_notification',
        content: `💑 From your partner:\n\n${message}`,
        priority: 'normal',
      });
    },
    [sendToUser]
  );

  return {
    isLoading,
    error,
    sendMessage,
    sendToUser,
    queueMessage,
    queueForUser,
    getSession,
    checkDelivery,
    sendReminder,
    sendTaskUpdate,
    sendPartnerNotification,
  };
}

export default useWhatsAppGateway;
