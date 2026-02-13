import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 24h window (in milliseconds)
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Check if user is within the 24h messaging window
 */
function isWithin24hWindow(lastUserMessageAt: string | null): boolean {
  if (!lastUserMessageAt) return false;
  const lastMsg = new Date(lastUserMessageAt).getTime();
  return (Date.now() - lastMsg) < WINDOW_24H_MS;
}

/**
 * Send a free-form WhatsApp text message via Meta Cloud API
 */
async function sendWhatsAppMessage(to: string, body: string): Promise<boolean> {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error('Meta WhatsApp credentials not configured');
    return false;
  }

  const cleanNumber = to.replace(/\D/g, '');

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'text',
          text: { preview_url: true, body },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Meta Reminders] Send failed:', response.status, errorText);
      return false;
    }

    const data = await response.json();
    console.log('[Meta Reminders] Sent, id:', data.messages?.[0]?.id);
    return true;
  } catch (error) {
    console.error('[Meta Reminders] Error:', error);
    return false;
  }
}

/**
 * Send a template message via Meta Cloud API (for outside 24h window)
 */
async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  parameters: string[],
  language: string = 'en'
): Promise<boolean> {
  const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error('Meta WhatsApp credentials not configured');
    return false;
  }

  const cleanNumber = to.replace(/\D/g, '');

  const components: any[] = [];
  if (parameters.length > 0) {
    components.push({
      type: 'body',
      parameters: parameters.map(text => ({ type: 'text', text })),
    });
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            components,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Meta Reminders] Template send failed:', response.status, errorText);
      return false;
    }

    const data = await response.json();
    console.log('[Meta Reminders] Template sent, id:', data.messages?.[0]?.id);
    return true;
  } catch (error) {
    console.error('[Meta Reminders] Template error:', error);
    return false;
  }
}

/**
 * Smart send: ALWAYS tries free-form text first (free!),
 * only uses paid template ($0.01) when Meta rejects with 131047.
 */
