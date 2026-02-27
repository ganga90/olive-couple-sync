import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, action, tasklist_id, task_title, task_notes, task_due } = await req.json();

    if (!user_id) throw new Error('Missing user_id');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user's calendar connection (which holds the Google OAuth token)
    const { data: connection, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (connError) throw new Error('Failed to fetch connection');

    if (!connection) {
      return json({ success: false, error: 'No Google account connected' });
    }

    if (!connection.tasks_enabled) {
      return json({ success: false, error: 'Google Tasks not enabled. Please reconnect your Google account.' });
    }

    // Refresh token if needed
    let accessToken = connection.access_token;
    const tokenExpiry = new Date(connection.token_expiry).getTime();

    if (tokenExpiry - Date.now() < 5 * 60 * 1000) {
      const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
      const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          refresh_token: connection.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenResponse.ok) {
        await supabase
          .from("calendar_connections")
          .update({ is_active: false, error_message: "Token refresh failed" })
          .eq("id", connection.id);
        throw new Error('Token refresh failed - please reconnect');
      }

      const newTokens = await tokenResponse.json();
      accessToken = newTokens.access_token;

      await supabase
        .from("calendar_connections")
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
          error_message: null,
        })
        .eq("id", connection.id);
    }

    // === ACTION: status ===
    if (action === 'status') {
      return json({
        success: true,
        tasks_enabled: connection.tasks_enabled,
        email: connection.google_email,
      });
    }

    // === ACTION: list_tasklists ===
    if (action === 'list_tasklists') {
      const res = await fetch(`${TASKS_API}/users/@me/lists`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[google-tasks] Failed to list task lists:', errText);
        throw new Error('Failed to list task lists');
      }

      const data = await res.json();
      const tasklists = (data.items || []).map((tl: any) => ({
        id: tl.id,
        title: tl.title,
        updated: tl.updated,
      }));

      return json({ success: true, tasklists });
    }

    // === ACTION: create_task ===
    if (action === 'create_task') {
      if (!task_title) throw new Error('Missing task_title');

      const targetList = tasklist_id || '@default';

      const taskBody: any = {
        title: task_title,
        status: 'needsAction',
      };

      if (task_notes) taskBody.notes = task_notes;
      if (task_due) {
        // Google Tasks expects RFC 3339 date (due is date-only: YYYY-MM-DDT00:00:00.000Z)
        const dueDate = new Date(task_due);
        taskBody.due = dueDate.toISOString();
      }

      console.log('[google-tasks] Creating task:', task_title, 'in list:', targetList);

      const res = await fetch(`${TASKS_API}/lists/${encodeURIComponent(targetList)}/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskBody),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[google-tasks] Failed to create task:', errText);
        throw new Error('Failed to create task in Google Tasks');
      }

      const createdTask = await res.json();
      console.log('[google-tasks] Task created:', createdTask.id);

      return json({
        success: true,
        task: {
          id: createdTask.id,
          title: createdTask.title,
          status: createdTask.status,
          due: createdTask.due,
          selfLink: createdTask.selfLink,
          html_link: `https://tasks.google.com`,
        },
      });
    }

    return json({ success: false, error: 'Unknown action' });

  } catch (error: unknown) {
    console.error('[google-tasks] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
