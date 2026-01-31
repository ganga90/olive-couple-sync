/**
 * WhatsApp Gateway Service
 *
 * Handles outbound messaging from Olive to users via WhatsApp.
 * Supports proactive messages, reminders, and scheduled notifications.
 *
 * Features:
 * - Session-aware messaging with context preservation
 * - Quiet hours enforcement
 * - Rate limiting (max messages per day)
 * - Message queuing and delivery tracking
 * - Template message support for re-engagement
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Message types for the gateway
type MessageType =
  | 'reminder'
  | 'proactive_nudge'
  | 'morning_briefing'
  | 'evening_review'
  | 'weekly_summary'
  | 'task_update'
  | 'partner_notification'
  | 'system_alert';

interface OutboundMessage {
  user_id: string;
  message_type: MessageType;
  content: string;
  media_url?: string;
  scheduled_for?: string; // ISO timestamp
  metadata?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high';
}

interface GatewayRequest {
  action: 'send' | 'queue' | 'process_queue' | 'check_delivery' | 'get_session';
  message?: OutboundMessage;
  user_id?: string;
  message_id?: string;
}

interface TwilioResponse {
  sid: string;
  status: string;
  error_code?: number;
  error_message?: string;
}

/**
 * Send a WhatsApp message via Twilio
 */
async function sendTwilioMessage(
  to: string,
  body: string,
  mediaUrl?: string
): Promise<TwilioResponse> {
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') || '+18556864055';

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials not configured');
  }

  const params = new URLSearchParams();
  params.append('To', `whatsapp:${to}`);
  params.append('From', `whatsapp:${TWILIO_PHONE_NUMBER}`);
  params.append('Body', body);

  if (mediaUrl) {
    params.append('MediaUrl', mediaUrl);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('Twilio API error:', data);
    return {
      sid: '',
      status: 'failed',
      error_code: data.code,
      error_message: data.message,
    };
  }

  return {
    sid: data.sid,
    status: data.status,
  };
}

/**
 * Check if current time is within quiet hours for a user
 */
async function isQuietHours(supabase: any, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_quiet_hours', {
    p_user_id: userId
  });

  if (error) {
    console.error('Error checking quiet hours:', error);
    // Default to allowing messages if check fails
    return false;
  }

  return data === true;
}

/**
 * Check if user can receive a proactive message (rate limiting)
 */
async function canSendProactive(supabase: any, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_send_proactive', {
    p_user_id: userId
  });

  if (error) {
    console.error('Error checking proactive limit:', error);
    return false;
  }

  return data === true;
}

/**
 * Get user's phone number from their profile
 */
async function getUserPhoneNumber(supabase: any, userId: string): Promise<string | null> {
  const { data: profile, error } = await supabase
    .from('clerk_profiles')
    .select('phone_number')
    .eq('id', userId)
    .single();

  if (error || !profile?.phone_number) {
    console.error('Failed to get user phone number:', error);
    return null;
  }

  return profile.phone_number;
}

/**
 * Get or create a gateway session for user
 */