async function smartSendReminder(
  phoneNumber: string,
  reminderText: string,
  displayName: string | null,
  lastUserMessageAt: string | null
): Promise<boolean> {
  // Always try free-form first — it's free
  console.log('[Meta Reminders] Trying free-form text first (cost: $0.00)');
  const sent = await sendWhatsAppMessage(phoneNumber, reminderText);
  if (sent) {
    console.log('[Meta Reminders] Free-form sent — no template cost');
    return true;
  }

  // Free-form failed → use paid template as last resort
  console.log('[Meta Reminders] Free-form failed, using template fallback ($0.01)');
  const name = displayName || 'there';
  const truncated = reminderText.length > 800
    ? reminderText.substring(0, 800) + '...'
    : reminderText;
  const taskTitle = truncated.split('\n')[0].replace(/^⏰\s*/, '').substring(0, 100) || 'Task reminder';

  return sendWhatsAppTemplate(phoneNumber, 'olive_task_reminder', [taskTitle, truncated]);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
    const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

    if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      console.error('Meta WhatsApp credentials not configured');
      return new Response(
        JSON.stringify({ error: 'WhatsApp not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    console.log('Checking for reminders between:', now.toISOString(), 'and', fiveMinutesFromNow.toISOString());

    const { data: explicitReminders, error: notesError } = await supabase
      .from('clerk_notes')
      .select('id, summary, reminder_time, author_id, tags, category, recurrence_frequency, recurrence_interval, last_reminded_at, due_date, auto_reminders_sent')
      .not('reminder_time', 'is', null)
      .lte('reminder_time', fiveMinutesFromNow.toISOString())
      .gte('reminder_time', now.toISOString())
      .eq('completed', false);

    if (notesError) {
      console.error('Error fetching explicit reminders:', notesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch notes' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`Found ${explicitReminders?.length || 0} notes with explicit reminders`);

    // Find notes with due_date for automatic reminders (24h and 2h before)
    const { data: dueDateNotes, error: dueDateError } = await supabase
      .from('clerk_notes')
      .select('id, summary, due_date, author_id, tags, category, auto_reminders_sent')
      .not('due_date', 'is', null)
      .eq('completed', false);

    if (dueDateError) {
      console.error('Error fetching due date notes:', dueDateError);
    }

    console.log(`Found ${dueDateNotes?.length || 0} notes with due dates to check for automatic reminders`);

    // Filter notes that need 24h or 2h reminders
    const autoReminders: any[] = [];
    if (dueDateNotes && dueDateNotes.length > 0) {
      for (const note of dueDateNotes) {
        const dueDate = new Date(note.due_date);
        const timeDiff = dueDate.getTime() - now.getTime();
        const hoursUntilDue = timeDiff / (1000 * 60 * 60);

        const alreadySent = note.auto_reminders_sent || [];

        if (hoursUntilDue >= 23.9 && hoursUntilDue <= 24.1 && !alreadySent.includes('24h')) {
          autoReminders.push({ ...note, reminder_type: '24h', reminder_message: 'in 24 hours' });
        } else if (hoursUntilDue >= 1.9 && hoursUntilDue <= 2.1 && !alreadySent.includes('2h')) {
          autoReminders.push({ ...note, reminder_type: '2h', reminder_message: 'in 2 hours' });
        }
      }
    }

    console.log(`Found ${autoReminders.length} notes needing automatic due date reminders`);

    const allReminders = [...(explicitReminders || []), ...autoReminders];

    if (allReminders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No reminders to send', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;
    const errors: string[] = [];

    // Group notes by author
    const notesByAuthor = allReminders.reduce((acc, note) => {
      if (!note.author_id) return acc;
      if (!acc[note.author_id]) acc[note.author_id] = [];
      acc[note.author_id].push(note);
      return acc;
    }, {} as Record<string, typeof allReminders>);

    for (const [authorId, notes] of Object.entries(notesByAuthor) as [string, typeof allReminders][]) {
      // Fetch profile with 24h window info
      const { data: profile, error: profileError } = await supabase
        .from('clerk_profiles')
        .select('phone_number, display_name, last_user_message_at')
        .eq('id', authorId)
        .single();

      if (profileError || !profile?.phone_number) {
        console.error(`No phone number for user ${authorId}:`, profileError);
        errors.push(`User ${authorId}: No phone number`);
        continue;
      }

      const reminderText = notes.length === 1
        ? `⏰ ${(notes[0] as any).reminder_type ? `Reminder: "${notes[0].summary}" is due ${(notes[0] as any).reminder_message}` : `Here's your reminder: "${notes[0].summary}"`}\n\nLet me know if you have completed it or if you want me to remind you later! 🙂`
        : `⏰ You have ${notes.length} reminders:\n\n${notes.map((n: any, i: number) => `${i + 1}. ${n.summary}${n.reminder_type ? ` (due ${n.reminder_message})` : ''}`).join('\n')}\n\nLet me know which ones you've completed or if you want me to remind you later! 🙂`;

      try {
        // Smart send: template outside 24h window, text inside
        const sent = await smartSendReminder(
          profile.phone_number,
          reminderText,
          profile.display_name,
          profile.last_user_message_at
        );

        if (!sent) {
          errors.push(`User ${authorId}: Meta API error`);
          continue;
        }

        console.log(`Sent reminder to ${profile.phone_number} (${profile.display_name || 'Unknown'})`);
        sentCount++;

        // Handle recurring reminders and mark as reminded
        for (const note of notes as any[]) {
          const updateData: any = {
            last_reminded_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          if (note.reminder_type) {
            const alreadySent = note.auto_reminders_sent || [];
            updateData.auto_reminders_sent = [...alreadySent, note.reminder_type];
            console.log(`Marked ${note.reminder_type} reminder as sent for note ${note.id}`);
          } else if (note.recurrence_frequency && note.recurrence_frequency !== 'none' && note.reminder_time) {
            const currentReminder = new Date(note.reminder_time);
            const interval = note.recurrence_interval || 1;
            let nextReminder = new Date(currentReminder);

            switch (note.recurrence_frequency) {
              case 'daily':
                nextReminder.setDate(nextReminder.getDate() + interval);
                break;
              case 'weekly':
                nextReminder.setDate(nextReminder.getDate() + (7 * interval));
                break;
              case 'monthly':
                nextReminder.setMonth(nextReminder.getMonth() + interval);
                break;
              case 'yearly':
                nextReminder.setFullYear(nextReminder.getFullYear() + interval);
                break;
            }

            updateData.reminder_time = nextReminder.toISOString();
            console.log(`Scheduled next recurring reminder for note ${note.id}: ${nextReminder.toISOString()}`);
          } else if (note.reminder_time) {
            updateData.reminder_time = null;
          }

          await supabase
            .from('clerk_notes')
            .update(updateData)
            .eq('id', note.id);
        }

      } catch (error: unknown) {
        console.error(`Error sending reminder to ${authorId}:`, error);
        errors.push(`User ${authorId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Reminders processed',
        sent: sentCount,
        total: allReminders.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in send-reminders function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
