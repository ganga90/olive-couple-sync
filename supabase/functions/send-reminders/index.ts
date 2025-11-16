import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_WHATSAPP_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER'); // WhatsApp number format

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
      console.error('Twilio credentials not configured');
      return new Response(
        JSON.stringify({ error: 'Twilio not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find notes that are due now (within the next 5 minutes) and haven't been reminded yet
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    console.log('Checking for reminders between:', now.toISOString(), 'and', fiveMinutesFromNow.toISOString());

    const { data: dueNotes, error: notesError } = await supabase
      .from('clerk_notes')
      .select('id, summary, due_date, author_id, tags, category')
      .lte('due_date', fiveMinutesFromNow.toISOString())
      .gte('due_date', now.toISOString())
      .eq('completed', false)
      .is('tags', null)
      .or('tags.not.cs.{reminded}');

    if (notesError) {
      console.error('Error fetching due notes:', notesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch notes' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`Found ${dueNotes?.length || 0} notes due for reminders`);

    if (!dueNotes || dueNotes.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No reminders to send', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;
    const errors: string[] = [];

    // Group notes by author to batch reminders per user
    const notesByAuthor = dueNotes.reduce((acc, note) => {
      if (!note.author_id) return acc;
      if (!acc[note.author_id]) acc[note.author_id] = [];
      acc[note.author_id].push(note);
      return acc;
    }, {} as Record<string, typeof dueNotes>);

    for (const [authorId, notes] of Object.entries(notesByAuthor)) {
      // Get user's phone number
      const { data: profile, error: profileError } = await supabase
        .from('clerk_profiles')
        .select('phone_number, display_name')
        .eq('id', authorId)
        .single();

      if (profileError || !profile?.phone_number) {
        console.error(`No phone number for user ${authorId}:`, profileError);
        errors.push(`User ${authorId}: No phone number`);
        continue;
      }

      // Prepare reminder message
      const reminderText = notes.length === 1
        ? `⏰ Reminder: ${notes[0].summary}`
        : `⏰ You have ${notes.length} reminders:\n\n${notes.map((n, i) => `${i + 1}. ${n.summary}`).join('\n')}`;

      // Send WhatsApp message via Twilio
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

        const formData = new URLSearchParams();
        formData.append('From', TWILIO_WHATSAPP_NUMBER);
        formData.append('To', profile.phone_number);
        formData.append('Body', reminderText);

        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${twilioAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });

        if (!twilioResponse.ok) {
          const errorText = await twilioResponse.text();
          console.error(`Failed to send WhatsApp to ${profile.phone_number}:`, errorText);
          errors.push(`User ${authorId}: Twilio error`);
          continue;
        }

        console.log(`Sent reminder to ${profile.phone_number} (${profile.display_name || 'Unknown'})`);
        sentCount++;

        // Mark notes as reminded by adding 'reminded' tag
        for (const note of notes) {
          const currentTags = note.tags || [];
          await supabase
            .from('clerk_notes')
            .update({ 
              tags: [...currentTags, 'reminded'],
              updated_at: new Date().toISOString()
            })
            .eq('id', note.id);
        }

      } catch (error) {
        console.error(`Error sending reminder to ${authorId}:`, error);
        errors.push(`User ${authorId}: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'Reminders processed', 
        sent: sentCount,
        total: dueNotes.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-reminders function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
