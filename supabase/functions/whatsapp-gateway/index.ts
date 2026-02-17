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
 * - 24h window detection: free-form text inside window, templates outside
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

interface UserProfile {
  phone_number: string;
  display_name: string | null;
  last_user_message_at: string | null;
}

// ─── Template Configuration ───────────────────────────────────────────────────
// Maps message_type → Meta-approved template name
// These templates must be created and approved in Meta Business Manager first.
const TEMPLATE_MAP: Record<string, string> = {
  morning_briefing: 'olive_daily_summary',
  evening_review: 'olive_evening_review',
  weekly_summary: 'olive_weekly_summary',
  reminder: 'olive_task_reminder',
  task_update: 'olive_task_reminder',
  proactive_nudge: 'olive_daily_summary',
  system_alert: 'olive_welcome',
  partner_notification: 'olive_task_reminder',
};

// 24h window (in milliseconds)
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Check if user is within the 24h messaging window
 * (i.e., they've messaged Olive within the last 24 hours)
 */
function isWithin24hWindow(lastUserMessageAt: string | null): boolean {
  if (!lastUserMessageAt) return false;
  const lastMsg = new Date(lastUserMessageAt).getTime();
  const now = Date.now();
  return (now - lastMsg) < WINDOW_24H_MS;
}

/**
 * Send a free-form WhatsApp text message via Meta Cloud API
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

    console.log('[Meta Gateway] Sending text to:', cleanNumber, 'length:', body.length);

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
 * Send a WhatsApp template message via Meta Cloud API.
 * Used when outside the 24h customer service window.
 *
 * @param to - Recipient phone number
 * @param templateName - Approved template name (e.g., 'olive_daily_summary')
 * @param parameters - Array of string values for {{1}}, {{2}}, etc. in the template body
 * @param language - Template language code (default: 'en')
 */
async function sendMetaTemplateMessage(
  to: string,
  templateName: string,
  parameters: string[],
  language: string = 'en'
): Promise<MetaSendResult> {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return { success: false, error: 'Meta WhatsApp credentials not configured' };
  }

  const cleanNumber = to.replace(/\D/g, '');

  // Build components array with body parameters
  const components: any[] = [];
  if (parameters.length > 0) {
    components.push({
      type: 'body',
      parameters: parameters.map(text => ({ type: 'text', text })),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: cleanNumber,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  try {
    const apiUrl = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    console.log('[Meta Gateway] Sending template:', templateName, 'to:', cleanNumber, 'params:', parameters.length);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Meta Gateway] Template send failed:', response.status, errorText);
      return { success: false, error: `Meta API template ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    const messageId = data.messages?.[0]?.id || '';
    console.log('[Meta Gateway] Template sent, id:', messageId);
    return { success: true, message_id: messageId };
  } catch (error) {
    console.error('[Meta Gateway] Template error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Build template parameters from message type and content.
 * Extracts the user's display name and content summary for template variables.
 */
function buildTemplateParams(
  messageType: MessageType,
  content: string,
  displayName: string | null
): string[] {
  const name = displayName || 'there';
  // Truncate content to fit Meta's 1024 char body limit (leave room for template text)
  const maxContentLen = 800;
  const truncatedContent = content.length > maxContentLen
    ? content.substring(0, maxContentLen) + '...'
    : content;

  switch (messageType) {
    case 'morning_briefing':
    case 'proactive_nudge':
      // olive_daily_summary: {{1}} = name, {{2}} = summary content
      return [name, truncatedContent];

    case 'evening_review':
      // olive_evening_review: {{1}} = name, {{2}} = recap content
      return [name, truncatedContent];

    case 'weekly_summary':
      // olive_weekly_summary: {{1}} = name, {{2}} = summary content
      return [name, truncatedContent];

    case 'reminder':
    case 'task_update':
    case 'partner_notification':
      // olive_task_reminder: {{1}} = task name/summary, {{2}} = details
      return [truncatedContent.split('\n')[0] || 'Task', truncatedContent];

    case 'system_alert':
      // olive_welcome: {{1}} = name
      return [name];

    default:
      return [name, truncatedContent];
  }
}

/**
 * Smart send: ALWAYS tries free-form text first (it's free!),
 * only falls back to paid templates ($0.01/msg) when Meta rejects
 * with error 131047 (outside 24h window).
 *
 * Cost optimization strategy:
 * - Free-form text: $0.00 (works within 24h of last user message)
 * - Template message: $0.01 per message (required outside 24h window)
 * - Always attempt free-form first to minimize template usage
 */
async function smartSend(
  phoneNumber: string,
  message: OutboundMessage,
  displayName: string | null,
  lastUserMessageAt: string | null
): Promise<MetaSendResult> {
  // ALWAYS try free-form text first — it's free
  console.log('[Meta Gateway] Attempting free-form text first (cost: $0.00)');
  const freeFormResult = await sendMetaMessage(phoneNumber, message.content, message.media_url);

  if (freeFormResult.success) {
    console.log('[Meta Gateway] Free-form text sent successfully — no template cost');
    return freeFormResult;
  }

  // Free-form failed — check if it's a 131047 (outside 24h window)
  if (freeFormResult.error?.includes('131047')) {
    // Outside 24h window → must use paid template
    console.log('[Meta Gateway] 131047 error — outside 24h window, using template ($0.01)');
    return sendAsTemplate(phoneNumber, message, displayName);
  }

  // Other error (not window-related) — still try template as last resort
  console.log('[Meta Gateway] Free-form failed with non-window error:', freeFormResult.error);
  console.log('[Meta Gateway] Trying template as fallback');
  const templateResult = await sendAsTemplate(phoneNumber, message, displayName);

  if (templateResult.success) {
    return templateResult;
  }

  // Both failed
  console.error('[Meta Gateway] Both free-form and template failed');
  return freeFormResult; // Return original error
}

/**
 * Send a message using the appropriate Meta template
 */
async function sendAsTemplate(
  phoneNumber: string,
  message: OutboundMessage,
  displayName: string | null
): Promise<MetaSendResult> {
  const templateName = TEMPLATE_MAP[message.message_type];
  if (!templateName) {
    console.error('[Meta Gateway] No template mapped for message_type:', message.message_type);
    // Fall back to olive_welcome as a generic template
    const params = buildTemplateParams('system_alert', message.content, displayName);
    return sendMetaTemplateMessage(phoneNumber, 'olive_welcome', params);
  }

  const params = buildTemplateParams(message.message_type, message.content, displayName);
  return sendMetaTemplateMessage(phoneNumber, templateName, params);
}

/**
 * Check if current time is within quiet hours for a user (timezone-aware)
 */
async function isQuietHours(supabase: any, userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('olive_user_preferences')
      .select('quiet_hours_start, quiet_hours_end, timezone')
      .eq('user_id', userId)
      .single();

    if (!data?.quiet_hours_start || !data?.quiet_hours_end) return false;

    // Get user's local hour using their timezone
    let currentH: number;
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: data.timezone || 'UTC',
        hour: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date());
      currentH = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    } catch {
      currentH = new Date().getUTCHours();
    }

    const startH = parseInt(data.quiet_hours_start.toString().split(':')[0]);
    const endH = parseInt(data.quiet_hours_end.toString().split(':')[0]);

    if (startH < endH) {
      return currentH >= startH && currentH < endH;
    } else {
      // Wraps midnight (e.g. 22:00 – 07:00)
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
 * Get user's profile including phone number and 24h window info
 */
async function getUserProfile(supabase: any, userId: string): Promise<UserProfile | null> {
  // Try with last_user_message_at first, fall back without it if column doesn't exist yet
  let { data: profile, error } = await supabase
    .from('clerk_profiles')
    .select('phone_number, display_name, last_user_message_at')
    .eq('id', userId)
    .single();

  if (error && error.code === '42703') {
    // Column doesn't exist yet — query without it
    console.log('[getUserProfile] last_user_message_at column not found, querying without it');
    const fallback = await supabase
      .from('clerk_profiles')
      .select('phone_number, display_name')
      .eq('id', userId)
      .single();
    profile = fallback.data;
    error = fallback.error;
  }

  if (error || !profile?.phone_number) {
    console.error('Failed to get user profile:', error);
    return null;
  }

  return {
    phone_number: profile.phone_number,
    display_name: profile.display_name,
    last_user_message_at: profile.last_user_message_at || null,
  };
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
  status: string,
  phoneNumber?: string
): Promise<void> {
  // Primary: Store last outbound context in clerk_profiles (reliable, no schema issues)
  const outboundContext = {
    message_type: messageType,
    content: content.substring(0, 500),
    sent_at: new Date().toISOString(),
    status,
  };

  const { error: profileErr } = await supabase
    .from('clerk_profiles')
    .update({ last_outbound_context: outboundContext })
    .eq('id', userId);

  if (profileErr) {
    console.error('[Gateway] Failed to save outbound context to profile:', profileErr.message);
  } else {
    console.log('[Gateway] Saved outbound context to profile:', messageType, 'for user', userId);
  }

  // Secondary: Also try olive_outbound_queue (may fail due to schema constraints)
  const { error } = await supabase.from('olive_outbound_queue').insert({
    user_id: userId,
    message_type: messageType,
    content,
    phone_number: phoneNumber || null,
    status: status === 'sent' ? 'sent' : 'failed',
    sent_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[Gateway] olive_outbound_queue insert failed (non-critical):', error.message);
  }
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

      const userProfile = await getUserProfile(supabase, msg.user_id);
      if (!userProfile) {
        await supabase.from('olive_outbound_queue').update({ status: 'failed', error_message: 'No phone number' }).eq('id', msg.id);
        errors++;
        continue;
      }

      // Use smart send: free-form text inside 24h window, template outside
      const result = await smartSend(
        userProfile.phone_number,
        msg,
        userProfile.display_name,
        userProfile.last_user_message_at
      );

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
 * Send a message immediately (with all checks + 24h window auto-detection)
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

  const userProfile = await getUserProfile(supabase, message.user_id);
  if (!userProfile) {
    return { success: false, error: 'User has no WhatsApp number linked' };
  }

  // Smart send: auto-detect 24h window → text or template
  const result = await smartSend(
    userProfile.phone_number,
    message,
    userProfile.display_name,
    userProfile.last_user_message_at
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  await logOutboundMessage(
    supabase,
    message.user_id,
    message.message_type,
    message.content,
    result.message_id || '',
    'sent',
    userProfile.phone_number
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