async function getOrCreateSession(
  supabase: any,
  userId: string,
  channel: string = 'whatsapp'
): Promise<any> {
  // First try to get existing active session
  const { data: existingSession } = await supabase
    .from('olive_gateway_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('is_active', true)
    .order('last_activity', { ascending: false })
    .limit(1)
    .single();

  if (existingSession) {
    return existingSession;
  }

  // Create new session
  const { data: newSession, error } = await supabase
    .from('olive_gateway_sessions')
    .insert({
      user_id: userId,
      channel,
      conversation_context: {},
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating session:', error);
    throw error;
  }

  return newSession;
}

/**
 * Log outbound message for tracking and analytics
 */
async function logOutboundMessage(
  supabase: any,
  userId: string,
  messageType: MessageType,
  content: string,
  twilioSid: string,
  status: string
): Promise<void> {
  await supabase.from('olive_outbound_queue').insert({
    user_id: userId,
    message_type: messageType,
    content,
    twilio_sid: twilioSid,
    status: status === 'queued' || status === 'sent' ? 'sent' : 'failed',
    sent_at: new Date().toISOString(),
  });
}

/**
 * Queue a message for later delivery
 */
async function queueMessage(
  supabase: any,
  message: OutboundMessage
): Promise<string> {
  const { data, error } = await supabase
    .from('olive_outbound_queue')
    .insert({
      user_id: message.user_id,
      message_type: message.message_type,
      content: message.content,
      media_url: message.media_url,
      scheduled_for: message.scheduled_for || new Date().toISOString(),
      metadata: message.metadata || {},
      priority: message.priority || 'normal',
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error queuing message:', error);
    throw error;
  }

  return data.id;
}

/**
 * Process queued messages that are ready to send
 */
async function processQueue(supabase: any): Promise<{ processed: number; errors: number }> {
  // Get pending messages that are scheduled for now or earlier
  const { data: pendingMessages, error } = await supabase
    .from('olive_outbound_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('priority', { ascending: false }) // high priority first
    .order('scheduled_for', { ascending: true })
    .limit(50);

  if (error) {
    console.error('Error fetching queue:', error);
    return { processed: 0, errors: 1 };
  }

  if (!pendingMessages || pendingMessages.length === 0) {
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const msg of pendingMessages) {
    try {
      // Check quiet hours for non-high-priority messages
      if (msg.priority !== 'high') {
        const inQuietHours = await isQuietHours(supabase, msg.user_id);
        if (inQuietHours) {
          // Reschedule for after quiet hours (next day 7am)
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(7, 0, 0, 0);

          await supabase
            .from('olive_outbound_queue')
            .update({ scheduled_for: tomorrow.toISOString() })
            .eq('id', msg.id);

          continue;
        }
      }

      // Check rate limiting for proactive messages
      if (['proactive_nudge', 'morning_briefing', 'evening_review'].includes(msg.message_type)) {
        const canSend = await canSendProactive(supabase, msg.user_id);
        if (!canSend) {
          await supabase
            .from('olive_outbound_queue')
            .update({ status: 'rate_limited' })
            .eq('id', msg.id);

          continue;
        }
      }

      // Get user's phone number
      const phoneNumber = await getUserPhoneNumber(supabase, msg.user_id);
      if (!phoneNumber) {
        await supabase
          .from('olive_outbound_queue')
          .update({ status: 'failed', error: 'No phone number' })
          .eq('id', msg.id);

        errors++;
        continue;
      }

      // Send the message
      const result = await sendTwilioMessage(phoneNumber, msg.content, msg.media_url);

      if (result.status === 'failed') {
        await supabase
          .from('olive_outbound_queue')
          .update({
            status: 'failed',
            error: result.error_message,
            twilio_sid: result.sid,
          })
          .eq('id', msg.id);

        errors++;
      } else {
        await supabase
          .from('olive_outbound_queue')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            twilio_sid: result.sid,
          })
          .eq('id', msg.id);

        // Log to heartbeat for proactive messages
        if (['proactive_nudge', 'morning_briefing', 'evening_review', 'weekly_summary'].includes(msg.message_type)) {
          await supabase.from('olive_heartbeat_log').insert({
            user_id: msg.user_id,
            job_type: msg.message_type,
            status: 'sent',
            message_preview: msg.content.substring(0, 200),
            channel: 'whatsapp',
          });
        }

        processed++;
      }
    } catch (err) {
      console.error('Error processing message:', err);
      errors++;

      await supabase
        .from('olive_outbound_queue')
        .update({ status: 'failed', error: String(err) })
        .eq('id', msg.id);
    }
  }

  return { processed, errors };
}

/**
 * Send a message immediately (with all checks)
 */
async function sendMessage(
  supabase: any,
  message: OutboundMessage
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  // Check quiet hours for non-high-priority messages
  if (message.priority !== 'high') {
    const inQuietHours = await isQuietHours(supabase, message.user_id);
    if (inQuietHours) {
      // Queue for later instead of sending now
      const queueId = await queueMessage(supabase, {
        ...message,
        scheduled_for: undefined, // Will be set to next morning
      });
      return { success: true, message_id: queueId };
    }
  }

  // Check rate limiting for proactive messages
  if (['proactive_nudge', 'morning_briefing', 'evening_review'].includes(message.message_type)) {
    const canSend = await canSendProactive(supabase, message.user_id);
    if (!canSend) {
      return { success: false, error: 'Rate limit exceeded for proactive messages' };
    }
  }

  // Get user's phone number
  const phoneNumber = await getUserPhoneNumber(supabase, message.user_id);
  if (!phoneNumber) {
    return { success: false, error: 'User has no WhatsApp number linked' };
  }

  // Send the message
  const result = await sendTwilioMessage(phoneNumber, message.content, message.media_url);

  if (result.status === 'failed') {
    return { success: false, error: result.error_message };
  }

  // Log the message
  await logOutboundMessage(
    supabase,
    message.user_id,
    message.message_type,
    message.content,
    result.sid,
    result.status
  );

  return { success: true, message_id: result.sid };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: GatewayRequest = await req.json();
    const { action } = body;

    switch (action) {
      case 'send': {
        if (!body.message) {
          return new Response(
            JSON.stringify({ success: false, error: 'Message required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const result = await sendMessage(supabase, body.message);
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'queue': {
        if (!body.message) {
          return new Response(
            JSON.stringify({ success: false, error: 'Message required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const queueId = await queueMessage(supabase, body.message);
        return new Response(
          JSON.stringify({ success: true, queue_id: queueId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'process_queue': {
        const result = await processQueue(supabase);
        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_session': {
        if (!body.user_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const session = await getOrCreateSession(supabase, body.user_id);
        return new Response(
          JSON.stringify({ success: true, session }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check_delivery': {
        if (!body.message_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'message_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check delivery status from Twilio
        const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
        const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages/${body.message_id}.json`,
          {
            headers: {
              'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
            },
          }
        );

        const data = await response.json();
        return new Response(
          JSON.stringify({ success: true, status: data.status, error_code: data.error_code }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Gateway error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
