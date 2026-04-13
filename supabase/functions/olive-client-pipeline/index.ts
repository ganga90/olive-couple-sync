/**
 * Olive Client Pipeline — Client Lifecycle Management
 *
 * Manages clients through stages: lead → prospect → active → completed/lost.
 * Supports follow-ups, notes, value tracking, and pipeline analytics.
 *
 * Actions:
 * - create: Create a new client
 * - update: Update client details (including stage transitions)
 * - get: Get a single client with activity history
 * - list: List clients for a space (filterable by stage, search)
 * - add_activity: Log an activity against a client
 * - pipeline_stats: Get pipeline analytics for a space
 * - follow_ups: Get clients with upcoming/overdue follow-ups
 * - archive: Archive a client
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action } = body;

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = null;
    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    switch (action) {
      case "create":
        return json(await createClient_(supabase, body, userId));
      case "update":
        return json(await updateClient(supabase, body, userId));
      case "get":
        return json(await getClient(supabase, body));
      case "list":
        return json(await listClients(supabase, body));
      case "add_activity":
        return json(await addActivity(supabase, body, userId));
      case "pipeline_stats":
        return json(await pipelineStats(supabase, body));
      case "follow_ups":
        return json(await getFollowUps(supabase, body));
      case "archive":
        return json(await archiveClient(supabase, body, userId));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-client-pipeline error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── Create Client ───────────────────────────────────────────

async function createClient_(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { space_id, name, email, phone, company, source, estimated_value, currency, tags, notes } = body;
  if (!space_id || !name) return { error: "space_id and name required" };

  const { data, error } = await supabase
    .from("olive_clients")
    .insert({
      space_id,
      user_id: userId,
      name,
      email: email || null,
      phone: phone || null,
      company: company || null,
      stage: "lead",
      source: source || null,
      estimated_value: estimated_value || null,
      currency: currency || "USD",
      tags: tags || [],
      notes: notes || null,
    })
    .select()
    .single();

  if (error) throw error;

  // Log initial activity
  await supabase.from("olive_client_activity").insert({
    client_id: data.id,
    user_id: userId,
    activity_type: "stage_change",
    to_value: "lead",
    description: "Client created",
  });

  // Log engagement event
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "client_created",
    metadata: { client_id: data.id, space_id, source },
  }).catch(() => {});

  return { success: true, client: data };
}

// ─── Update Client ───────────────────────────────────────────

async function updateClient(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { client_id, ...updates } = body;
  if (!client_id) return { error: "client_id required" };

  // Remove non-updatable fields
  delete updates.action;
  delete updates.id;
  delete updates.created_at;
  delete updates.space_id;

  const { data, error } = await supabase
    .from("olive_clients")
    .update(updates)
    .eq("id", client_id)
    .select()
    .single();

  if (error) throw error;

  // Log stage change engagement event
  if (updates.stage) {
    await supabase.from("olive_engagement_events").insert({
      user_id: userId,
      event_type: "client_stage_changed",
      metadata: { client_id, new_stage: updates.stage },
    }).catch(() => {});
  }

  return { success: true, client: data };
}

// ─── Get Client with Activity ────────────────────────────────

async function getClient(supabase: any, body: any) {
  const { client_id } = body;
  if (!client_id) return { error: "client_id required" };

  const [clientResult, activityResult] = await Promise.all([
    supabase
      .from("olive_clients")
      .select("*")
      .eq("id", client_id)
      .single(),
    supabase
      .from("olive_client_activity")
      .select("*")
      .eq("client_id", client_id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (clientResult.error) throw clientResult.error;

  return {
    client: clientResult.data,
    activity: activityResult.data || [],
  };
}

// ─── List Clients ────────────────────────────────────────────

async function listClients(supabase: any, body: any) {
  const { space_id, stage, search, limit = 50, offset = 0 } = body;
  if (!space_id) return { error: "space_id required" };

  let query = supabase
    .from("olive_clients")
    .select("*", { count: "exact" })
    .eq("space_id", space_id)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (stage) query = query.eq("stage", stage);
  if (search) query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, count, error } = await query;
  if (error) throw error;

  return { clients: data, total: count };
}

// ─── Add Activity ────────────────────────────────────────────

async function addActivity(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { client_id, activity_type, description, from_value, to_value, metadata } = body;
  if (!client_id || !activity_type) return { error: "client_id and activity_type required" };

  const { data, error } = await supabase
    .from("olive_client_activity")
    .insert({
      client_id,
      user_id: userId,
      activity_type,
      description: description || null,
      from_value: from_value || null,
      to_value: to_value || null,
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) throw error;

  // Update last_contact on the client for contact-type activities
  if (["call", "email", "meeting"].includes(activity_type)) {
    await supabase
      .from("olive_clients")
      .update({ last_contact: new Date().toISOString() })
      .eq("id", client_id);
  }

  return { success: true, activity: data };
}

// ─── Pipeline Stats ──────────────────────────────────────────

async function pipelineStats(supabase: any, body: any) {
  const { space_id } = body;
  if (!space_id) return { error: "space_id required" };

  // Get counts by stage
  const stages = ["lead", "prospect", "active", "completed", "lost", "paused"];
  const counts: Record<string, number> = {};
  const values: Record<string, number> = {};

  for (const stage of stages) {
    const { count, data } = await supabase
      .from("olive_clients")
      .select("estimated_value", { count: "exact" })
      .eq("space_id", space_id)
      .eq("stage", stage)
      .eq("is_archived", false);

    counts[stage] = count || 0;
    values[stage] = (data || []).reduce(
      (sum: number, c: any) => sum + (parseFloat(c.estimated_value) || 0),
      0
    );
  }

  // Overdue follow-ups
  const { count: overdue } = await supabase
    .from("olive_clients")
    .select("*", { count: "exact", head: true })
    .eq("space_id", space_id)
    .eq("is_archived", false)
    .lt("follow_up_date", new Date().toISOString())
    .not("follow_up_date", "is", null);

  // Recent activity count (7d)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { count: recentActivity } = await supabase
    .from("olive_client_activity")
    .select("*", { count: "exact", head: true })
    .in(
      "client_id",
      (await supabase.from("olive_clients").select("id").eq("space_id", space_id)).data?.map(
        (c: any) => c.id
      ) || []
    )
    .gte("created_at", sevenDaysAgo);

  const totalActive = counts.lead + counts.prospect + counts.active;
  const totalValue = values.lead + values.prospect + values.active;

  return {
    counts,
    values,
    total_active: totalActive,
    total_pipeline_value: totalValue,
    overdue_follow_ups: overdue || 0,
    recent_activity_7d: recentActivity || 0,
  };
}

// ─── Get Follow-ups ─────────────────────────────────────────

async function getFollowUps(supabase: any, body: any) {
  const { space_id, days_ahead = 7 } = body;
  if (!space_id) return { error: "space_id required" };

  const cutoff = new Date(Date.now() + days_ahead * 86400000).toISOString();

  const { data: overdue } = await supabase
    .from("olive_clients")
    .select("id, name, company, stage, follow_up_date, last_contact")
    .eq("space_id", space_id)
    .eq("is_archived", false)
    .lt("follow_up_date", new Date().toISOString())
    .not("follow_up_date", "is", null)
    .order("follow_up_date");

  const { data: upcoming } = await supabase
    .from("olive_clients")
    .select("id, name, company, stage, follow_up_date, last_contact")
    .eq("space_id", space_id)
    .eq("is_archived", false)
    .gte("follow_up_date", new Date().toISOString())
    .lte("follow_up_date", cutoff)
    .order("follow_up_date");

  return {
    overdue: overdue || [],
    upcoming: upcoming || [],
  };
}

// ─── Archive Client ──────────────────────────────────────────

async function archiveClient(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { client_id } = body;
  if (!client_id) return { error: "client_id required" };

  const { error } = await supabase
    .from("olive_clients")
    .update({ is_archived: true })
    .eq("id", client_id);

  if (error) throw error;

  await supabase.from("olive_client_activity").insert({
    client_id,
    user_id: userId,
    activity_type: "note",
    description: "Client archived",
  });

  return { success: true };
}
