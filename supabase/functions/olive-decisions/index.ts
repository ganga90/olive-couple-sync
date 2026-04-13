/**
 * Olive Decisions — Team Decision Log
 *
 * Records team decisions with full context: rationale, alternatives considered,
 * participants, and outcome tracking. Searchable and referenceable.
 *
 * Actions:
 * - create: Log a new decision
 * - update: Update decision (status, outcome, etc.)
 * - get: Get a decision with full details
 * - list: List decisions for a space (filterable)
 * - search: Search decisions by text
 * - stats: Decision analytics for a space
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
        return json(await createDecision(supabase, body, userId));
      case "update":
        return json(await updateDecision(supabase, body, userId));
      case "get":
        return json(await getDecision(supabase, body));
      case "list":
        return json(await listDecisions(supabase, body));
      case "search":
        return json(await searchDecisions(supabase, body));
      case "stats":
        return json(await decisionStats(supabase, body));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-decisions error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── Create Decision ─────────────────────────────────────────

async function createDecision(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const {
    space_id, title, description, category, context, rationale,
    alternatives, participants, related_note_ids, tags, decision_date,
  } = body;
  if (!space_id || !title) return { error: "space_id and title required" };

  const { data, error } = await supabase
    .from("olive_decisions")
    .insert({
      space_id,
      user_id: userId,
      title,
      description: description || null,
      category: category || "other",
      status: "proposed",
      decision_date: decision_date || new Date().toISOString(),
      context: context || null,
      rationale: rationale || null,
      alternatives: alternatives || [],
      participants: participants || [userId],
      related_note_ids: related_note_ids || [],
      tags: tags || [],
    })
    .select()
    .single();

  if (error) throw error;

  // Log engagement event
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "decision_logged",
    metadata: { decision_id: data.id, space_id, category },
  }).catch(() => {});

  return { success: true, decision: data };
}

// ─── Update Decision ─────────────────────────────────────────

async function updateDecision(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { decision_id, ...updates } = body;
  if (!decision_id) return { error: "decision_id required" };

  // Remove non-updatable fields
  delete updates.action;
  delete updates.id;
  delete updates.created_at;
  delete updates.space_id;
  delete updates.user_id;

  // Track implementation
  const wasImplemented = updates.status === "implemented";

  const { data, error } = await supabase
    .from("olive_decisions")
    .update(updates)
    .eq("id", decision_id)
    .select()
    .single();

  if (error) throw error;

  if (wasImplemented) {
    await supabase.from("olive_engagement_events").insert({
      user_id: userId,
      event_type: "decision_implemented",
      metadata: { decision_id, category: data.category },
    }).catch(() => {});
  }

  return { success: true, decision: data };
}

// ─── Get Decision ────────────────────────────────────────────

async function getDecision(supabase: any, body: any) {
  const { decision_id } = body;
  if (!decision_id) return { error: "decision_id required" };

  const { data, error } = await supabase
    .from("olive_decisions")
    .select("*")
    .eq("id", decision_id)
    .single();

  if (error) throw error;
  return { decision: data };
}

// ─── List Decisions ──────────────────────────────────────────

async function listDecisions(supabase: any, body: any) {
  const { space_id, category, status, limit = 50, offset = 0 } = body;
  if (!space_id) return { error: "space_id required" };

  let query = supabase
    .from("olive_decisions")
    .select("*", { count: "exact" })
    .eq("space_id", space_id)
    .eq("is_archived", false)
    .order("decision_date", { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) query = query.eq("category", category);
  if (status) query = query.eq("status", status);

  const { data, count, error } = await query;
  if (error) throw error;

  return { decisions: data, total: count };
}

// ─── Search Decisions ────────────────────────────────────────

async function searchDecisions(supabase: any, body: any) {
  const { space_id, query: searchQuery, limit = 20 } = body;
  if (!space_id || !searchQuery) return { error: "space_id and query required" };

  const term = `%${searchQuery}%`;

  const { data, error } = await supabase
    .from("olive_decisions")
    .select("*")
    .eq("space_id", space_id)
    .eq("is_archived", false)
    .or(`title.ilike.${term},description.ilike.${term},context.ilike.${term},rationale.ilike.${term}`)
    .order("decision_date", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return { decisions: data };
}

// ─── Decision Stats ──────────────────────────────────────────

async function decisionStats(supabase: any, body: any) {
  const { space_id } = body;
  if (!space_id) return { error: "space_id required" };

  const statuses = ["proposed", "discussed", "decided", "implemented", "revisited", "reversed"];
  const counts: Record<string, number> = {};

  for (const status of statuses) {
    const { count } = await supabase
      .from("olive_decisions")
      .select("*", { count: "exact", head: true })
      .eq("space_id", space_id)
      .eq("status", status)
      .eq("is_archived", false);
    counts[status] = count || 0;
  }

  // Category breakdown
  const { data: catData } = await supabase
    .from("olive_decisions")
    .select("category")
    .eq("space_id", space_id)
    .eq("is_archived", false);

  const categories: Record<string, number> = {};
  for (const row of catData || []) {
    categories[row.category || "other"] = (categories[row.category || "other"] || 0) + 1;
  }

  // Recent decisions (30d)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { count: recentCount } = await supabase
    .from("olive_decisions")
    .select("*", { count: "exact", head: true })
    .eq("space_id", space_id)
    .gte("created_at", thirtyDaysAgo);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    total,
    by_status: counts,
    by_category: categories,
    recent_30d: recentCount || 0,
    implementation_rate: total > 0
      ? ((counts.implemented || 0) / total * 100).toFixed(1) + "%"
      : "N/A",
  };
}
