/**
 * WhatsApp Gateway Service
 *
 * Handles outbound messaging from Olive to users via WhatsApp.
 * Uses Meta WhatsApp Business Cloud API (direct integration).
 *
 * Features:
 * - Session-aware messaging with context preservation
 * - Quiet hours enforcement
 * - Rate limiting (max messages per day)
 * - Message queuing and delivery tracking
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
  scheduled_for?: string;
  metadata?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high';
}

interface GatewayRequest {
  action: 'send' | 'queue' | 'process_queue' | 'check_delivery' | 'get_session';
  message?: OutboundMessage;
  user_id?: string;
  message_id?: string;
}

interface MetaSendResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

/**
 * Send a WhatsApp message via Meta Cloud API
 */
async function sendMetaMessage(
  to: string,
  body: string,
  mediaUrl?: string
): Promise<MetaSendResult> {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return { success: false, error: 'Meta WhatsApp credentials not configured' };
  }

  // Normalize phone number: Meta expects raw digits without + prefix
  const cleanNumber = to.replace(/\D/g, '');

  let payload: any;

  if (mediaUrl) {
    payload = {
      messaging_product: 'whatsapp',
      to: cleanNumber,
      type: 'image',
      image: {
        link: mediaUrl,
        caption: body
      }
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: cleanNumber,
      type: 'text',
      text: {
        preview_url: true,
        body
      }
    };
  }

  try {
    const apiUrl = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    console.log('[Meta Gateway] Sending to:', cleanNumber, 'length:', body.length);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Meta Gateway] Send failed:', response.status, errorText);
      return { success: false, error: `Meta API ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    const messageId = data.messages?.[0]?.id || '';
    console.log('[Meta Gateway] Message sent, id:', messageId);
    return { success: true, message_id: messageId };
  } catch (error) {
    console.error('[Meta Gateway] Error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Check if current time is within quiet hours for a user
 */
async function isQuietHours(supabase: any, userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('olive_user_preferences')
      .select('quiet_hours_start, quiet_hours_end, timezone')
      .eq('user_id', userId)
      .single();

    if (!data?.quiet_hours_start || !data?.quiet_hours_end) return false;

    const now = new Date();
    const startH = parseInt(data.quiet_hours_start.split(':')[0]);
    const endH = parseInt(data.quiet_hours_end.split(':')[0]);
    const currentH = now.getUTCHours(); // simplified; ideally timezone-aware

    if (startH < endH) {
      return currentH >= startH && currentH < endH;
    } else {
      return currentH >= startH || currentH < endH;
    }
  } catch {
    return false;
  }
}

/**
 * Check rate limiting for proactive messages
 */
async function canSendProactive(supabase: any, userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('olive_user_preferences')
      .select('max_daily_messages, proactive_enabled')
      .eq('user_id', userId)
      .single();

    if (!data?.proactive_enabled) return false;

    const maxDaily = data.max_daily_messages || 5;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from('olive_outbound_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .gte('sent_at', today.toISOString());

    return (count || 0) < maxDaily;
  } catch {
    return true; // allow by default
  }
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
  const { data: existingSession } = await supabase
    .from('olive_gateway_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('is_active', true)
    .order('last_activity', { ascending: false })
    .limit(1)
    .single();

  if (existingSession) return existingSession;

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
 * Log outbound message
 */
async function logOutboundMessage(
  supabase: any,
  userId: string,
  messageType: MessageType,
  content: string,
  metaMessageId: string,
  status: string
): Promise<void> {
  await supabase.from('olive_outbound_queue').insert({
    user_id: userId,
    message_type: messageType,
    content,
    status: status === 'sent' ? 'sent' : 'failed',
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
 * Process queued messages
 */
async function processQueue(supabase: any): Promise<{ processed: number; errors: number }> {
  const { data: pendingMessages, error } = await supabase
    .from('olive_outbound_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('priority', { ascending: false })
    .order('scheduled_for', { ascending: true })
    .limit(50);

  if (error || !pendingMessages?.length) {
    return { processed: 0, errors: error ? 1 : 0 };
  }

  let processed = 0;
  let errors = 0;

  for (const msg of pendingMessages) {
    try {
      if (msg.priority !== 'high') {
        const inQuiet = await isQuietHours(supabase, msg.user_id);
        if (inQuiet) {
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

      if (['proactive_nudge', 'morning_briefing', 'evening_review'].includes(msg.message_type)) {
        const canSend = await canSendProactive(supabase, msg.user_id);
        if (!canSend) {
          await supabase.from('olive_outbound_queue').update({ status: 'rate_limited' }).eq('id', msg.id);
          continue;
        }
      }

      const phoneNumber = await getUserPhoneNumber(supabase, msg.user_id);
      if (!phoneNumber) {
        await supabase.from('olive_outbound_queue').update({ status: 'failed', error_message: 'No phone number' }).eq('id', msg.id);
        errors++;
        continue;
      }

      const result = await sendMetaMessage(phoneNumber, msg.content, msg.media_url);

      if (!result.success) {
        await supabase.from('olive_outbound_queue')
          .update({ status: 'failed', error_message: result.error })
          .eq('id', msg.id);
        errors++;
      } else {
        await supabase.from('olive_outbound_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', msg.id);

        if (['proactive_nudge', 'morning_briefing', 'evening_review', 'weekly_summary'].includes(msg.message_type)) {
          await supabase.from('olive_heartbeat_log').insert({
            user_id: msg.user_id,
            job_type: msg.message_type,
            status: 'sent',
            message_preview: msg.content.substring(0, 200),
          });
        }
        processed++;
      }
    } catch (err) {
      console.error('Error processing message:', err);
      errors++;
      await supabase.from('olive_outbound_queue')
        .update({ status: 'failed', error_message: String(err) })
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
  if (message.priority !== 'high') {
    const inQuiet = await isQuietHours(supabase, message.user_id);
    if (inQuiet) {
      const queueId = await queueMessage(supabase, message);
      return { success: true, message_id: queueId };
    }
  }

  if (['proactive_nudge', 'morning_briefing', 'evening_review'].includes(message.message_type)) {
    const canSend = await canSendProactive(supabase, message.user_id);
    if (!canSend) {
      return { success: false, error: 'Rate limit exceeded for proactive messages' };
    }
  }

  const phoneNumber = await getUserPhoneNumber(supabase, message.user_id);
  if (!phoneNumber) {
    return { success: false, error: 'User has no WhatsApp number linked' };
  }

  const result = await sendMetaMessage(phoneNumber, message.content, message.media_url);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  await logOutboundMessage(
    supabase,
    message.user_id,
    message.message_type,
    message.content,
    result.message_id || '',
    'sent'
  );

  return { success: true, message_id: result.message_id };
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
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
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

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
  } catch (error) {
    console.error('Gateway error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
